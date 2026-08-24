import { z } from "zod";
import { marketplaceCategorySchema } from "./category.js";
import { connectionSurfaceSchema, executionVenueSchema } from "./routing.js";

export const agentStatusSchema = z.enum(["available", "busy", "offline", "unavailable", "unknown"]);

export const agentCapabilitySchema = z.object({
  protocol: z.string(),
  service: z.string(),
  description: z.string()
});

export const agentIdentitySchema = z.object({
  scheme: z.string(),
  id: z.string(),
  owner: z.string().optional(),
  chainId: z.number().optional(),
  registry: z.string().optional(),
  implementation: z.string().optional()
});

export const agentProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  source: z.string(),
  status: agentStatusSchema,
  lastHeartbeat: z.string().optional(),
  description: z.string(),
  categories: z.array(marketplaceCategorySchema).default([]),

  // Origin is where the agent is primarily deployed or operated. It is not an
  // eligibility gate for Kumo and does not need to be BSC.
  originChainIds: z.array(z.number()).default([]),

  // Execution venues are chains/environments where Kumo can route work for the
  // agent directly or through an adapter/relay. BSC qualification can therefore
  // be established without forcing the agent itself to be BSC-native.
  executionVenues: z.array(executionVenueSchema).default([]),

  // Backward-compatible aggregate until all callers move to origin/execution split.
  supportedChains: z.array(z.number()).default([]),

  capabilities: z.array(agentCapabilitySchema).default([]),
  endpointUrl: z.string().url().optional(),
  publicSigningKey: z.string().optional(),
  connectionSurfaces: z.array(connectionSurfaceSchema).default([]),
  supportedTransports: z.array(z.string()).default([]),
  preferredTransport: z.string().optional(),
  identities: z.array(agentIdentitySchema).default([]),
  pricingPolicy: z.object({
    minimumPayout: z.string().optional(),
    hourlyRate: z.string().optional(),
    perCheckpointRate: z.string().optional()
  }).optional(),
  legacy: z.record(z.string(), z.unknown()).optional()
});

export type AgentProfile = z.infer<typeof agentProfileSchema>;
export type AgentIdentity = z.infer<typeof agentIdentitySchema>;
