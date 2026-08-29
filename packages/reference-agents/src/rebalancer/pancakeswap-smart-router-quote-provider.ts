import {
  createPublicClient,
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  http,
  type Address,
  type Hex
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

const FACTORY_ABI = [{
  type: "function",
  name: "getPool",
  stateMutability: "view",
  inputs: [
    { name: "tokenA", type: "address" },
    { name: "tokenB", type: "address" },
    { name: "fee", type: "uint24" }
  ],
  outputs: [{ name: "pool", type: "address" }]
}] as const;

const QUOTER_V2_ABI = [{
  type: "function",
  name: "quoteExactInputSingle",
  stateMutability: "nonpayable",
  inputs: [{
    name: "params",
    type: "tuple",
    components: [
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "amountIn", type: "uint256" },
      { name: "fee", type: "uint24" },
      { name: "sqrtPriceLimitX96", type: "uint160" }
    ]
  }],
  outputs: [
    { name: "amountOut", type: "uint256" },
    { name: "sqrtPriceX96After", type: "uint160" },
    { name: "initializedTicksCrossed", type: "uint32" },
    { name: "gasEstimate", type: "uint256" }
  ]
}] as const;

const SWAP_ROUTER_V3_ABI = [{
  type: "function",
  name: "exactInputSingle",
  stateMutability: "payable",
  inputs: [{
    name: "params",
    type: "tuple",
    components: [
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "recipient", type: "address" },
      { name: "deadline", type: "uint256" },
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMinimum", type: "uint256" },
      { name: "sqrtPriceLimitX96", type: "uint160" }
    ]
  }],
  outputs: [{ name: "amountOut", type: "uint256" }]
}] as const;

export interface PancakeSmartRouterQuoteProviderOptions {
  rpcUrl: string;
  expectedRouter?: Address | string;
  expectedQuoter?: Address | string;
  expectedFactory?: Address | string;
  rpcProviderId?: string;
}

function applySlippageFloor(amount: bigint, bps: number): bigint {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) throw new Error(`INVALID_SLIPPAGE_BPS:${bps}`);
  return amount * BigInt(10_000 - bps) / 10_000n;
}

/**
 * Deterministic single-pool Pancake V3 quote provider.
 *
 * Kumo already knows the exact V3 pool from independently read factory and
 * position state. This adapter therefore does not perform route discovery or
 * query a subgraph. It verifies the pair+fee still resolves to that exact pool,
 * calls Pancake QuoterV2 through eth_call at one concrete block, applies the
 * configured slippage floor, and encodes V3 SwapRouter.exactInputSingle.
 *
 * Despite the legacy class name retained for source compatibility, this path
 * intentionally bypasses the mixed Smart Router SDK. It never signs or sends.
 */
export class PancakeSmartRouterQuoteProvider implements PancakeV3SwapQuoteProvider {
  readonly id = "pancakeswap-v3-direct-quoter-v2-exact-pool-v1";
  private readonly client;
  private readonly expectedRouter: Address;
  private readonly expectedQuoter: Address;
  private readonly expectedFactory: Address;
  private readonly rpcProviderId: string;

