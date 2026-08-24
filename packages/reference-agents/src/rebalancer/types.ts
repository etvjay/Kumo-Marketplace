import { z } from "zod";

export const rebalancerPositionSchema = z.object({
  chainId: z.number(),
  venue: z.literal("pancakeswap-v3"),
  positionId: z.string(),
  token0: z.string(),
  token1: z.string(),
  feeTier: z.number().int().nonnegative(),
  tickLower: z.number().int(),
  tickUpper: z.number().int(),
  currentTick: z.number().int(),
  amount0: z.number().nonnegative(),
  amount1: z.number().nonnegative(),
  valueUsd: z.number().nonnegative(),
  uncollectedFeesUsd: z.number().nonnegative(),
  inRange: z.boolean(),
  observedAt: z.string(),
  blockNumber: z.number().int().nonnegative().optional()
});

export const rebalancerMarketStateSchema = z.object({
  chainId: z.number(),
  venue: z.literal("pancakeswap-v3"),
  poolAddress: z.string(),
  token0PriceUsd: z.number().positive(),
  token1PriceUsd: z.number().positive(),
  spotPrice: z.number().positive(),
  realizedVolatilityAnnualized: z.number().nonnegative().optional(),
  liquidityUsd: z.number().nonnegative(),
  volume24hUsd: z.number().nonnegative().optional(),
  feeAprEstimate: z.number().optional(),
  gasPriceGwei: z.number().nonnegative().optional(),
  observedAt: z.string(),
  blockNumber: z.number().int().nonnegative().optional()
});

export const rebalancePolicySchema = z.object({
  targetRangeWidthBps: z.number().positive(),
  edgeBufferBps: z.number().nonnegative(),
  minDriftBps: z.number().nonnegative(),
  minExpectedNetBenefitUsd: z.number(),
  maxSlippageBps: z.number().nonnegative(),
  maxGasCostUsd: z.number().nonnegative(),
  maxTotalExecutionCostUsd: z.number().nonnegative(),
  maxPositionValueUsd: z.number().positive().optional(),
  minPoolLiquidityUsd: z.number().nonnegative(),
  maxVolatilityAnnualized: z.number().nonnegative().optional(),
  allowOutOfRangeImmediateRecenter: z.boolean().default(true),
  observationMaxAgeSeconds: z.number().positive(),
  proposalTtlSeconds: z.number().positive(),
  quoteTtlSeconds: z.number().positive()
});

export const rebalanceEconomicsSchema = z.object({
  currentMidTick: z.number().int(),
  targetTickLower: z.number().int(),
  targetTickUpper: z.number().int(),
  distanceToNearestEdgeBps: z.number(),
  centerDriftBps: z.number(),
  estimatedFeeImprovementUsd: z.number(),
  estimatedImpermanentLossDeltaUsd: z.number(),
  estimatedGasCostUsd: z.number().nonnegative(),
  estimatedSlippageCostUsd: z.number().nonnegative(),
  estimatedBridgeCostUsd: z.number().nonnegative().default(0),
  estimatedTotalCostUsd: z.number().nonnegative(),
  expectedNetBenefitUsd: z.number(),
  shouldRebalance: z.boolean(),
  reasons: z.array(z.string()).default([])
});

export const rebalanceQuoteSchema = z.object({
  quoteId: z.string(),
  quotedAt: z.string(),
  expiresAt: z.string(),
  positionId: z.string(),
  removeLiquidityCallRef: z.string(),
  collectFeesCallRef: z.string(),
  swapCallRef: z.string().optional(),
  mintCallRef: z.string(),
  expectedAmount0: z.string().optional(),
  expectedAmount1: z.string().optional(),
  slippageBps: z.number().nonnegative(),
  gasCostUsd: z.number().nonnegative(),
  totalCostUsd: z.number().nonnegative(),
  atomic: z.boolean(),
  scopedApprovalAmount0: z.string().optional(),
  scopedApprovalAmount1: z.string().optional(),
  rawQuoteRef: z.string().optional()
});

export const rebalancerOutcomeMetricsSchema = z.object({
  positionValueBeforeUsd: z.number().nonnegative(),
  positionValueAfterUsd: z.number().nonnegative(),
  feesEarnedUsd: z.number(),
  gasAndExecutionCostUsd: z.number().nonnegative(),
  impermanentLossDeltaUsd: z.number(),
  inRangeFraction: z.number().min(0).max(1),
  staticBaselineValueUsd: z.number().nonnegative().optional(),
  netValueVsBaselineUsd: z.number().optional()
});

export type RebalancerPosition = z.infer<typeof rebalancerPositionSchema>;
export type RebalancerMarketState = z.infer<typeof rebalancerMarketStateSchema>;
export type RebalancePolicy = z.infer<typeof rebalancePolicySchema>;
export type RebalanceEconomics = z.infer<typeof rebalanceEconomicsSchema>;
export type RebalanceQuote = z.infer<typeof rebalanceQuoteSchema>;
export type RebalancerOutcomeMetrics = z.infer<typeof rebalancerOutcomeMetricsSchema>;
