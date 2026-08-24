import { z } from "zod";

export const judgmentCaseTypeSchema = z.enum([
  "mandate-fulfillment",
  "service-delivery",
  "evidence-conflict",
  "refund-dispute",
  "agent-to-agent-dispute"
]);

export const judgmentCaseSchema = z.object({
  id: z.string(),
  taskId: z.string().optional(),
  type: judgmentCaseTypeSchema,
  statement: z.string(),
  criteria: z.array(z.string()).min(1),
  evidenceRefs: z.array(z.string()).default([]),
  deterministicFacts: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  requestedAdjudicator: z.enum(["genlayer", "internet-court", "manual", "other"]),
  createdAt: z.string(),
  disputeWindowEndsAt: z.string().optional(),
  state: z.enum(["open", "submitted", "decided", "appealed", "closed"]).default("open")
});

export const judgmentVerdictSchema = z.object({
  caseId: z.string(),
  verdict: z.enum(["accepted", "rejected", "undetermined"]),
  reason: z.string(),
  adjudicator: z.string(),
  adjudicatorRef: z.string().optional(),
  decidedAt: z.string(),
  evidenceRefs: z.array(z.string()).default([])
});

export type JudgmentCase = z.infer<typeof judgmentCaseSchema>;
export type JudgmentVerdict = z.infer<typeof judgmentVerdictSchema>;

// Judgment is an escalation path. Deterministic execution and financial facts
// should be resolved by deterministic verifiers before a case is opened.
