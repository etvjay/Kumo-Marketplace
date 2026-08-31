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

const USE_COLLATERAL_FACTOR = 0;
const USE_LIQUIDATION_THRESHOLD = 1;

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
  },
  {
    type: "function", name: "getEffectiveLtvFactor", stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "vToken", type: "address" },
      { name: "weightingStrategy", type: "uint8" }
    ],
    outputs: [{ name: "factor", type: "uint256" }]
  },
  {
    type: "function", name: "getEffectiveLiquidationIncentive", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }, { name: "vToken", type: "address" }],
    outputs: [{ name: "incentive", type: "uint256" }]
  }
] as const;

const VTOKEN_ABI = [
  {
    type: "function", name: "getAccountSnapshot", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [
      { name: "error", type: "uint256" },
      { name: "vTokenBalance", type: "uint256" },
      { name: "borrowBalance", type: "uint256" },
      { name: "exchangeRateMantissa", type: "uint256" }
    ]
  },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
  { type: "function", name: "underlying", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] }
] as const;

const ERC20_METADATA_ABI = [
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] }
] as const;

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
  readonly id = "kumo-venus-core-pool-reader-v5";
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
    const vBNB = getAddress(VENUS_CORE_BSC.vBNB);
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

    const rawMarkets: RawMarketSnapshot[] = [];
    for (const vToken of allMarkets) {
      const accountSnapshot = await this.client.readContract({
        address: vToken,
        abi: VTOKEN_ABI,
        functionName: "getAccountSnapshot",
        args: [account],
        blockNumber
      });
      const [snapshotError, vTokenBalance, borrowBalance, exchangeRateMantissa] = accountSnapshot;
      rawMarkets.push({
        vToken,
        enteredAsCollateralMarket: enteredSet.has(vToken.toLowerCase()),
        snapshotError,
        vTokenBalance,
        borrowBalance,
        exchangeRateMantissa
      });
    }

    const relevantMarkets = rawMarkets.filter((market) =>
      market.enteredAsCollateralMarket || market.vTokenBalance > 0n || market.borrowBalance > 0n
    );

    const activeMarkets: VenusCoreMarketAccountSnapshot[] = [];
    for (const market of relevantMarkets) {
      if (market.snapshotError !== 0n) throw new Error(`VENUS_MARKET_SNAPSHOT_ERROR:${market.vToken}:${market.snapshotError.toString()}`);
      const marketCode = await this.client.getBytecode({ address: market.vToken, blockNumber });
      if (!marketCode || marketCode === "0x") throw new Error(`VENUS_VTOKEN_CODE_MISSING:${market.vToken}`);

      const nativeUnderlying = market.vToken.toLowerCase() === vBNB.toLowerCase();
      const vTokenDecimalsRaw = await this.client.readContract({
        address: market.vToken,
        abi: VTOKEN_ABI,
        functionName: "decimals",
        blockNumber
      });
      const vTokenDecimals = Number(vTokenDecimalsRaw);
      if (vTokenDecimals !== 8) throw new Error(`VENUS_VTOKEN_DECIMALS_UNEXPECTED:${market.vToken}:${String(vTokenDecimalsRaw)}`);

      const underlyingPriceMantissa = await this.client.readContract({
        address: resilientOracle,
        abi: ORACLE_ABI,
        functionName: "getUnderlyingPrice",
        args: [market.vToken],
        blockNumber
      });
      if (underlyingPriceMantissa <= 0n) throw new Error(`VENUS_MARKET_PRICE_INVALID:${market.vToken}`);

      const isListed = await this.client.readContract({
        address: comptroller,
        abi: COMPTROLLER_ABI,
        functionName: "isMarketListed",
        args: [market.vToken],
        blockNumber
      });
      const baseCollateralFactorMantissa = await this.client.readContract({
        address: comptroller,
        abi: COMPTROLLER_ABI,
        functionName: "getCollateralFactor",
        args: [market.vToken],
        blockNumber
      });
      const baseLiquidationThresholdMantissa = await this.client.readContract({
        address: comptroller,
        abi: COMPTROLLER_ABI,
        functionName: "getLiquidationThreshold",
        args: [market.vToken],
        blockNumber
      });
      const baseLiquidationIncentiveMantissa = await this.client.readContract({
        address: comptroller,
        abi: COMPTROLLER_ABI,
        functionName: "getLiquidationIncentive",
        args: [market.vToken],
        blockNumber
      });
      const effectiveCollateralFactorMantissa = await this.client.readContract({
        address: comptroller,
        abi: COMPTROLLER_ABI,
        functionName: "getEffectiveLtvFactor",
        args: [account, market.vToken, USE_COLLATERAL_FACTOR],
        blockNumber
      });
      const effectiveLiquidationThresholdMantissa = await this.client.readContract({
        address: comptroller,
        abi: COMPTROLLER_ABI,
        functionName: "getEffectiveLtvFactor",
        args: [account, market.vToken, USE_LIQUIDATION_THRESHOLD],
        blockNumber
      });
      const effectiveLiquidationIncentiveMantissa = await this.client.readContract({
        address: comptroller,
        abi: COMPTROLLER_ABI,
        functionName: "getEffectiveLiquidationIncentive",
        args: [account, market.vToken],
        blockNumber
      });

      let vTokenSymbol = "UNRESOLVED";
      try {
        vTokenSymbol = await this.client.readContract({
          address: market.vToken,
          abi: VTOKEN_ABI,
          functionName: "symbol",
          blockNumber
        });
      } catch {
        // Symbol is display metadata, never protocol truth. Keep the state read usable if a public RPC throttles it.
      }

      let underlyingAddress: Address | null = null;
      let underlyingSymbol = "BNB";
      let underlyingDecimals = 18;
      if (!nativeUnderlying) {
        underlyingAddress = getAddress(await this.client.readContract({
          address: market.vToken,
          abi: VTOKEN_ABI,
          functionName: "underlying",
          blockNumber
        }));
        const decimals = await this.client.readContract({
          address: underlyingAddress,
          abi: ERC20_METADATA_ABI,
          functionName: "decimals",
          blockNumber
        });
        underlyingDecimals = Number(decimals);
        underlyingSymbol = "UNRESOLVED";
        try {
          underlyingSymbol = await this.client.readContract({
            address: underlyingAddress,
            abi: ERC20_METADATA_ABI,
            functionName: "symbol",
            blockNumber
          });
        } catch {
          // Symbol is display metadata, never protocol truth. Underlying address + decimals remain authoritative.
        }
      }

      activeMarkets.push({
        ...market,
        vTokenSymbol,
        vTokenDecimals,
        underlyingKind: nativeUnderlying ? "NATIVE" : "ERC20",
        underlyingAddress,
        underlyingSymbol,
        underlyingDecimals,
        isListed,
        underlyingPriceMantissa,
        baseCollateralFactorMantissa,
        baseLiquidationThresholdMantissa,
        baseLiquidationIncentiveMantissa,
        effectiveCollateralFactorMantissa,
        effectiveLiquidationThresholdMantissa,
        effectiveLiquidationIncentiveMantissa
      });
    }

    const evidenceRefs = [
      `bsc:block:${snapshot.blockNumber}:${snapshot.blockHash}`,
      `${VENUS_CORE_SOURCE_REFS.comptroller}:code:${keccak256(comptrollerCode)}`,
      `${VENUS_CORE_SOURCE_REFS.resilientOracle}:code:${keccak256(oracleCode)}`,
      `venus:account-liquidity:${account}:block:${snapshot.blockNumber}`,
      ...activeMarkets.flatMap((market) => [
        `venus:market-snapshot:${market.vToken}:${account}:block:${snapshot.blockNumber}`,
        `venus:market-metadata:${market.vToken}:${market.vTokenSymbol}:${market.vTokenDecimals}:${market.underlyingKind}:${market.underlyingAddress ?? "BNB"}:${market.underlyingSymbol}:${market.underlyingDecimals}:block:${snapshot.blockNumber}`,
        `venus:base-risk:${market.vToken}:cf:${market.baseCollateralFactorMantissa.toString()}:lt:${market.baseLiquidationThresholdMantissa.toString()}:li:${market.baseLiquidationIncentiveMantissa.toString()}:block:${snapshot.blockNumber}`,
        `venus:effective-risk:${market.vToken}:${account}:cf:${market.effectiveCollateralFactorMantissa.toString()}:lt:${market.effectiveLiquidationThresholdMantissa.toString()}:li:${market.effectiveLiquidationIncentiveMantissa.toString()}:block:${snapshot.blockNumber}`
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
        "Base and account-effective collateral factor, liquidation threshold, and liquidation incentive are kept as separate onchain facts; effective values reflect the account's selected Venus pool/e-mode policy.",
        "vToken identity, underlying identity, and decimals are read at the same frozen block. vBNB is explicitly modeled as native BNB with 18 underlying decimals.",
        "Token symbols are non-authoritative display metadata. If a public RPC throttles symbol(), the reader records UNRESOLVED rather than failing protocol truth acquisition.",
        "Oracle prices are raw Resilient Oracle getUnderlyingPrice outputs; decimal normalization is intentionally deferred to a derived economic layer.",
        "All-market account snapshots and relevant-market metadata are read sequentially to stay within conservative public-RPC request pressure.",
        "This adapter is read-only and creates no rescue authority or transaction."
      ]
    };
  }
}
