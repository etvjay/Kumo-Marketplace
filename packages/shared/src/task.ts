import { z } from "zod";
import { agentProfileSchema } from "./agent.js";
import { marketplaceCategorySchema } from "./category.js";

export const taskKindSchema = z.enum([
  "quote-to-swap",
  "data-fetch",
  "wallet-sign",
  "gasless-transfer",
  "lend-borrow",
  "bridge",
  "agent-negotiate",
  "compute",
  "otc-deal",
  "rebalance-position",
  "grid-manage",
  "optimise-yield",
  "protect-health-factor"
]);

export const taskStatusSchema = z.enum([
  "draft",
  "posted",
  "claimed",
  "prepared",
  "approved",
  "executing",
  "succeeded",
  "failed",
  "settled",
  "refunded",
  "cancelled"
]);

export const executionPolicySchema = z.object({
  allowedProtocols: z.array(z.string()).default([]),
  allowedTokens: z.array(z.string()).default([]),
  allowedContracts: z.array(z.string()).default([]),
  allowedMethods: z.array(z.string()).default([]),
  maxSpend: z.string(),
  maxSlippageBps: z.number().min(0),
  deadline: z.string()
});

export const executionPodSchema = z.object({
  id: z.string(),
  status: z.enum(["created", "assigned", "quoted", "executing", "completed", "failed", "cancelled"]),
  assignedAt: z.string().optional(),
  assignedBy: z.string().optional(),
  assignedAgentId: z.string().optional(),
  assignedAgentProfile: agentProfileSchema.optional(),
  recipientWalletAddress: z.string().optional(),
  allowedTokens: z.array(z.string()).default([]),
  allowedProtocols: z.array(z.string()).default([]),
  maxSlippageBps: z.number().default(0),
  route: z.string().optional(),
  quoteId: z.string().optional(),
  quoteExpiresAt: z.string().optional(),
  txHash: z.string().optional(),
  failureReason: z.string().optional(),
  eventHistory: z.array(z.object({
    at: z.string(),
    type: z.string(),
    actor: z.string(),
    detail: z.string()
  })).default([]),
  reasoningTrail: z.array(z.object({
    at: z.string(),
    agentId: z.string(),
    action: z.string(),
    thought: z.string()
  })).default([]),
  receipt: z.object({
    receiptHash: z.string().optional(),
    executionRef: z.string().optional(),
    settlementRef: z.string().optional(),
    explorerUrl: z.string().optional()
  }).optional()
});

export const marketplaceTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: marketplaceCategorySchema.optional(),
  kind: taskKindSchema,
  chainId: z.number(),
  status: taskStatusSchema,
  requester: z.string(),
  createdAt: z.string(),
  objective: z.string(),
  details: z.record(z.string(), z.unknown()).default({}),
  constraints: executionPolicySchema,
  payout: z.object({ amount: z.string(), token: z.string() }).optional(),
  executionPod: executionPodSchema.nullable().default(null)
});

export type TaskKind = z.infer<typeof taskKindSchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type ExecutionPolicy = z.infer<typeof executionPolicySchema>;
export type ExecutionPod = z.infer<typeof executionPodSchema>;
export type MarketplaceTask = z.infer<typeof marketplaceTaskSchema>;
