import { z } from "zod";

export const connectionSurfaceSchema = z.enum([
  "sdk",
  "api",
  "rest",
  "mcp",
  "a2a",
  "kumo-inbox",
  "x402"
]);

export const executionVenueSchema = z.object({
  chainId: z.number(),
  mode: z.enum(["native", "adapter", "relay", "remote-agent"]),
  address: z.string().optional(),
  endpoint: z.string().url().optional(),
  active: z.boolean().default(true)
});

export const liquidityIngressSchema = z.object({
  sourceChainId: z.number(),
  destinationChainId: z.number(),
  assetIn: z.string(),
  assetOut: z.string().optional(),
  mechanism: z.enum(["native", "bridge", "pool", "solver", "deposit", "other"]),
  provider: z.string().optional(),
  routeRef: z.string().optional(),
  quotedAt: z.string().optional(),
  expiresAt: z.string().optional()
});

export const bscActivationProofSchema = z.object({
  chainId: z.literal(56),
  identityRef: z.string().optional(),
  walletAddress: z.string().optional(),
  serviceRef: z.string().optional(),
  txHash: z.string().optional(),
  observedAt: z.string(),
  state: z.enum(["pending", "qualified", "failed"])
});

export const inboxNegotiationMessageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  fromAgentId: z.string(),
  toAgentId: z.string(),
  type: z.enum(["offer", "counter", "accept", "reject", "cancel", "status"]),
  createdAt: z.string(),
  expiresAt: z.string().optional(),
  taskRef: z.string().optional(),
  proposedExecutionChainId: z.number().optional(),
  proposedSettlementChainId: z.number().optional(),
  price: z.object({
    amount: z.string(),
    token: z.string(),
    chainId: z.number()
  }).optional(),
  liquidityRoute: liquidityIngressSchema.optional(),
  terms: z.record(z.string(), z.unknown()).default({})
});

export type ConnectionSurface = z.infer<typeof connectionSurfaceSchema>;
export type ExecutionVenue = z.infer<typeof executionVenueSchema>;
export type LiquidityIngress = z.infer<typeof liquidityIngressSchema>;
export type BscActivationProof = z.infer<typeof bscActivationProofSchema>;
export type InboxNegotiationMessage = z.infer<typeof inboxNegotiationMessageSchema>;

// Kumo Inbox is a negotiation surface, not an authority surface. An accepted
// message may describe terms but MUST NOT itself confer wallet authority or
// move funds. Authority and settlement remain separate provider concerns.
