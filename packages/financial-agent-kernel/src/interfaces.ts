import type { MarketplaceCategory } from "@kumo/shared";
import type {
  CanaryResult,
  EvidencePacket,
  ExecutableQuote,
  ExecutionReceipt,
  KernelMode,
  ObservationSnapshot,
  OutcomeRecord,
  PreparedAction,
  StrategyProposal
} from "./types.js";

export interface StrategyRunContext {
  agentId: string;
  taskId?: string;
  mode: KernelMode;
  requestedExecutionChainId?: number;
  authorityRef?: string;
  metadata?: Record<string, unknown>;
}

export interface FinancialAgentStrategy {
  readonly id: string;
  readonly category: MarketplaceCategory;

  observe(context: StrategyRunContext): Promise<ObservationSnapshot>;

  investigate(input: {
    context: StrategyRunContext;
    observation: ObservationSnapshot;
  }): Promise<EvidencePacket>;

  propose(input: {
    context: StrategyRunContext;
    observation: ObservationSnapshot;
    evidence: EvidencePacket;
  }): Promise<StrategyProposal>;

  quote(input: {
    context: StrategyRunContext;
    observation: ObservationSnapshot;
    evidence: EvidencePacket;
    proposal: StrategyProposal;
  }): Promise<ExecutableQuote | null>;

  refresh(input: {
    context: StrategyRunContext;
    proposal: StrategyProposal;
    previousObservation: ObservationSnapshot;
  }): Promise<ObservationSnapshot>;

  measure(input: {
    context: StrategyRunContext;
    receipt: ExecutionReceipt;
    baselineRef?: string;
  }): Promise<OutcomeRecord>;
}

/**
 * Converts an accepted strategy proposal and current executable quote into the
 * exact bounded calls that may later be authorized. Preparation itself creates
 * no authority and must never sign or broadcast transactions.
 */
export interface PreparedActionProvider {
  readonly id: string;
  prepare(input: {
    context: StrategyRunContext;
    observation: ObservationSnapshot;
    evidence: EvidencePacket;
    proposal: StrategyProposal;
    quote?: ExecutableQuote | null;
  }): Promise<PreparedAction>;
}

export interface MarketDriftResult {
  drifted: boolean;
  reasons: string[];
  evidenceRefs?: string[];
}

/**
 * Domain-specific semantic drift comparator.
 *
 * Snapshot roots remain exact provenance identifiers. This provider answers a
 * different question: whether a later observation is still economically close
 * enough to the state on which a consequential action was proposed/quoted.
 */
export interface MarketDriftProvider {
  readonly id: string;
  compare(input: {
    context: StrategyRunContext;
    proposal: StrategyProposal;
    quote: ExecutableQuote | null;
    previousObservation: ObservationSnapshot;
    refreshedObservation: ObservationSnapshot;
  }): Promise<MarketDriftResult>;
}

export interface RiskGateProvider {
  readonly id: string;
  evaluate(input: {
    context: StrategyRunContext;
    observation: ObservationSnapshot;
    evidence: EvidencePacket;
    proposal: StrategyProposal;
    quote: ExecutableQuote | null;
  }): Promise<{ vetoes: string[]; evidenceRefs?: string[] }>;
}

export interface CanaryProvider {
  readonly id: string;
  run(input: {
    context: StrategyRunContext;
    proposal: StrategyProposal;
    quote: ExecutableQuote;
  }): Promise<CanaryResult>;
}

export interface FinancialExecutionProvider {
  readonly id: string;
  execute(input: {
    context: StrategyRunContext;
    proposal: StrategyProposal;
    quote: ExecutableQuote;
    authorityRef: string;
    canary?: CanaryResult;
  }): Promise<ExecutionReceipt>;
}
