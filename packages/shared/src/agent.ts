import { z } from "zod";
import { marketplaceCategorySchema } from "./category.js";

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
  supportedChains: z.array(z.number()).default([]),
  capabilities: z.array(agentCapabilitySchema).default([]),
  endpointUrl: z.string().url().optional(),
  publicSigningKey: z.string().optional(),
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
