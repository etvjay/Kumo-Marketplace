import {
  NOEMA_AGENT_PROFILE_VERSION,
  NOEMA_UPSTREAM_REF,
  assertNoemaAgentAssessment,
  evaluateNoemaMandate,
  type JsonObject,
  type NoemaAgentAssessment,
  type NoemaAgentClaim,
  type NoemaAgentEconomicObject,
  type NoemaAgentEvidenceRef,
  type NoemaAgentMandate
} from "@kumo/noema-agent-profile";
import type {
  RebalanceEconomics,
  RebalancePolicy,
  RebalancerMarketState,
  RebalancerPosition
} from "./types.js";

export interface LiquidityPositionEconomicState {
  chainId: number;
  venue: "pancakeswap-v3";
  positionId: string;
  poolAddress: string;
  token0: string;
  token1: string;
  feeTier: number;
  currentTick: number;
  tickLower: number;
  tickUpper: number;
  inRange: boolean;
  amount0: number;
  amount1: number;
  positionValueUsd: number;
  uncollectedFeesUsd: number;
  spotPrice: number;
  poolLiquidityUsd: number;
  feeAprEstimate?: number;
  realizedVolatilityAnnualized?: number;
  blockNumber?: number;
}

function ms(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`NOEMA_INVALID_TIME:${value}`);
  return parsed;
}

function evidenceFreshness(observedAt: number, evaluatedAt: number, maxAgeMs: number): "FRESH" | "STALE" {
  return evaluatedAt - observedAt <= maxAgeMs ? "FRESH" : "STALE";
}

function claim(input: Omit<NoemaAgentClaim, "createdAt"> & { createdAt: number }): NoemaAgentClaim {
  return input;
}

