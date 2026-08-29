import {
  encodeFunctionData,
  getAddress,
  keccak256,
  toHex,
  type Address,
  type Hex
} from "viem";
import {
  computePreparedActionAuthorizationCommitment,
  PREPARED_ACTION_AUTHORIZATION_COMMITMENT_VERSION,
  type PreparedAction,
  type PreparedCall,
  type PreparedSpendBound,
  type StrategyProposal
} from "@kumo/financial-agent-kernel";
import { chooseCenteredTicks } from "./economics.js";
import { getV3PositionPrincipalAmounts } from "./v3-math.js";
import type { PancakeV3LivePreparationSuccess } from "./live-preparation.js";
import { PANCAKESWAP_V3_BSC } from "./pancakeswap-v3.js";
import type { RebalancePolicy } from "./types.js";

const Q192 = 1n << 192n;
const MAX_UINT128 = (1n << 128n) - 1n;

const NPM_ABI = [
  {
    type: "function",
    name: "decreaseLiquidity",
    stateMutability: "payable",
    inputs: [{
      name: "params",
      type: "tuple",
      components: [
        { name: "tokenId", type: "uint256" },
        { name: "liquidity", type: "uint128" },
        { name: "amount0Min", type: "uint256" },
        { name: "amount1Min", type: "uint256" },
        { name: "deadline", type: "uint256" }
      ]
    }],
    outputs: [
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" }
    ]
  },
  {
    type: "function",
    name: "collect",
    stateMutability: "payable",
    inputs: [{
      name: "params",
      type: "tuple",
      components: [
        { name: "tokenId", type: "uint256" },
        { name: "recipient", type: "address" },
        { name: "amount0Max", type: "uint128" },
        { name: "amount1Max", type: "uint128" }
      ]
    }],
    outputs: [
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" }
    ]
  },
  {
    type: "function",
    name: "mint",
    stateMutability: "payable",
    inputs: [{
      name: "params",
      type: "tuple",
      components: [
        { name: "token0", type: "address" },
        { name: "token1", type: "address" },
        { name: "fee", type: "uint24" },
        { name: "tickLower", type: "int24" },
        { name: "tickUpper", type: "int24" },
        { name: "amount0Desired", type: "uint256" },
        { name: "amount1Desired", type: "uint256" },
        { name: "amount0Min", type: "uint256" },
        { name: "amount1Min", type: "uint256" },
        { name: "recipient", type: "address" },
        { name: "deadline", type: "uint256" }
      ]
    }],
    outputs: [
      { name: "tokenId", type: "uint256" },
      { name: "liquidity", type: "uint128" },
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" }
    ]
  }
] as const;

const ERC20_APPROVAL_ABI = [{
  type: "function",
  name: "approve",
  stateMutability: "nonpayable",
  inputs: [
    { name: "spender", type: "address" },
    { name: "amount", type: "uint256" }
  ],
  outputs: [{ name: "", type: "bool" }]
}] as const;

export interface PancakeV3ExactInputSwapQuote {
  quoteId: string;
  quotedAt: string;
  expiresAt: string;
  router: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  expectedAmountOut: bigint;
  calldata: Hex;
  value: bigint;
  gasEstimate?: bigint;
  routeRef: string;
  evidenceRefs?: string[];
}

export interface PancakeV3SwapQuoteProvider {
  readonly id: string;
  quoteExactInput(input: {
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
  }): Promise<PancakeV3ExactInputSwapQuote>;
}

export interface RebalanceCompositionPlan {
  targetTickLower: number;
  targetTickUpper: number;
  available0Raw: bigint;
  available1Raw: bigint;
  desired0RawBeforeSwap: bigint;
  desired1RawBeforeSwap: bigint;
  swapDirection: "TOKEN0_TO_TOKEN1" | "TOKEN1_TO_TOKEN0" | "NONE";
  swapAmountInRaw: bigint;
}

function applyBpsFloor(amount: bigint, bps: number): bigint {
  if (!Number.isFinite(bps) || bps < 0 || bps > 10_000) throw new Error(`INVALID_BPS:${bps}`);
  const keep = BigInt(Math.floor(10_000 - bps));
  return amount * keep / 10_000n;
}

