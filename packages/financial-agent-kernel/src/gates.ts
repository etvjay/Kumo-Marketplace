import type {
  CanaryResult,
  ExecutableQuote,
  ExecutionReadiness,
  KernelRiskPolicy,
  ObservationSnapshot,
  StrategyProposal
} from "./types.js";

export interface ReadinessInput {
  now: string;
  proposal: StrategyProposal;
  quote: ExecutableQuote | null;
  refreshedObservation: ObservationSnapshot;
  policy: KernelRiskPolicy;
  securityVetoes?: string[];
  policyVetoes?: string[];
  authorityRef?: string;
  canary?: CanaryResult;
}

function ageSeconds(now: string, then: string): number {
  return Math.max(0, (Date.parse(now) - Date.parse(then)) / 1000);
}

export function evaluateExecutionReadiness(input: ReadinessInput): ExecutionReadiness {
  const reasons: string[] = [];
  let state: ExecutionReadiness["state"] = "ready";

  if (input.proposal.disposition === "refuse") {
    return {
      proposalId: input.proposal.id,
      quoteId: input.quote?.id,
      evaluatedAt: input.now,
      state: "refused",
      eligible: false,
      reasons: input.proposal.refusalReasons.length
        ? input.proposal.refusalReasons
        : ["STRATEGY_REFUSED"]
    };
  }

  if (Date.parse(input.now) >= Date.parse(input.proposal.expiresAt)) {
    state = "stale";
    reasons.push("PROPOSAL_EXPIRED");
  }

  if (ageSeconds(input.now, input.refreshedObservation.observedAt) > input.policy.maxObservationAgeSeconds) {
    state = "stale";
    reasons.push("OBSERVATION_STALE");
  }

  if (input.refreshedObservation.marketSnapshotRoot !== input.proposal.marketSnapshotRoot) {
    state = "stale";
    reasons.push("MARKET_DRIFT");
  }

  const quoteRequired = input.proposal.mode === "execute"
    || (input.proposal.mode === "shadow" && input.policy.requireQuoteForShadow);

  if (quoteRequired && !input.quote) {
    state = "blocked";
    reasons.push("EXECUTABLE_QUOTE_REQUIRED");
  }

  if (input.quote) {
    if (Date.parse(input.now) >= Date.parse(input.quote.expiresAt)) {
      state = "stale";
      reasons.push("QUOTE_EXPIRED");
    }
    if (input.quote.marketSnapshotRoot !== input.refreshedObservation.marketSnapshotRoot) {
      state = "stale";
      reasons.push("QUOTE_MARKET_DRIFT");
    }
    if (input.policy.maxSlippageBps !== undefined
      && input.quote.slippageBps !== undefined
      && input.quote.slippageBps > input.policy.maxSlippageBps) {
      state = "blocked";
      reasons.push("SLIPPAGE_LIMIT_EXCEEDED");
    }
    if (input.policy.maxEstimatedCost !== undefined
      && input.quote.totalCost > input.policy.maxEstimatedCost) {
      state = "blocked";
      reasons.push("COST_LIMIT_EXCEEDED");
    }
  }

  if (input.policy.minExpectedNetBenefit !== undefined
    && input.proposal.expectedNetBenefit !== undefined
    && input.proposal.expectedNetBenefit < input.policy.minExpectedNetBenefit) {
    state = "blocked";
    reasons.push("NET_BENEFIT_BELOW_HURDLE");
  }

  if (input.policy.maxRiskScore !== undefined
    && input.proposal.riskScore !== undefined
    && input.proposal.riskScore > input.policy.maxRiskScore) {
    state = "blocked";
    reasons.push("RISK_LIMIT_EXCEEDED");
  }

  for (const veto of input.securityVetoes ?? []) {
    state = "blocked";
    reasons.push(`SECURITY_VETO:${veto}`);
  }

  for (const veto of input.policyVetoes ?? []) {
    state = "blocked";
    reasons.push(`POLICY_VETO:${veto}`);
  }

  if (input.proposal.mode === "execute") {
    if (!input.authorityRef) {
      state = "blocked";
      reasons.push("BOUNDED_AUTHORITY_REQUIRED");
    }
    if (input.policy.requireCanaryForExecute) {
      if (!input.canary) {
        state = "blocked";
        reasons.push("CANARY_REQUIRED");
      } else if (!input.canary.passed) {
        state = "blocked";
        reasons.push("CANARY_FAILED");
      }
    }
  }

  return {
    proposalId: input.proposal.id,
    quoteId: input.quote?.id,
    evaluatedAt: input.now,
    state,
    eligible: state === "ready",
    reasons
  };
}
