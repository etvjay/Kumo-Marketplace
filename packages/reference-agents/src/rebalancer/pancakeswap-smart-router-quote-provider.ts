import {
  ChainId,
  CurrencyAmount,
  Percent,
  Token,
  TradeType
} from "@pancakeswap/sdk";
import {
  SMART_ROUTER_ADDRESSES,
  SmartRouter,
  SwapRouter
} from "@pancakeswap/smart-router";
import { Pool } from "@pancakeswap/v3-sdk";
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
 * Router SDK. The known live V3 pool is supplied as the only candidate pool,
 * so this adapter does not depend on a subgraph or infer additional venues.
 *
 * The adapter never signs or broadcasts. Router identity is checked against an
 * explicitly accepted address before calldata is returned to PreparedAction.
 */
export class PancakeSmartRouterQuoteProvider implements PancakeV3SwapQuoteProvider {
  readonly id = "pancakeswap-smart-router-static-v3-quote-v1";
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

    const tokenIn = new Token(ChainId.BSC, getAddress(input.tokenIn), input.tokenInDecimals);
    const tokenOut = new Token(ChainId.BSC, getAddress(input.tokenOut), input.tokenOutDecimals);
    const [token0, token1] = tokenIn.sortsBefore(tokenOut)
      ? [tokenIn, tokenOut]
      : [tokenOut, tokenIn];

    const pool = new Pool(
      token0,
      token1,
      input.feeTier,
      input.sqrtPriceX96,
      input.poolLiquidity,
      input.currentTick
    );

    const quoteProvider = SmartRouter.createQuoteProvider({
      onChainProvider: () => this.client
    });
    const amount = CurrencyAmount.fromRawAmount(tokenIn, input.amountIn.toString());
    const trade = await SmartRouter.getBestTrade(amount, tokenOut, TradeType.EXACT_INPUT, {
      gasPriceWei: () => this.client.getGasPrice(),
      maxHops: 1,
      maxSplits: 1,
      poolProvider: SmartRouter.createStaticPoolProvider([pool]),
      quoteProvider,
      quoterOptimization: true
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
      `pool:${getAddress(input.pool)}`,
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
        `pancakeswap-v3:pool:${getAddress(input.pool)}`,
        `bsc:gas-price:${gasPrice.toString()}:${Date.parse(quotedAt)}`
      ]
    };
  }
}