export function planRebalanceComposition(input: {
  prepared: PancakeV3LivePreparationSuccess;
  policy: RebalancePolicy;
  tickSpacing?: number;
}): RebalanceCompositionPlan {
  const snapshot = input.prepared.snapshot;
  const target = chooseCenteredTicks({
    currentTick: snapshot.currentTick,
    targetRangeWidthBps: input.policy.targetRangeWidthBps,
    tickSpacing: input.tickSpacing
  });

  const available0Raw = input.prepared.valuation.principalAmount0Raw + snapshot.tokensOwed0;
  const available1Raw = input.prepared.valuation.principalAmount1Raw + snapshot.tokensOwed1;
  const targetAtCurrentLiquidity = getV3PositionPrincipalAmounts({
    liquidity: snapshot.positionLiquidity,
    tickLower: target.tickLower,
    tickUpper: target.tickUpper,
    currentTick: snapshot.currentTick,
    sqrtPriceX96: snapshot.sqrtPriceX96
  });

  const priceNumerator = snapshot.sqrtPriceX96 * snapshot.sqrtPriceX96;
  const availableValueInToken1Q192 = available1Raw * Q192 + available0Raw * priceNumerator;
  const targetUnitValueInToken1Q192 = targetAtCurrentLiquidity.amount1Raw * Q192
    + targetAtCurrentLiquidity.amount0Raw * priceNumerator;
  if (targetUnitValueInToken1Q192 <= 0n) throw new Error("TARGET_COMPOSITION_ZERO_VALUE");

  const desired0RawBeforeSwap = targetAtCurrentLiquidity.amount0Raw
    * availableValueInToken1Q192 / targetUnitValueInToken1Q192;
  const desired1RawBeforeSwap = targetAtCurrentLiquidity.amount1Raw
    * availableValueInToken1Q192 / targetUnitValueInToken1Q192;

  if (available0Raw > desired0RawBeforeSwap) {
    return { targetTickLower: target.tickLower, targetTickUpper: target.tickUpper, available0Raw, available1Raw, desired0RawBeforeSwap, desired1RawBeforeSwap, swapDirection: "TOKEN0_TO_TOKEN1", swapAmountInRaw: available0Raw - desired0RawBeforeSwap };
  }
  if (available1Raw > desired1RawBeforeSwap) {
    return { targetTickLower: target.tickLower, targetTickUpper: target.tickUpper, available0Raw, available1Raw, desired0RawBeforeSwap, desired1RawBeforeSwap, swapDirection: "TOKEN1_TO_TOKEN0", swapAmountInRaw: available1Raw - desired1RawBeforeSwap };
  }
  return { targetTickLower: target.tickLower, targetTickUpper: target.tickUpper, available0Raw, available1Raw, desired0RawBeforeSwap, desired1RawBeforeSwap, swapDirection: "NONE", swapAmountInRaw: 0n };
}

function approvalCalls(input: { calls: PreparedCall[]; token: Address; spender: Address; amount: bigint; label: string }): void {
  if (input.amount <= 0n) return;
  input.calls.push({ order: input.calls.length, kind: "approval-reset", label: `Reset ${input.label} allowance`, to: input.token, data: encodeFunctionData({ abi: ERC20_APPROVAL_ABI, functionName: "approve", args: [input.spender, 0n] }), value: "0", asset: input.token, amount: "0", spender: input.spender });
  input.calls.push({ order: input.calls.length, kind: "approval", label: `Set exact ${input.label} allowance`, to: input.token, data: encodeFunctionData({ abi: ERC20_APPROVAL_ABI, functionName: "approve", args: [input.spender, input.amount] }), value: "0", asset: input.token, amount: input.amount.toString(), spender: input.spender });
}

function revokeCall(input: { calls: PreparedCall[]; token: Address; spender: Address; label: string }): void {
  input.calls.push({ order: input.calls.length, kind: "approval-revoke", label: `Revoke ${input.label} allowance`, to: input.token, data: encodeFunctionData({ abi: ERC20_APPROVAL_ABI, functionName: "approve", args: [input.spender, 0n] }), value: "0", asset: input.token, amount: "0", spender: input.spender });
}

function executionCommitment(input: { proposalId: string; marketSnapshotRoot: string; evidenceSnapshotRoot: string; expiresAt: string; calls: PreparedCall[] }): Hex {
  const canonical = JSON.stringify({
    proposalId: input.proposalId,
    marketSnapshotRoot: input.marketSnapshotRoot,
    evidenceSnapshotRoot: input.evidenceSnapshotRoot,
    expiresAt: input.expiresAt,
    calls: input.calls.map((call) => ({ order: call.order, kind: call.kind, label: call.label, to: call.to.toLowerCase(), data: call.data.toLowerCase(), value: call.value, asset: call.asset?.toLowerCase(), amount: call.amount, spender: call.spender?.toLowerCase() }))
  });
  return keccak256(toHex(canonical));
}

export class PancakeV3UnsignedTransactionPreparer {
  readonly id = "kumo-pancake-v3-unsigned-transaction-preparer-v1";
  constructor(private readonly swapQuoteProvider: PancakeV3SwapQuoteProvider) {}