  constructor(options: PancakeSmartRouterQuoteProviderOptions) {
    if (!options.rpcUrl) throw new Error("BSC_RPC_URL_REQUIRED");
    this.client = createPublicClient({ chain: BSC, transport: http(options.rpcUrl) });
    this.expectedRouter = getAddress(options.expectedRouter ?? PANCAKESWAP_V3_BSC.swapRouterV3);
    this.expectedQuoter = getAddress(options.expectedQuoter ?? PANCAKESWAP_V3_BSC.quoterV2);
    this.expectedFactory = getAddress(options.expectedFactory ?? PANCAKESWAP_V3_BSC.factory);
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
    if (input.amountIn <= 0n) throw new Error("PANCAKE_V3_AMOUNT_IN_REQUIRED");
    if (!Number.isInteger(input.maxSlippageBps) || input.maxSlippageBps < 0 || input.maxSlippageBps > 10_000) {
      throw new Error("PANCAKE_V3_INVALID_SLIPPAGE");
    }
    const expiryMs = Date.parse(input.expiresAt);
    const quotedAtMs = Date.now();
    if (!Number.isFinite(expiryMs) || expiryMs <= quotedAtMs) throw new Error("PANCAKE_V3_INVALID_EXPIRY");

    const chainId = await this.client.getChainId();
    if (chainId !== 56) throw new Error(`PANCAKE_V3_WRONG_CHAIN:${chainId}`);

    const tokenIn = getAddress(input.tokenIn);
    const tokenOut = getAddress(input.tokenOut);
    const requestedPool = getAddress(input.pool);
    const quoteBlock = await this.client.getBlock({ blockTag: "latest" });
    if (quoteBlock.number === null || quoteBlock.hash === null) throw new Error("PANCAKE_V3_QUOTE_BLOCK_UNAVAILABLE");

    const [resolvedPool, routerCode, quoterCode] = await Promise.all([
      this.client.readContract({
        address: this.expectedFactory,
        abi: FACTORY_ABI,
        functionName: "getPool",
        args: [tokenIn, tokenOut, input.feeTier],
        blockNumber: quoteBlock.number
      }),
      this.client.getBytecode({ address: this.expectedRouter, blockNumber: quoteBlock.number }),
      this.client.getBytecode({ address: this.expectedQuoter, blockNumber: quoteBlock.number })
    ]);
    if (getAddress(resolvedPool) !== requestedPool) {
      throw new Error(`PANCAKE_V3_POOL_IDENTITY_MISMATCH:${getAddress(resolvedPool)}:${requestedPool}`);
    }
    if (!routerCode || routerCode === "0x") throw new Error("PANCAKE_V3_SWAP_ROUTER_CODE_MISSING");
    if (!quoterCode || quoterCode === "0x") throw new Error("PANCAKE_V3_QUOTER_CODE_MISSING");

    const quoteCalldata = encodeFunctionData({
      abi: QUOTER_V2_ABI,
      functionName: "quoteExactInputSingle",
      args: [{
        tokenIn,
        tokenOut,
        amountIn: input.amountIn,
        fee: input.feeTier,
        sqrtPriceLimitX96: 0n
      }]
    });
    const quoteCall = await this.client.call({
      to: this.expectedQuoter,
      data: quoteCalldata,
      blockNumber: quoteBlock.number
    });
    if (!quoteCall.data) throw new Error("PANCAKE_V3_QUOTER_EMPTY_RESPONSE");
    const decoded = decodeFunctionResult({
      abi: QUOTER_V2_ABI,
      functionName: "quoteExactInputSingle",
      data: quoteCall.data
    });
    const [expectedAmountOut, sqrtPriceX96After, initializedTicksCrossed, gasEstimate] = decoded;
    if (expectedAmountOut <= 0n) throw new Error("PANCAKE_V3_ZERO_QUOTED_OUTPUT");

    const amountOutMinimum = applySlippageFloor(expectedAmountOut, input.maxSlippageBps);
    const deadline = BigInt(Math.floor(expiryMs / 1000));
    const calldata = encodeFunctionData({
      abi: SWAP_ROUTER_V3_ABI,
      functionName: "exactInputSingle",
      args: [{
        tokenIn,
        tokenOut,
        fee: input.feeTier,
        recipient: getAddress(input.recipient),
        deadline,
        amountIn: input.amountIn,
        amountOutMinimum,
        sqrtPriceLimitX96: 0n
      }]
    }) as Hex;

    const quotedAt = new Date(quotedAtMs).toISOString();
    const routeRef = [
      "pancakeswap-v3-direct",
      "chain:56",
      `quoteBlock:${quoteBlock.number.toString()}`,
      `quoteBlockHash:${quoteBlock.hash}`,
      `factory:${this.expectedFactory}`,
      `quoter:${this.expectedQuoter}`,
      `router:${this.expectedRouter}`,
      `pool:${requestedPool}`,
      `fee:${input.feeTier}`,
      `tokenIn:${tokenIn}`,
      `tokenOut:${tokenOut}`,
      `amountIn:${input.amountIn.toString()}`,
      `quotedAmountOut:${expectedAmountOut.toString()}`,
      `amountOutMinimum:${amountOutMinimum.toString()}`,
      `rpc:${this.rpcProviderId}`
    ].join("|");

    return {
      quoteId: `pancake-v3-direct:${quoteBlock.number.toString()}:${input.amountIn.toString()}:${expectedAmountOut.toString()}`,
      quotedAt,
      expiresAt: input.expiresAt,
      router: this.expectedRouter,
      tokenIn,
      tokenOut,
      amountIn: input.amountIn,
      expectedAmountOut,
      calldata,
      value: 0n,
      gasEstimate,
      routeRef,
      evidenceRefs: [
        `pancakeswap-v3:factory:${this.expectedFactory}:block:${quoteBlock.number.toString()}`,
        `pancakeswap-v3:quoter-v2:${this.expectedQuoter}:block:${quoteBlock.number.toString()}`,
        `pancakeswap-v3:swap-router:${this.expectedRouter}:block:${quoteBlock.number.toString()}`,
        `pancakeswap-v3:pool:${requestedPool}:block:${quoteBlock.number.toString()}`,
        `pancakeswap-v3:quoted-sqrt-after:${sqrtPriceX96After.toString()}`,
        `pancakeswap-v3:initialized-ticks-crossed:${initializedTicksCrossed.toString()}`
      ]
    };
  }
}
