import { createPublicClient, getAddress, http, keccak256, type Address } from "viem";
import type { ChainSnapshot, ObservationPurpose } from "@kumo/chain-state";
import { VENUS_CORE_BSC, VENUS_CORE_SOURCE_REFS } from "./venus-bsc.js";
import type { VenusCoreAccountState, VenusCoreMarketAccountSnapshot, VenusNativeSolvencyStatus } from "./types.js";

const BSC = {
  id: 56,
  name: "BNB Smart Chain",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: { default: { http: [] as string[] } }
} as const;

const COMPTROLLER_ABI = [
  {
    type: "function", name: "getAccountLiquidity", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "error", type: "uint256" }, { name: "liquidity", type: "uint256" }, { name: "shortfall", type: "uint256" }]
  },
  {
    type: "function", name: "getAssetsIn", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }], outputs: [{ name: "assets", type: "address[]" }]
  },
  {
    type: "function", name: "getAllMarkets", stateMutability: "view",
    inputs: [], outputs: [{ name: "markets", type: "address[]" }]
  },
  {
    type: "function", name: "isMarketListed", stateMutability: "view",
    inputs: [{ name: "vToken", type: "address" }], outputs: [{ name: "listed", type: "bool" }]
  },
  {
    type: "function", name: "getCollateralFactor", stateMutability: "view",
    inputs: [{ name: "vToken", type: "address" }], outputs: [{ name: "factor", type: "uint256" }]
  },
  {
    type: "function", name: "getLiquidationThreshold", stateMutability: "view",
    inputs: [{ name: "vToken", type: "address" }], outputs: [{ name: "threshold", type: "uint256" }]
  },
  {
    type: "function", name: "getLiquidationIncentive", stateMutability: "view",
    inputs: [{ name: "vToken", type: "address" }], outputs: [{ name: "incentive", type: "uint256" }]
  }
] as const;

const VTOKEN_ABI = [{
  type: "function", name: "getAccountSnapshot", stateMutability: "view",
  inputs: [{ name: "account", type: "address" }],
  outputs: [
    { name: "error", type: "uint256" },
    { name: "vTokenBalance", type: "uint256" },
    { name: "borrowBalance", type: "uint256" },
    { name: "exchangeRateMantissa", type: "uint256" }
  ]
}] as const;

const ORACLE_ABI = [{
  type: "function", name: "getUnderlyingPrice", stateMutability: "view",
  inputs: [{ name: "vToken", type: "address" }], outputs: [{ name: "price", type: "uint256" }]
}] as const;

export interface VenusCorePoolReaderOptions {
  rpcUrl: string;
  rpcProviderId?: string;
  purpose?: ObservationPurpose;
}

function nativeStatus(liquidity: bigint, shortfall: bigint): VenusNativeSolvencyStatus {
  if (shortfall > 0n) return "LIQUIDATION_ELIGIBLE";
  if (liquidity > 0n) return "SOLVENT";
  return "AT_LIQUIDATION_THRESHOLD";
}

interface RawMarketSnapshot {
  vToken: Address;
  enteredAsCollateralMarket: boolean;
  snapshotError: bigint;
  vTokenBalance: bigint;
  borrowBalance: bigint;
  exchangeRateMantissa: bigint;
}

export class VenusCorePoolReader {
  readonly id = "kumo-venus-core-pool-reader-v2";
  private readonly client;
  private readonly rpcProviderId: string;
  private readonly purpose: ObservationPurpose;

  constructor(options: VenusCorePoolReaderOptions) {
    if (!options.rpcUrl) throw new Error("BSC_RPC_URL_REQUIRED");
    this.client = createPublicClient({ chain: BSC, transport: http(options.rpcUrl) });
    this.rpcProviderId = options.rpcProviderId ?? "bsc-rpc";
    this.purpose = options.purpose ?? "evidence";
  }

  private async freezeBlock(): Promise<{ blockNumber: bigint; snapshot: ChainSnapshot }> {
    const chainId = await this.client.getChainId();
    if (chainId !== 56) throw new Error(`VENUS_WRONG_CHAIN:${chainId}`);
    const blockTag = this.purpose === "execution" ? "latest" : "finalized";
    const block = await this.client.getBlock({ blockTag });
    if (block.number === null || block.hash === null) throw new Error("VENUS_BLOCK_UNAVAILABLE");
    return {
      blockNumber: block.number,
      snapshot: {
        chainId: 56,
        purpose: this.purpose,
        blockTag,
        blockNumber: block.number.toString(),
        blockHash: block.hash,
        blockTimestamp: Number(block.timestamp),
        observedAt: new Date().toISOString(),
        rpcProviderId: this.rpcProviderId
      }
    };
  }

