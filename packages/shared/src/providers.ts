import type { AgentProfile } from "./agent.js";
import type { ActivationEnvelope, PreparedAction } from "./activation.js";
import type { ExecutionPod, MarketplaceTask } from "./task.js";

export type ProviderEnvironment = "local" | "testnet" | "mainnet";

export interface ProviderEvidence {
  observedAt: string;
  source: string;
  environment: ProviderEnvironment;
  chainId?: number;
  blockNumber?: bigint;
  txHash?: string;
  requestId?: string;
}

export interface IdentityProvider {
  readonly id: string;
  resolve(agentRef: string): Promise<{ agent: AgentProfile; evidence: ProviderEvidence[] }>;
}

export interface DiscoveryProvider {
  readonly id: string;
  discover(input: {
    category?: string;
    chainId?: number;
    limit?: number;
  }): Promise<{ agents: AgentProfile[]; evidence: ProviderEvidence[] }>;
}

export interface LivenessProvider {
  readonly id: string;
  probe(agent: AgentProfile): Promise<{
    live: boolean;
    checkedAt: string;
    latencyMs?: number;
    detail?: string;
    evidence: ProviderEvidence[];
  }>;
}

export interface TransportProvider {
  readonly id: string;
  dispatch(input: {
    agent: AgentProfile;
    task: MarketplaceTask;
    pod: ExecutionPod;
  }): Promise<{
    dispatchId: string;
    accepted: boolean;
    evidence: ProviderEvidence[];
  }>;
}

export interface AuthorityProvider {
  readonly id: string;
  prepare(envelope: ActivationEnvelope): Promise<{
    authorityRef: string;
    envelopeHash: string;
    evidence: ProviderEvidence[];
  }>;
  revoke(authorityRef: string): Promise<{ revoked: boolean; evidence: ProviderEvidence[] }>;
}

export interface HiringProvider {
  readonly id: string;
  hire(input: {
    prepared: PreparedAction;
    envelope: ActivationEnvelope;
    authorityRef?: string;
  }): Promise<{ jobId: string; evidence: ProviderEvidence[] }>;
}

export interface SettlementProvider {
  readonly id: string;
  settle(input: {
    task: MarketplaceTask;
    pod: ExecutionPod;
    jobId?: string;
  }): Promise<{ settlementId: string; evidence: ProviderEvidence[] }>;
}

export interface OutcomeVerifier {
  readonly id: string;
  verify(input: {
    task: MarketplaceTask;
    pod: ExecutionPod;
    baselineRef?: string;
  }): Promise<{
    outcome: "beneficial" | "neutral" | "harmful" | "undetermined";
    metrics: Record<string, number | string | boolean | null>;
    evidence: ProviderEvidence[];
  }>;
}
