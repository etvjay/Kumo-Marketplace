import { z } from "zod";
import { agentIdentitySchema } from "./agent.js";
import { executionPolicySchema } from "./task.js";

export const preparedActionSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  agentId: z.string(),
  preparedAt: z.string(),
  expiresAt: z.string(),
  inputRoot: z.string(),
  marketSnapshotRoot: z.string(),
  evidenceSnapshotRoot: z.string(),
  policyFingerprint: z.string(),
  simulationRef: z.string().optional(),
  state: z.enum(["prepared", "stale", "approved", "rejected", "executed"]).default("prepared")
});

export const activationEnvelopeSchema = z.object({
  user: z.string(),
  agentId: z.string(),
  agentIdentity: agentIdentitySchema,
  taskId: z.string(),
  taskType: z.string(),
  inputRoot: z.string(),
  mandate: executionPolicySchema,
  pricing: z.object({ amount: z.string(), token: z.string() }).optional(),
  marketSnapshotRoot: z.string(),
  evidenceSnapshotRoot: z.string(),
  policyFingerprint: z.string(),
  expiresAt: z.string()
});

export type PreparedAction = z.infer<typeof preparedActionSchema>;
export type ActivationEnvelope = z.infer<typeof activationEnvelopeSchema>;

// Hashing is deliberately not implemented here. The authority adapter must hash a
// canonical serialization and bind the exact envelope accepted by its verifier.
