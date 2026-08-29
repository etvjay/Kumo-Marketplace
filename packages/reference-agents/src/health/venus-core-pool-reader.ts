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

export class VenusCorePoolReader {
  readonly id = "kumo-venus-core-pool-reader-v1";
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
    const observedAt = new Date().toISOString();
    return {
      blockNumber: block.number,
      snapshot: {
        chainId: 56,
        purpose: this.purpose,
        blockTag,
        blockNumber: block.number.toString(),
        blockHash: block.hash,
        blockTimestamp: Number(block.timestamp),
        observedAt,
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

    const marketReads = await Promise.all(allMarkets.map(async (vToken): Promise<VenusCoreMarketAccountSnapshot> => {
      const [code, accountSnapshot, underlyingPriceMantissa] = await Promise.all([
        this.client.getBytecode({ address: vToken, blockNumber }),
        this.client.readContract({ address: vToken, abi: VTOKEN_ABI, functionName: "getAccountSnapshot", args: [account], blockNumber }),
        this.client.readContract({ address: resilientOracle, abi: ORACLE_ABI, functionName: "getUnderlyingPrice", args: [vToken], blockNumber })
      ]);
      if (!code || code === "0x") throw new Error(`VENUS_VTOKEN_CODE_MISSING:${vToken}`);
      const [snapshotError, vTokenBalance, borrowBalance, exchangeRateMantissa] = accountSnapshot;
      return {
        vToken,
        enteredAsCollateralMarket: enteredSet.has(vToken.toLowerCase()),
        snapshotError,
        vTokenBalance,
        borrowBalance,
        exchangeRateMantissa,
        underlyingPriceMantissa
      };
    }));

    const activeMarkets = marketReads.filter((market) =>
      market.enteredAsCollateralMarket || market.vTokenBalance > 0n || market.borrowBalance > 0n
    );
    for (const market of activeMarkets) {
      if (market.snapshotError !== 0n) throw new Error(`VENUS_MARKET_SNAPSHOT_ERROR:${market.vToken}:${market.snapshotError.toString()}`);
      if (market.underlyingPriceMantissa <= 0n) throw new Error(`VENUS_MARKET_PRICE_INVALID:${market.vToken}`);
    }

    const evidenceRefs = [
      `bsc:block:${snapshot.blockNumber}:${snapshot.blockHash}`,
      `${VENUS_CORE_SOURCE_REFS.comptroller}:code:${keccak256(comptrollerCode)}`,
      `${VENUS_CORE_SOURCE_REFS.resilientOracle}:code:${keccak256(oracleCode)}`,
      `venus:account-liquidity:${account}:block:${snapshot.blockNumber}`,
      ...activeMarkets.map((market) => `venus:market-snapshot:${market.vToken}:${account}:block:${snapshot.blockNumber}`)
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
        "Per-market collateral factors and liquidation thresholds are not included in v1 until the current Core Pool Diamond risk getter ABI is pinned and tested.",
        "Oracle prices are raw Resilient Oracle getUnderlyingPrice outputs; decimal normalization is intentionally deferred to a derived economic layer.",
        "This adapter is read-only and creates no rescue authority or transaction."
      ]
    };
  }
}
