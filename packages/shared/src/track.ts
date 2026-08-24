import { z } from "zod";
import { marketplaceCategorySchema } from "./category.js";
import { bscActivationProofSchema } from "./routing.js";

const freshnessSchema = z.object({
  observedAt: z.string(),
  source: z.string(),
  blockNumber: z.number().optional(),
  maxAgeSeconds: z.number().positive().optional()
});

export const rebalancingDecisionDataSchema = z.object({
  category: z.literal("rebalancing"),
  venue: z.string(),
  positionRef: z.string().optional(),
  currentAllocation: z.record(z.string(), z.number()),
  targetAllocation: z.record(z.string(), z.number()),
  driftBps: z.number(),
  estimatedExecutionCost: z.number().nonnegative(),
  estimatedSlippageBps: z.number().nonnegative(),
  expectedNetBenefit: z.number().optional(),
  freshness: freshnessSchema
});

export const gridTradingDecisionDataSchema = z.object({
  category: z.literal("grid-trading"),
  venue: z.string(),
  pair: z.string(),
  lowerBound: z.number(),
  upperBound: z.number(),
  levels: z.number().int().positive(),
  inventoryValue: z.number().nonnegative().optional(),
  realizedPnl: z.number().optional(),
  drawdownBps: z.number().nonnegative().optional(),
  fillRate: z.number().min(0).max(1).optional(),
  feeRateBps: z.number().nonnegative().optional(),
  freshness: freshnessSchema
});

export const yieldOptimisationDecisionDataSchema = z.object({
  category: z.literal("yield-optimisation"),
  protocol: z.string(),
  asset: z.string(),
  currentNetApy: z.number(),
  projectedNetApy: z.number(),
  switchingCost: z.number().nonnegative(),
  liquidityAvailable: z.number().nonnegative().optional(),
  lockupSeconds: z.number().nonnegative().optional(),
  riskFlags: z.array(z.string()).default([]),
  freshness: freshnessSchema
});

export const healthFactorDecisionDataSchema = z.object({
  category: z.literal("health-factor-monitoring"),
  protocol: z.string(),
  account: z.string(),
  healthFactor: z.number(),
  liquidationThreshold: z.number().optional(),
  collateralValue: z.number().nonnegative().optional(),
  debtValue: z.number().nonnegative().optional(),
  distanceToLiquidationBps: z.number().optional(),
  recommendedAction: z.string().optional(),
  estimatedActionCost: z.number().nonnegative().optional(),
  freshness: freshnessSchema
});

export const trackDecisionDataSchema = z.discriminatedUnion("category", [
  rebalancingDecisionDataSchema,
  gridTradingDecisionDataSchema,
  yieldOptimisationDecisionDataSchema,
  healthFactorDecisionDataSchema
]);

export const trackQualificationStatusSchema = z.enum(["qualified", "partial", "failed"]);

export const trackQualificationSchema = z.object({
  agentId: z.string(),
  category: marketplaceCategorySchema,
  evaluatedAt: z.string(),
  status: trackQualificationStatusSchema,
  identityVerified: z.boolean(),
  live: z.boolean(),
  capabilityVerified: z.boolean(),
  decisionDataComplete: z.boolean(),
  decisionDataFresh: z.boolean(),
  bscActivation: bscActivationProofSchema.optional(),
  executionVerified: z.boolean().default(false),
  missing: z.array(z.string()).default([]),
  evidenceRefs: z.array(z.string()).default([])
});

export const trackListingSchema = z.object({
  agentId: z.string(),
  category: marketplaceCategorySchema,
  decisionData: trackDecisionDataSchema,
  qualification: trackQualificationSchema
});

export type TrackDecisionData = z.infer<typeof trackDecisionDataSchema>;
export type TrackQualification = z.infer<typeof trackQualificationSchema>;
export type TrackListing = z.infer<typeof trackListingSchema>;