  async readAccount(accountInput: Address | string): Promise<VenusCoreAccountState> {
    const account = getAddress(accountInput);
    const comptroller = getAddress(VENUS_CORE_BSC.comptroller);
    const resilientOracle = getAddress(VENUS_CORE_BSC.resilientOracle);
    const { blockNumber, snapshot } = await this.freezeBlock();

    const [comptrollerCode, oracleCode, liquidityResult, enteredMarketsRaw, allMarketsRaw] = await Promise.all([
      this.client.getBytecode({ address: comptroller, blockNumber }),
      this.client.getBytecode({ address: resilientOracle, blockNumber }),
      this.client.readContract({ address: comptroller, abi: COMPTROLLER_ABI, functionName: "getAccountLiquidity", args: [account], blockNumber }),
      this.client.readContract({ address: comptroller, abi: COMPTROLLER_ABI, functionName: "getAssetsIn", args: [account], blockNumber }),
      this.client.readContract({ address: comptroller, abi: COMPTROLLER_ABI, functionName: "getAllMarkets", blockNumber })
    ]);
    if (!comptrollerCode || comptrollerCode === "0x") throw new Error("VENUS_COMPTROLLER_CODE_MISSING");
    if (!oracleCode || oracleCode === "0x") throw new Error("VENUS_RESILIENT_ORACLE_CODE_MISSING");

    const [liquidityError, accountLiquidity, accountShortfall] = liquidityResult;
    if (liquidityError !== 0n) throw new Error(`VENUS_ACCOUNT_LIQUIDITY_ERROR:${liquidityError.toString()}`);

    const enteredMarkets = enteredMarketsRaw.map((address) => getAddress(address));
    const enteredSet = new Set(enteredMarkets.map((address) => address.toLowerCase()));
    const allMarkets = allMarketsRaw.map((address) => getAddress(address));

    const rawMarkets = await Promise.all(allMarkets.map(async (vToken): Promise<RawMarketSnapshot> => {
      const [code, accountSnapshot] = await Promise.all([
        this.client.getBytecode({ address: vToken, blockNumber }),
        this.client.readContract({ address: vToken, abi: VTOKEN_ABI, functionName: "getAccountSnapshot", args: [account], blockNumber })
      ]);
      if (!code || code === "0x") throw new Error(`VENUS_VTOKEN_CODE_MISSING:${vToken}`);
      const [snapshotError, vTokenBalance, borrowBalance, exchangeRateMantissa] = accountSnapshot;
      return {
        vToken,
        enteredAsCollateralMarket: enteredSet.has(vToken.toLowerCase()),
        snapshotError,
        vTokenBalance,
        borrowBalance,
        exchangeRateMantissa
      };
    }));

    const relevantMarkets = rawMarkets.filter((market) =>
      market.enteredAsCollateralMarket || market.vTokenBalance > 0n || market.borrowBalance > 0n
    );

    const activeMarkets = await Promise.all(relevantMarkets.map(async (market): Promise<VenusCoreMarketAccountSnapshot> => {
      if (market.snapshotError !== 0n) throw new Error(`VENUS_MARKET_SNAPSHOT_ERROR:${market.vToken}:${market.snapshotError.toString()}`);
      const [underlyingPriceMantissa, isListed, baseCollateralFactorMantissa, baseLiquidationThresholdMantissa, baseLiquidationIncentiveMantissa] = await Promise.all([
        this.client.readContract({ address: resilientOracle, abi: ORACLE_ABI, functionName: "getUnderlyingPrice", args: [market.vToken], blockNumber }),
        this.client.readContract({ address: comptroller, abi: COMPTROLLER_ABI, functionName: "isMarketListed", args: [market.vToken], blockNumber }),
        this.client.readContract({ address: comptroller, abi: COMPTROLLER_ABI, functionName: "getCollateralFactor", args: [market.vToken], blockNumber }),
        this.client.readContract({ address: comptroller, abi: COMPTROLLER_ABI, functionName: "getLiquidationThreshold", args: [market.vToken], blockNumber }),
        this.client.readContract({ address: comptroller, abi: COMPTROLLER_ABI, functionName: "getLiquidationIncentive", args: [market.vToken], blockNumber })
      ]);
      if (underlyingPriceMantissa <= 0n) throw new Error(`VENUS_MARKET_PRICE_INVALID:${market.vToken}`);
      return {
        ...market,
        isListed,
        underlyingPriceMantissa,
        baseCollateralFactorMantissa,
        baseLiquidationThresholdMantissa,
        baseLiquidationIncentiveMantissa
      };
    }));

    const evidenceRefs = [
      `bsc:block:${snapshot.blockNumber}:${snapshot.blockHash}`,
      `${VENUS_CORE_SOURCE_REFS.comptroller}:code:${keccak256(comptrollerCode)}`,
      `${VENUS_CORE_SOURCE_REFS.resilientOracle}:code:${keccak256(oracleCode)}`,
      `venus:account-liquidity:${account}:block:${snapshot.blockNumber}`,
      ...activeMarkets.flatMap((market) => [
        `venus:market-snapshot:${market.vToken}:${account}:block:${snapshot.blockNumber}`,
        `venus:base-risk:${market.vToken}:cf:${market.baseCollateralFactorMantissa.toString()}:lt:${market.baseLiquidationThresholdMantissa.toString()}:li:${market.baseLiquidationIncentiveMantissa.toString()}:block:${snapshot.blockNumber}`
      ])
    ];

    return {
      chainId: 56,
      account,
      comptroller,
      resilientOracle,
      liquidityError,
      accountLiquidity,
      accountShortfall,
      nativeSolvencyStatus: nativeStatus(accountLiquidity, accountShortfall),
      enteredMarkets,
      listedMarketCount: allMarkets.length,
      activeMarkets,
      snapshot,
      evidenceRefs,
      limitations: [
        "Venus-native accountLiquidity/accountShortfall are preserved as the primary solvency facts; no generic health factor is asserted.",
        "baseCollateralFactor/baseLiquidationThreshold/baseLiquidationIncentive are Core Pool configured values. They are not labeled account-effective values for e-mode or another selected pool.",
        "Oracle prices are raw Resilient Oracle getUnderlyingPrice outputs; decimal normalization is intentionally deferred to a derived economic layer.",
        "This adapter is read-only and creates no rescue authority or transaction."
      ]
    };
  }
}
