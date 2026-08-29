import { z } from "zod";
import { marketplaceCategorySchema } from "@kumo/shared";

const scalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const hexDataSchema = z.string().regex(/^0x[0-9a-fA-F]*$/);
const evmAddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

export const kernelModeSchema = z.enum(["recommend", "shadow", "execute"]);
export const evidenceKindSchema = z.enum([
  "observation",
  "source-assertion",
  "inference",
  "assumption",
  "hypothesis"
]);

export const observationSnapshotSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  category: marketplaceCategorySchema,
  observedAt: z.string(),
  chainId: z.number().optional(),
  marketSnapshotRoot: z.string(),
  values: z.record(z.string(), scalarSchema).default({}),
  evidenceRefs: z.array(z.string()).default([])
});

export const evidenceClaimSchema = z.object({
  id: z.string(),
  kind: evidenceKindSchema,
  statement: z.string(),
  supportRefs: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).optional()
});

export const evidencePacketSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  category: marketplaceCategorySchema,
  createdAt: z.string(),
  evidenceRoot: z.string(),
  claims: z.array(evidenceClaimSchema).default([]),
  sourceRefs: z.array(z.string()).default([])
});

export const strategyProposalSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  category: marketplaceCategorySchema,
  mode: kernelModeSchema,
  createdAt: z.string(),
  expiresAt: z.string(),
  objective: z.string(),
  action: z.string(),
  disposition: z.enum(["propose", "refuse"]),
  rationale: z.string(),
  expectedNetBenefit: z.number().optional(),
  estimatedCost: z.number().nonnegative().optional(),
  riskScore: z.number().min(0).max(1).optional(),
  evidencePacketRef: z.string(),
  evidenceSnapshotRoot: z.string(),
  marketSnapshotRoot: z.string(),
  refusalReasons: z.array(z.string()).default([])
});

export const executableQuoteSchema = z.object({
  id: z.string(),
  proposalId: z.string(),
  quotedAt: z.string(),
  expiresAt: z.string(),
  chainId: z.number(),
  venue: z.string(),
  totalCost: z.number().nonnegative(),
  slippageBps: z.number().nonnegative().optional(),
  gasCost: z.number().nonnegative().optional(),
  bridgeCost: z.number().nonnegative().optional(),
  amountIn: z.string().optional(),
  expectedAmountOut: z.string().optional(),
  inputAsset: z.string().optional(),
  outputAsset: z.string().optional(),
  liquidityScore: z.number().min(0).max(1).optional(),
  quoteRef: z.string().optional(),
  marketSnapshotRoot: z.string()
});

export const preparedCallKindSchema = z.enum([
  "approval-reset",
  "approval",
  "protocol",
  "swap",
  "approval-revoke"
]);

export const preparedCallSchema = z.object({
  order: z.number().int().nonnegative(),
  kind: preparedCallKindSchema,
  label: z.string(),
  to: evmAddressSchema,
  data: hexDataSchema,
  value: z.string().regex(/^\d+$/),
  asset: evmAddressSchema.optional(),
  amount: z.string().regex(/^\d+$/).optional(),
  spender: evmAddressSchema.optional()
});

export const preparedSpendBoundSchema = z.object({
  asset: evmAddressSchema,
  maxAmount: z.string().regex(/^\d+$/),
  spender: evmAddressSchema,
  purpose: z.string()
});

export const preparedActionSchema = z.object({
  id: z.string(),
  proposalId: z.string(),
  quoteId: z.string().optional(),
  executionChainId: z.number(),
  signer: evmAddressSchema,
  createdAt: z.string(),
  expiresAt: z.string(),
  marketSnapshotRoot: z.string(),
  evidenceSnapshotRoot: z.string(),
  executionCommitment: hexDataSchema,
  authorizationCommitmentVersion: z.literal("kumo-prepared-action-authorization-v2"),
  authorizationCommitment: hexDataSchema,
  atomic: z.boolean(),
  signingStatus: z.literal("UNSIGNED"),
  simulationStatus: z.enum(["NOT_RUN", "PASSED", "FAILED"]),
  calls: z.array(preparedCallSchema).min(1),
  spendBounds: z.array(preparedSpendBoundSchema).default([]),
  evidenceRefs: z.array(z.string()).default([]),
  limitations: z.array(z.string()).default([])
});

export const kernelRiskPolicySchema = z.object({
  maxObservationAgeSeconds: z.number().positive(),
  maxSlippageBps: z.number().nonnegative().optional(),
  maxEstimatedCost: z.number().nonnegative().optional(),
  minExpectedNetBenefit: z.number().optional(),
  maxRiskScore: z.number().min(0).max(1).optional(),
  requireQuoteForShadow: z.boolean().default(true),
  requireCanaryForExecute: z.boolean().default(true)
});

export const readinessStateSchema = z.enum(["ready", "refused", "stale", "blocked"]);
export const executionReadinessSchema = z.object({
  proposalId: z.string(),
  quoteId: z.string().optional(),
  evaluatedAt: z.string(),
  state: readinessStateSchema,
  eligible: z.boolean(),
  reasons: z.array(z.string()).default([])
});

export const canaryResultSchema = z.object({
  passed: z.boolean(),
  checkedAt: z.string(),
  ref: z.string().optional(),
  detail: z.string().optional()
});

export const executionReceiptSchema = z.object({
  id: z.string(),
  proposalId: z.string(),
  taskId: z.string().optional(),
  startedAt: z.string(),
  completedAt: z.string(),
  status: z.enum(["succeeded", "failed", "partial", "cancelled"]),
  transactionRefs: z.array(z.string()).default([]),
  costs: z.record(z.string(), z.number()).default({}),
  outputs: z.record(z.string(), scalarSchema).default({}),
  evidenceRefs: z.array(z.string()).default([]),
  failureReason: z.string().optional()
});

export const outcomeRecordSchema = z.object({
  id: z.string(),
  proposalId: z.string(),
  receiptId: z.string(),
  measuredAt: z.string(),
  windowStartedAt: z.string().optional(),
  windowEndedAt: z.string().optional(),
  baselineRef: z.string().optional(),
  outcome: z.enum(["beneficial", "neutral", "harmful", "undetermined"]),
  metrics: z.record(z.string(), scalarSchema).default({}),
  evidenceRefs: z.array(z.string()).default([])
});

export type KernelMode = z.infer<typeof kernelModeSchema>;
export type ObservationSnapshot = z.infer<typeof observationSnapshotSchema>;
export type EvidencePacket = z.infer<typeof evidencePacketSchema>;
export type StrategyProposal = z.infer<typeof strategyProposalSchema>;
export type ExecutableQuote = z.infer<typeof executableQuoteSchema>;
export type PreparedCall = z.infer<typeof preparedCallSchema>;
export type PreparedSpendBound = z.infer<typeof preparedSpendBoundSchema>;
export type PreparedAction = z.infer<typeof preparedActionSchema>;
export type KernelRiskPolicy = z.infer<typeof kernelRiskPolicySchema>;
export type ExecutionReadiness = z.infer<typeof executionReadinessSchema>;
export type CanaryResult = z.infer<typeof canaryResultSchema>;
export type ExecutionReceipt = z.infer<typeof executionReceiptSchema>;
export type OutcomeRecord = z.infer<typeof outcomeRecordSchema>;