export function buildLiquidityPositionEconomicObject(input: {
  position: RebalancerPosition;
  market: RebalancerMarketState;
  policy: RebalancePolicy;
  venueSourceRef: string;
  evaluatedAt: number;
}): NoemaAgentEconomicObject<LiquidityPositionEconomicState> {
  const { position, market, policy, venueSourceRef, evaluatedAt } = input;
  const positionObservedAt = ms(position.observedAt);
  const marketObservedAt = ms(market.observedAt);
  const maxAgeMs = policy.observationMaxAgeSeconds * 1000;
  const objectId = `noema:liquidity-position:${position.chainId}:${position.venue}:${position.positionId}`;
  const positionEvidenceId = `noema-evidence:position:${position.positionId}:${position.blockNumber ?? positionObservedAt}`;
  const poolEvidenceId = `noema-evidence:pool:${market.poolAddress}:${market.blockNumber ?? marketObservedAt}`;
  const valuationEvidenceId = `noema-evidence:valuation:${position.positionId}:${market.blockNumber ?? marketObservedAt}`;

  const evidence: NoemaAgentEvidenceRef[] = [
    {
      id: positionEvidenceId,
      type: "ONCHAIN_STATE",
      source: venueSourceRef,
      authority: "ONCHAIN_STATE",
      observedAt: positionObservedAt,
      fetchedAt: evaluatedAt,
      freshness: evidenceFreshness(positionObservedAt, evaluatedAt, maxAgeMs),
      metadata: {
        chainId: position.chainId,
        positionId: position.positionId,
        blockNumber: position.blockNumber ?? null
      }
    },
    {
      id: poolEvidenceId,
      type: "ONCHAIN_STATE",
      source: venueSourceRef,
      authority: "ONCHAIN_STATE",
      observedAt: marketObservedAt,
      fetchedAt: evaluatedAt,
      freshness: evidenceFreshness(marketObservedAt, evaluatedAt, maxAgeMs),
      metadata: {
        chainId: market.chainId,
        poolAddress: market.poolAddress,
        blockNumber: market.blockNumber ?? null
      }
    },
    {
      id: valuationEvidenceId,
      type: "API_RESPONSE",
      source: `${venueSourceRef}:market-valuation`,
      authority: "MARKET_DATA",
      observedAt: marketObservedAt,
      fetchedAt: evaluatedAt,
      freshness: evidenceFreshness(marketObservedAt, evaluatedAt, maxAgeMs),
      metadata: {
        token0PriceUsd: market.token0PriceUsd,
        token1PriceUsd: market.token1PriceUsd,
        liquidityUsd: market.liquidityUsd,
        spotPrice: market.spotPrice
      }
    }
  ];

  const classificationClaimId = `${objectId}:claim:classification`;
  const claims: NoemaAgentClaim[] = [
    claim({
      id: classificationClaimId,
      subject: objectId,
      property: "economicObject.type",
      value: "CONCENTRATED_LIQUIDITY_POSITION",
      state: "VERIFIED",
      sourceRefs: [venueSourceRef],
      evidenceRefs: [positionEvidenceId, poolEvidenceId],
      confidence: 1,
      observedAt: Math.min(positionObservedAt, marketObservedAt),
      createdAt: evaluatedAt
    }),
    claim({
      id: `${objectId}:claim:currentTick`,
      subject: objectId,
      property: "position.currentTick",
      value: position.currentTick,
      state: "VERIFIED",
      sourceRefs: [venueSourceRef],
      evidenceRefs: [poolEvidenceId],
      confidence: 1,
      observedAt: marketObservedAt,
      createdAt: evaluatedAt
    }),
    claim({
      id: `${objectId}:claim:tickLower`,
      subject: objectId,
      property: "position.tickLower",
      value: position.tickLower,
      state: "VERIFIED",
      sourceRefs: [venueSourceRef],
      evidenceRefs: [positionEvidenceId],
      confidence: 1,
      observedAt: positionObservedAt,
      createdAt: evaluatedAt
    }),
    claim({
      id: `${objectId}:claim:tickUpper`,
      subject: objectId,
      property: "position.tickUpper",
      value: position.tickUpper,
      state: "VERIFIED",
      sourceRefs: [venueSourceRef],
      evidenceRefs: [positionEvidenceId],
      confidence: 1,
      observedAt: positionObservedAt,
      createdAt: evaluatedAt
    }),
    claim({
      id: `${objectId}:claim:inRange`,
      subject: objectId,
      property: "position.inRange",
      value: position.inRange,
      state: "VERIFIED",
      sourceRefs: ["rule:kumo-v3-range-coherence-v1"],
      evidenceRefs: [positionEvidenceId, poolEvidenceId],
      confidence: 1,
      observedAt: marketObservedAt,
      createdAt: evaluatedAt
    }),
    claim({
      id: `${objectId}:claim:positionValueUsd`,
      subject: objectId,
      property: "position.valueUsd",
      value: position.valueUsd,
      unit: "USD",
      state: "SOURCED",
      sourceRefs: [`${venueSourceRef}:market-valuation`],
      evidenceRefs: [valuationEvidenceId],
      observedAt: marketObservedAt,
      createdAt: evaluatedAt
    }),
    claim({
      id: `${objectId}:claim:uncollectedFeesUsd`,
      subject: objectId,
      property: "position.uncollectedFeesUsd",
      value: position.uncollectedFeesUsd,
      unit: "USD",
      state: "SOURCED",
      sourceRefs: [`${venueSourceRef}:market-valuation`],
      evidenceRefs: [valuationEvidenceId],
      observedAt: marketObservedAt,
      createdAt: evaluatedAt
    }),
    claim({
      id: `${objectId}:claim:poolLiquidityUsd`,
      subject: objectId,
      property: "pool.liquidityUsd",
      value: market.liquidityUsd,
      unit: "USD",
      state: "SOURCED",
      sourceRefs: [`${venueSourceRef}:market-valuation`],
      evidenceRefs: [valuationEvidenceId],
      observedAt: marketObservedAt,
      createdAt: evaluatedAt
    }),
    claim({
      id: `${objectId}:claim:spotPrice`,
      subject: objectId,
      property: "market.spotPrice",
      value: market.spotPrice,
      state: "SOURCED",
      sourceRefs: [`${venueSourceRef}:market-valuation`],
      evidenceRefs: [valuationEvidenceId],
      observedAt: marketObservedAt,
      createdAt: evaluatedAt
    })
  ];

  if (market.feeAprEstimate !== undefined) {
    claims.push(claim({
      id: `${objectId}:claim:feeAprEstimate`,
      subject: objectId,
      property: "market.feeAprEstimate",
      value: market.feeAprEstimate,
      state: "INFERRED",
      sourceRefs: ["model:fee-apr-estimate"],
      evidenceRefs: [poolEvidenceId, valuationEvidenceId],
      observedAt: marketObservedAt,
      createdAt: evaluatedAt
    }));
  }

  if (market.realizedVolatilityAnnualized !== undefined) {
    claims.push(claim({
      id: `${objectId}:claim:realizedVolatilityAnnualized`,
      subject: objectId,
      property: "market.realizedVolatilityAnnualized",
      value: market.realizedVolatilityAnnualized,
      state: "INFERRED",
      sourceRefs: ["model:realized-volatility"],
      evidenceRefs: [valuationEvidenceId],
      observedAt: marketObservedAt,
      createdAt: evaluatedAt
    }));
  }

  const chainCoherent = position.chainId === market.chainId && position.chainId === 56;
  const rangeCoherent = position.tickLower < position.tickUpper
    && position.inRange === (position.currentTick >= position.tickLower && position.currentTick < position.tickUpper);
  const fresh = evidence.every((item) => item.freshness === "FRESH");

  const checks = [
    {
      id: `${objectId}:check:chain`,
      type: "CHAIN_IDENTITY",
      subject: objectId,
      result: chainCoherent ? "PASS" as const : "FAIL" as const,
      evidenceRefs: [positionEvidenceId, poolEvidenceId],
      ruleVersion: "kumo-noema-chain-v1",
      timestamp: evaluatedAt,
      reason: chainCoherent ? undefined : "Position and pool must resolve to BNB Smart Chain chainId 56"
    },
    {
      id: `${objectId}:check:range`,
      type: "RANGE_COHERENCE",
      subject: objectId,
      result: rangeCoherent ? "PASS" as const : "FAIL" as const,
      evidenceRefs: [positionEvidenceId, poolEvidenceId],
      ruleVersion: "kumo-noema-v3-range-v1",
      timestamp: evaluatedAt,
      reason: rangeCoherent ? undefined : "Tick bounds or derived in-range state are inconsistent"
    },
    {
      id: `${objectId}:check:freshness`,
      type: "EVIDENCE_FRESHNESS",
      subject: objectId,
      result: fresh ? "PASS" as const : "FAIL" as const,
      evidenceRefs: evidence.map((item) => item.id),
      ruleVersion: "kumo-noema-freshness-v1",
      timestamp: evaluatedAt,
      reason: fresh ? undefined : "One or more action-relevant evidence items are stale"
    }
  ];

  const verificationStatus = checks.every((check) => check.result === "PASS") ? "PASS" as const : "FAIL" as const;
  const status = !fresh
    ? "STALE" as const
    : !chainCoherent || !rangeCoherent
      ? "CONFLICTING" as const
      : "RESOLVED" as const;

  return {
    id: objectId,
    version: market.blockNumber ?? position.blockNumber ?? evaluatedAt,
    objectType: "CONCENTRATED_LIQUIDITY_POSITION",
    classification: {
      primary: "CONCENTRATED_LIQUIDITY_POSITION",
      secondary: ["DEFI_LIQUIDITY_POSITION", "PANCAKESWAP_V3"],
      confidence: 1,
      claimRef: classificationClaimId
    },
    economics: {
      chainId: position.chainId,
      venue: position.venue,
      positionId: position.positionId,
      poolAddress: market.poolAddress,
      token0: position.token0,
      token1: position.token1,
      feeTier: position.feeTier,
      currentTick: position.currentTick,
      tickLower: position.tickLower,
      tickUpper: position.tickUpper,
      inRange: position.inRange,
      amount0: position.amount0,
      amount1: position.amount1,
      positionValueUsd: position.valueUsd,
      uncollectedFeesUsd: position.uncollectedFeesUsd,
      spotPrice: market.spotPrice,
      poolLiquidityUsd: market.liquidityUsd,
      feeAprEstimate: market.feeAprEstimate,
      realizedVolatilityAnnualized: market.realizedVolatilityAnnualized,
      blockNumber: market.blockNumber
    },
    claims,
    evidence,
    verification: {
      status: verificationStatus,
      verifierVersion: "kumo-noema-rebalancer-verifier-v0.1.0",
      checks
    },
    status,
    createdAt: Math.min(positionObservedAt, marketObservedAt),
    updatedAt: evaluatedAt
  };
}

