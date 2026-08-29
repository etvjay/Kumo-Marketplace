import {
  ChainId,
  CurrencyAmount,
  Percent,
  Token,
  TradeType
} from "@pancakeswap/sdk";
import {
  PoolType,
  SMART_ROUTER_ADDRESSES,
  SmartRouter,
  SwapRouter
} from "@pancakeswap/smart-router";
import {
  createPublicClient,
  getAddress,
  hexToBigInt,
  http,
  type Address
} from "viem";
import { PANCAKESWAP_V3_BSC } from "./pancakeswap-v3.js";
import type {
  PancakeV3ExactInputSwapQuote,
  PancakeV3SwapQuoteProvider
} from "./pancakeswap-v3-transaction-preparer.js";

const BSC = {
  id: 56,
  name: "BNB Smart Chain",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: { default: { http: [] as string[] } }
} as const;

export interface PancakeSmartRouterQuoteProviderOptions {
  rpcUrl: string;
  expectedRouter?: Address | string;
  rpcProviderId?: string;
}

/**
 * Produces exact-input swap calldata using PancakeSwap's maintained Smart
 * Router SDK. V3 candidates are discovered by the SDK from onchain state, then
 * fail-closed filtered to the exact pool already verified by the Rebalancer.
 * No subgraph pool inventory is trusted for the final route set.
 *
 * The adapter never signs or broadcasts. Router identity is checked against an
 * explicitly accepted address before calldata is returned to PreparedAction.
 */
export class PancakeSmartRouterQuoteProvider implements PancakeV3SwapQuoteProvider {
  readonly id = "pancakeswap-smart-router-exact-v3-pool-quote-v1";
  private readonly client;
  private readonly expectedRouter: Address;
  private readonly rpcProviderId: string;

  constructor(options: PancakeSmartRouterQuoteProviderOptions) {
    if (!options.rpcUrl) throw new Error("BSC_RPC_URL_REQUIRED");
    this.client = createPublicClient({ chain: BSC, transport: http(options.rpcUrl) });
    this.expectedRouter = getAddress(options.expectedRouter ?? PANCAKESWAP_V3_BSC.smartRouter);
    this.rpcProviderId = options.rpcProviderId ?? "bsc-rpc";
  }

