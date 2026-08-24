import type {
  AgentProfile,
  BscActivationProof,
  MarketplaceCategory,
  TrackDecisionData,
  TrackQualification
} from "@kumo/shared";

export interface TrackQualificationInput {
  agent: AgentProfile;
  category: MarketplaceCategory;
  evaluatedAt: string;
  identityVerified: boolean;
  live: boolean;
  capabilityVerified: boolean;
  decisionData?: TrackDecisionData;
  bscActivation?: BscActivationProof;
  executionVerified?: boolean;
  evidenceRefs?: string[];
}

function requiredDecisionFieldsPresent(data: TrackDecisionData | undefined, category: MarketplaceCategory): boolean {
  if (!data || data.category !== category) return false;

  switch (category) {
    case "rebalancing":
      return (
        data.category === "rebalancing" &&
        Boolean(data.venue) &&
        Object.keys(data.currentAllocation).length > 0 &&
        Object.keys(data.targetAllocation).length > 0 &&
        Number.isFinite(data.driftBps) &&
        Number.isFinite(data.estimatedExecutionCost) &&
        Number.isFinite(data.estimatedSlippageBps)
      );
    case "grid-trading":
      return (
        data.category === "grid-trading" &&
        Boolean(data.venue) &&
        Boolean(data.pair) &&
        Number.isFinite(data.lowerBound) &&
        Number.isFinite(data.upperBound) &&
        data.upperBound > data.lowerBound &&
        data.levels > 0
      );
    case "yield-optimisation":
      return (
        data.category === "yield-optimisation" &&
        Boolean(data.protocol) &&
        Boolean(data.asset) &&
        Number.isFinite(data.currentNetApy) &&
        Number.isFinite(data.projectedNetApy) &&
        Number.isFinite(data.switchingCost)
      );
    case "health-factor-monitoring":
      return (
        data.category === "health-factor-monitoring" &&
        Boolean(data.protocol) &&
        Boolean(data.account) &&
        Number.isFinite(data.healthFactor)
      );
  }
}

function isFresh(data: TrackDecisionData | undefined, evaluatedAt: string): boolean {
  if (!data) return false;
  const observed = Date.parse(data.freshness.observedAt);
  const evaluated = Date.parse(evaluatedAt);
  if (!Number.isFinite(observed) || !Number.isFinite(evaluated) || observed > evaluated) return false;
  if (!data.freshness.maxAgeSeconds) return true;
  return evaluated - observed <= data.freshness.maxAgeSeconds * 1000;
}

export function qualifyAgentForTrack(input: TrackQualificationInput): TrackQualification {
  const decisionDataComplete = requiredDecisionFieldsPresent(input.decisionData, input.category);
  const decisionDataFresh = isFresh(input.decisionData, input.evaluatedAt);
  const bscQualified = input.bscActivation?.state === "qualified";

  const missing: string[] = [];
  if (!input.identityVerified) missing.push("identity");
  if (!input.live) missing.push("liveness");
  if (!input.capabilityVerified) missing.push("capability-proof");
  if (!decisionDataComplete) missing.push("decision-data");
  if (!decisionDataFresh) missing.push("freshness");
  if (!bscQualified) missing.push("bsc-activation");

  const hardReady = missing.length === 0;
  const status: TrackQualification["status"] = hardReady
    ? "qualified"
    : input.identityVerified || input.live || input.capabilityVerified || decisionDataComplete || bscQualified
      ? "partial"
      : "failed";

  return {
    agentId: input.agent.id,
    category: input.category,
    evaluatedAt: input.evaluatedAt,
    status,
    identityVerified: input.identityVerified,
    live: input.live,
    capabilityVerified: input.capabilityVerified,
    decisionDataComplete,
    decisionDataFresh,
    bscActivation: input.bscActivation,
    executionVerified: input.executionVerified ?? false,
    missing,
    evidenceRefs: input.evidenceRefs ?? []
  };
}