export function buildRebalanceMandate(input: {
  positionId: string;
  principal: string;
  policy: RebalancePolicy;
}): NoemaAgentMandate {
  return {
    id: `noema-mandate:rebalancer:${input.positionId}`,
    version: 1,
    principal: input.principal,
    objective: "Permit a candidate PancakeSwap V3 reposition only when the economic object is sufficiently evidenced and remains inside the configured capital mandate",
    economicObjectType: "CONCENTRATED_LIQUIDITY_POSITION",
    requiredClaims: [
      { property: "position.currentTick", acceptedStates: ["VERIFIED"] },
      { property: "position.tickLower", acceptedStates: ["VERIFIED"] },
      { property: "position.tickUpper", acceptedStates: ["VERIFIED"] },
      { property: "position.inRange", acceptedStates: ["VERIFIED"] },
      { property: "position.valueUsd", acceptedStates: ["SOURCED", "VERIFIED"] },
      { property: "pool.liquidityUsd", acceptedStates: ["SOURCED", "VERIFIED"] }
    ],
    maxEvidenceAgeMs: input.policy.observationMaxAgeSeconds * 1000,
    constraints: {
      maxPositionValueUsd: input.policy.maxPositionValueUsd ?? null,
      minPoolLiquidityUsd: input.policy.minPoolLiquidityUsd,
      maxVolatilityAnnualized: input.policy.maxVolatilityAnnualized ?? null
    }
  };
}