  async quoteExactInput(input: {
    tokenIn: Address;
    tokenOut: Address;
    tokenInDecimals: number;
    tokenOutDecimals: number;
    amountIn: bigint;
    recipient: Address;
    maxSlippageBps: number;
    expiresAt: string;
    pool: Address;
    feeTier: number;
    sqrtPriceX96: bigint;
    poolLiquidity: bigint;
    currentTick: number;
  }): Promise<PancakeV3ExactInputSwapQuote> {
    if (input.amountIn <= 0n) throw new Error("SMART_ROUTER_AMOUNT_IN_REQUIRED");
    if (input.maxSlippageBps < 0 || input.maxSlippageBps > 10_000) {
      throw new Error("SMART_ROUTER_INVALID_SLIPPAGE");
    }
    const chainId = await this.client.getChainId();
    if (chainId !== ChainId.BSC) throw new Error(`SMART_ROUTER_WRONG_CHAIN:${chainId}`);

    const sdkRouterRaw = SMART_ROUTER_ADDRESSES[ChainId.BSC];
    if (!sdkRouterRaw) throw new Error("SMART_ROUTER_BSC_ADDRESS_MISSING_FROM_SDK");
    const sdkRouter = getAddress(sdkRouterRaw);
    if (sdkRouter !== this.expectedRouter) {
      throw new Error(`SMART_ROUTER_IDENTITY_MISMATCH:${sdkRouter}:${this.expectedRouter}`);
    }

    const tokenIn = new Token(
      ChainId.BSC,
      getAddress(input.tokenIn),
      input.tokenInDecimals,
      "KUMO_IN"
    );
    const tokenOut = new Token(
      ChainId.BSC,
      getAddress(input.tokenOut),
      input.tokenOutDecimals,
      "KUMO_OUT"
    );
    const requestedPool = getAddress(input.pool);

    const candidates = await SmartRouter.getV3CandidatePools({
      onChainProvider: () => this.client,
      currencyA: tokenIn,
      currencyB: tokenOut
    });
    const exactPools = candidates.filter((pool) => getAddress(pool.address) === requestedPool);
    if (exactPools.length !== 1) {
      throw new Error(`SMART_ROUTER_EXACT_POOL_NOT_RESOLVED:${requestedPool}:${exactPools.length}`);
    }
    const exactPool = exactPools[0];
    if (exactPool.fee !== input.feeTier) {
      throw new Error(`SMART_ROUTER_POOL_FEE_MISMATCH:${exactPool.fee}:${input.feeTier}`);
    }

    // The Rebalancer independently read these values at finalized state. The
    // router is allowed to re-read current state for a quote, but the action is
    // still bound to the proposal's market root and must be refreshed before
    // execution. We intentionally do not overwrite proposal evidence here.
    const quoteProvider = SmartRouter.createQuoteProvider({
      onChainProvider: () => this.client
    });
    const amount = CurrencyAmount.fromRawAmount(tokenIn, input.amountIn.toString());
    const trade = await SmartRouter.getBestTrade(amount, tokenOut, TradeType.EXACT_INPUT, {
      gasPriceWei: () => this.client.getGasPrice(),
      maxHops: 1,
      maxSplits: 1,
      poolProvider: SmartRouter.createStaticPoolProvider(exactPools),
      quoteProvider,
      quoterOptimization: true,
      allowedPoolTypes: [PoolType.V3]
    });
    if (!trade) throw new Error("SMART_ROUTER_NO_ROUTE");

    const slippageTolerance = new Percent(Math.floor(input.maxSlippageBps), 10_000);
    const swapCall = SwapRouter.swapCallParameters(trade, {
      recipient: getAddress(input.recipient),
      slippageTolerance
    });
    const outputRaw = BigInt(trade.outputAmount.quotient.toString());
    if (outputRaw <= 0n) throw new Error("SMART_ROUTER_ZERO_OUTPUT");

    const quotedAt = new Date().toISOString();
    const expiryMs = Date.parse(input.expiresAt);
    if (!Number.isFinite(expiryMs) || expiryMs <= Date.parse(quotedAt)) {
      throw new Error("SMART_ROUTER_INVALID_EXPIRY");
    }

    const gasPrice = await this.client.getGasPrice();
    const routeRef = [
      "pancakeswap-smart-router",
      `chain:${ChainId.BSC}`,
      `router:${sdkRouter}`,
      `pool:${requestedPool}`,
      `fee:${input.feeTier}`,
      `tokenIn:${getAddress(input.tokenIn)}`,
      `tokenOut:${getAddress(input.tokenOut)}`,
      `amountIn:${input.amountIn.toString()}`,
      `amountOut:${outputRaw.toString()}`,
      `rpc:${this.rpcProviderId}`
    ].join("|");

    return {
      quoteId: `pancake-route:${Date.parse(quotedAt)}:${input.amountIn.toString()}:${outputRaw.toString()}`,
      quotedAt,
      expiresAt: input.expiresAt,
      router: sdkRouter,
      tokenIn: getAddress(input.tokenIn),
      tokenOut: getAddress(input.tokenOut),
      amountIn: input.amountIn,
      expectedAmountOut: outputRaw,
      calldata: swapCall.calldata,
      value: hexToBigInt(swapCall.value),
      routeRef,
      evidenceRefs: [
        `pancakeswap-sdk:smart-router:${sdkRouter}`,
        `pancakeswap-v3:pool:${requestedPool}`,
        `bsc:gas-price:${gasPrice.toString()}:${Date.parse(quotedAt)}`
      ]
    };
  }
}