  async prepare(input: { prepared: PancakeV3LivePreparationSuccess; proposal: StrategyProposal; policy: RebalancePolicy; tickSpacing?: number }): Promise<PreparedAction> {
    if (input.proposal.disposition !== "propose") throw new Error("STRATEGY_REFUSED_ACTION");
    if (input.prepared.snapshot.chainId !== 56) throw new Error("REBALANCER_PREPARE_WRONG_CHAIN");
    if (input.proposal.marketSnapshotRoot.length === 0) throw new Error("MARKET_SNAPSHOT_ROOT_REQUIRED");

    const snapshot = input.prepared.snapshot;
    const owner = getAddress(snapshot.owner);
    const token0 = getAddress(snapshot.token0);
    const token1 = getAddress(snapshot.token1);
    const npm = getAddress(PANCAKESWAP_V3_BSC.nonfungiblePositionManager);
    const composition = planRebalanceComposition({ prepared: input.prepared, policy: input.policy, tickSpacing: input.tickSpacing });
    const now = Date.now();
    const proposalExpiry = Date.parse(input.proposal.expiresAt);
    if (!Number.isFinite(proposalExpiry) || proposalExpiry <= now) throw new Error("PROPOSAL_EXPIRED");
    const expiresAtMs = Math.min(proposalExpiry, now + input.policy.quoteTtlSeconds * 1000);
    const expiresAt = new Date(expiresAtMs).toISOString();
    const deadline = BigInt(Math.floor(expiresAtMs / 1000));

    const calls: PreparedCall[] = [];
    const decreaseAmount0Min = applyBpsFloor(input.prepared.valuation.principalAmount0Raw, input.policy.maxSlippageBps);
    const decreaseAmount1Min = applyBpsFloor(input.prepared.valuation.principalAmount1Raw, input.policy.maxSlippageBps);
    calls.push({ order: calls.length, kind: "protocol", label: `Remove all liquidity from Pancake V3 position ${snapshot.tokenId}`, to: npm, data: encodeFunctionData({ abi: NPM_ABI, functionName: "decreaseLiquidity", args: [{ tokenId: BigInt(snapshot.tokenId), liquidity: snapshot.positionLiquidity, amount0Min: decreaseAmount0Min, amount1Min: decreaseAmount1Min, deadline }] }), value: "0" });
    calls.push({ order: calls.length, kind: "protocol", label: `Collect principal and fees from position ${snapshot.tokenId}`, to: npm, data: encodeFunctionData({ abi: NPM_ABI, functionName: "collect", args: [{ tokenId: BigInt(snapshot.tokenId), recipient: owner, amount0Max: MAX_UINT128, amount1Max: MAX_UINT128 }] }), value: "0" });

    let expectedPostSwap0 = composition.available0Raw;
    let expectedPostSwap1 = composition.available1Raw;
    let swapQuote: PancakeV3ExactInputSwapQuote | undefined;
    if (composition.swapDirection !== "NONE" && composition.swapAmountInRaw > 0n) {
      const tokenIn = composition.swapDirection === "TOKEN0_TO_TOKEN1" ? token0 : token1;
      const tokenOut = composition.swapDirection === "TOKEN0_TO_TOKEN1" ? token1 : token0;
      const tokenInDecimals = composition.swapDirection === "TOKEN0_TO_TOKEN1" ? snapshot.token0Decimals : snapshot.token1Decimals;
      const tokenOutDecimals = composition.swapDirection === "TOKEN0_TO_TOKEN1" ? snapshot.token1Decimals : snapshot.token0Decimals;
      swapQuote = await this.swapQuoteProvider.quoteExactInput({ tokenIn, tokenOut, tokenInDecimals, tokenOutDecimals, amountIn: composition.swapAmountInRaw, recipient: owner, maxSlippageBps: input.policy.maxSlippageBps, expiresAt, pool: snapshot.pool, feeTier: snapshot.fee, sqrtPriceX96: snapshot.sqrtPriceX96, poolLiquidity: snapshot.poolLiquidity, currentTick: snapshot.currentTick });
      if (swapQuote.amountIn !== composition.swapAmountInRaw) throw new Error("SWAP_QUOTE_AMOUNT_MISMATCH");
      if (getAddress(swapQuote.tokenIn) !== tokenIn || getAddress(swapQuote.tokenOut) !== tokenOut) throw new Error("SWAP_QUOTE_ASSET_MISMATCH");
      if (Date.parse(swapQuote.expiresAt) > expiresAtMs) throw new Error("SWAP_QUOTE_EXPIRY_EXCEEDS_ACTION");
      const router = getAddress(swapQuote.router);
      approvalCalls({ calls, token: tokenIn, spender: router, amount: composition.swapAmountInRaw, label: "Pancake swap" });
      calls.push({ order: calls.length, kind: "swap", label: `Swap exact ${composition.swapAmountInRaw.toString()} raw units for target LP composition`, to: router, data: swapQuote.calldata, value: swapQuote.value.toString(), asset: tokenIn, amount: composition.swapAmountInRaw.toString(), spender: router });
      revokeCall({ calls, token: tokenIn, spender: router, label: "Pancake swap" });
      if (composition.swapDirection === "TOKEN0_TO_TOKEN1") { expectedPostSwap0 -= composition.swapAmountInRaw; expectedPostSwap1 += swapQuote.expectedAmountOut; }
      else { expectedPostSwap1 -= composition.swapAmountInRaw; expectedPostSwap0 += swapQuote.expectedAmountOut; }
    }

    const mintAmount0Min = applyBpsFloor(expectedPostSwap0, input.policy.maxSlippageBps);
    const mintAmount1Min = applyBpsFloor(expectedPostSwap1, input.policy.maxSlippageBps);
    approvalCalls({ calls, token: token0, spender: npm, amount: expectedPostSwap0, label: "Pancake V3 mint token0" });
    approvalCalls({ calls, token: token1, spender: npm, amount: expectedPostSwap1, label: "Pancake V3 mint token1" });
    calls.push({ order: calls.length, kind: "protocol", label: `Mint replacement Pancake V3 range ${composition.targetTickLower}:${composition.targetTickUpper}`, to: npm, data: encodeFunctionData({ abi: NPM_ABI, functionName: "mint", args: [{ token0, token1, fee: snapshot.fee, tickLower: composition.targetTickLower, tickUpper: composition.targetTickUpper, amount0Desired: expectedPostSwap0, amount1Desired: expectedPostSwap1, amount0Min: mintAmount0Min, amount1Min: mintAmount1Min, recipient: owner, deadline }] }), value: "0" });
    revokeCall({ calls, token: token0, spender: npm, label: "Pancake V3 mint token0" });
    revokeCall({ calls, token: token1, spender: npm, label: "Pancake V3 mint token1" });

    const spendBounds: PreparedSpendBound[] = [
      ...(swapQuote ? [{ asset: swapQuote.tokenIn, maxAmount: swapQuote.amountIn.toString(), spender: swapQuote.router, purpose: "Exact-input composition swap" }] : []),
      ...(expectedPostSwap0 > 0n ? [{ asset: token0, maxAmount: expectedPostSwap0.toString(), spender: npm, purpose: "Replacement V3 mint token0" }] : []),
      ...(expectedPostSwap1 > 0n ? [{ asset: token1, maxAmount: expectedPostSwap1.toString(), spender: npm, purpose: "Replacement V3 mint token1" }] : [])
    ];
    const commitment = executionCommitment({ proposalId: input.proposal.id, marketSnapshotRoot: input.proposal.marketSnapshotRoot, evidenceSnapshotRoot: input.proposal.evidenceSnapshotRoot, expiresAt, calls });
    const baseAction = {
      id: `prepared:${input.proposal.id}:${commitment.slice(2, 18)}`,
      proposalId: input.proposal.id,
      quoteId: swapQuote?.quoteId,
      executionChainId: 56,
      signer: owner,
      createdAt: new Date(now).toISOString(),
      expiresAt,
      marketSnapshotRoot: input.proposal.marketSnapshotRoot,
      evidenceSnapshotRoot: input.proposal.evidenceSnapshotRoot,
      executionCommitment: commitment,
      atomic: false,
      signingStatus: "UNSIGNED" as const,
      simulationStatus: "NOT_RUN" as const,
      calls,
      spendBounds,
      evidenceRefs: [...input.prepared.evidenceRefs, ...(swapQuote?.evidenceRefs ?? []), ...(swapQuote ? [swapQuote.routeRef] : [])],
      limitations: [
        "This PreparedAction is unsigned and creates no execution authority.",
        "The call sequence is ordered and non-atomic; a later canary/fork simulation is required before authority is granted.",
        "Fee inventory includes only directly evidenced tokensOwed values; uncrystallized feeGrowth-derived fees are not reconstructed yet.",
        "Expected post-swap balances are based on the quoted output; positive residual balances may remain after mint.",
        "Any material state or quote drift requires invalidating this action and preparing a new authorization commitment."
      ]
    };
    const authorizationCommitment = computePreparedActionAuthorizationCommitment(baseAction);
    return {
      ...baseAction,
      authorizationCommitmentVersion: PREPARED_ACTION_AUTHORIZATION_COMMITMENT_VERSION,
      authorizationCommitment
    };
  }
}