export function buildRebalancerNoemaAssessment(input: {
  economicObject: NoemaAgentEconomicObject<LiquidityPositionEconomicState>;
  mandate: NoemaAgentMandate;
  economics: RebalanceEconomics;
  policy: RebalancePolicy;
  feeModelRef: string;
  riskModelRef: string;
  evaluatedAt: number;
}): NoemaAgentAssessment<LiquidityPositionEconomicState> {
  const object: NoemaAgentEconomicObject<LiquidityPositionEconomicState> = {
    ...input.economicObject,
    claims: [...input.economicObject.claims]
  };

  object.claims.push(
    {
      id: `${object.id}:claim:expectedFeeImprovementUsd:${input.evaluatedAt}`,
      subject: object.id,
      property: "candidate.expectedFeeImprovementUsd",
      value: input.economics.estimatedFeeImprovementUsd,
      unit: "USD",
      state: "INFERRED",
      sourceRefs: [input.feeModelRef],
      evidenceRefs: object.evidence.map((item) => item.id),
      createdAt: input.evaluatedAt
    },
    {
      id: `${object.id}:claim:estimatedImpermanentLossDeltaUsd:${input.evaluatedAt}`,
      subject: object.id,
      property: "candidate.estimatedImpermanentLossDeltaUsd",
      value: input.economics.estimatedImpermanentLossDeltaUsd,
      unit: "USD",
      state: "INFERRED",
      sourceRefs: [input.riskModelRef],
      evidenceRefs: object.evidence.map((item) => item.id),
      createdAt: input.evaluatedAt
    },
    {
      id: `${object.id}:claim:expectedNetBenefitUsd:${input.evaluatedAt}`,
      subject: object.id,
      property: "candidate.expectedNetBenefitUsd",
      value: input.economics.expectedNetBenefitUsd,
      unit: "USD",
      state: "INFERRED",
      sourceRefs: [input.feeModelRef, input.riskModelRef, "kumo:rebalancer-economics-v1"],
      evidenceRefs: object.evidence.map((item) => item.id),
      createdAt: input.evaluatedAt
    }
  );
  object.updatedAt = input.evaluatedAt;

  const baseEvaluation = evaluateNoemaMandate({
    economicObject: object,
    mandate: input.mandate,
    evaluatedAt: input.evaluatedAt
  });

  const reasonCodes = [...baseEvaluation.reasonCodes];
  let decision = baseEvaluation.decision;

  if (input.policy.maxPositionValueUsd !== undefined
    && object.economics.positionValueUsd > input.policy.maxPositionValueUsd) {
    decision = "BLOCK";
    reasonCodes.push("MANDATE_POSITION_VALUE_EXCEEDED");
  }

  if (object.economics.poolLiquidityUsd < input.policy.minPoolLiquidityUsd) {
    decision = "BLOCK";
    reasonCodes.push("MANDATE_POOL_LIQUIDITY_BELOW_MINIMUM");
  }

  if (input.policy.maxVolatilityAnnualized !== undefined) {
    if (object.economics.realizedVolatilityAnnualized === undefined) {
      if (decision !== "BLOCK") decision = "CONDITIONAL";
      reasonCodes.push("MANDATE_VOLATILITY_UNRESOLVED");
    } else if (object.economics.realizedVolatilityAnnualized > input.policy.maxVolatilityAnnualized) {
      decision = "BLOCK";
      reasonCodes.push("MANDATE_VOLATILITY_EXCEEDED");
    }
  }

  const assessment: NoemaAgentAssessment<LiquidityPositionEconomicState> = {
    profileVersion: NOEMA_AGENT_PROFILE_VERSION,
    upstreamRef: NOEMA_UPSTREAM_REF,
    economicObject: object,
    mandate: input.mandate,
    evaluation: {
      ...baseEvaluation,
      decision,
      reasonCodes: [...new Set(reasonCodes)]
    },
    inferenceProposals: []
  };

  assertNoemaAgentAssessment(assessment);
  return assessment;
}

export function noemaConstraintsAsJson(mandate: NoemaAgentMandate): JsonObject {
  return mandate.constraints;
}
