import type { StrategyProposal } from "@kumo/financial-agent-kernel";
import type { NoemaAgentAssessment } from "@kumo/noema-agent-profile";
import type { PancakeV3RawPositionSnapshot } from "./pancakeswap-v3-reader.js";
import type { PancakeV3PositionValuation } from "./valuation.js";

export interface StaticV3PositionBaseline {
  id: string;
  kind: "STATIC_V3_POSITION";
  positionId: string;
  chainId: 56;
  venue: "pancakeswap-v3";
  blockNumber: string;
  blockHash: string;
  blockTimestamp: number;
  observedAt: string;
  owner: string;
  token0: string;
  token1: string;
  token0Decimals: number;
  token1Decimals: number;
  feeTier: number;
  tickLower: number;
  tickUpper: number;
  currentTick: number;
  sqrtPriceX96: string;
  liquidity: string;
  feeGrowthInside0LastX128: string;
  feeGrowthInside1LastX128: string;
  crystallizedFees0Raw: string;
  crystallizedFees1Raw: string;
  principalAmount0Raw: string;
  principalAmount1Raw: string;
  principalValueUsd: number;
  crystallizedFeesFloorUsd: number;
  markedValueIncludingCrystallizedFeesUsd: number;
  token0PriceUsd: number;
  token1PriceUsd: number;
  priceEvidenceRefs: string[];
  counterfactualRule: "LEAVE_ORIGINAL_RANGE_AND_LIQUIDITY_UNCHANGED";
  counterfactualStatus: "FROZEN_NOT_MEASURED" | "MEASURED";
}

export interface RebalancerShadowDecisionRecord {
  id: string;
  baselineId: string;
  proposalId: string;
  agentId: string;
  positionId: string;
  createdAt: string;
  disposition: "propose" | "refuse";
  proposedAction: string;
  expectedNetBenefitUsd?: number;
  estimatedCostUsd?: number;
  noemaObjectId: string;
  noemaObjectVersion: number;
  noemaMandateId: string;
  noemaDecision: "ALLOW" | "BLOCK" | "CONDITIONAL";
  evidenceSnapshotRoot: string;
  marketSnapshotRoot: string;
  executionStatus: "SHADOW_ONLY";
  laterOutcomeStatus: "PENDING" | "MEASURED";
}

export interface RebalancerShadowLedger {
  saveBaseline(baseline: StaticV3PositionBaseline): Promise<void>;
  saveDecision(decision: RebalancerShadowDecisionRecord): Promise<void>;
}

export function freezeStaticV3Baseline(input: {
  snapshot: PancakeV3RawPositionSnapshot;
  valuation: PancakeV3PositionValuation;
}): StaticV3PositionBaseline {
  const { snapshot, valuation } = input;
  if (snapshot.tokenId !== valuation.positionId) throw new Error("BASELINE_POSITION_MISMATCH");
  if (snapshot.blockNumber.toString() !== valuation.blockNumber || snapshot.blockHash !== valuation.blockHash) {
    throw new Error("BASELINE_VALUATION_BLOCK_MISMATCH");
  }

  return {
    id: `baseline:pancake-v3:${snapshot.tokenId}:${snapshot.blockNumber.toString()}:${snapshot.blockHash}`,
    kind: "STATIC_V3_POSITION",
    positionId: snapshot.tokenId,
    chainId: 56,
    venue: "pancakeswap-v3",
    blockNumber: snapshot.blockNumber.toString(),
    blockHash: snapshot.blockHash,
    blockTimestamp: snapshot.blockTimestamp,
    observedAt: snapshot.observedAt,
    owner: snapshot.owner,
    token0: snapshot.token0,
    token1: snapshot.token1,
    token0Decimals: snapshot.token0Decimals,
    token1Decimals: snapshot.token1Decimals,
    feeTier: snapshot.fee,
    tickLower: snapshot.tickLower,
    tickUpper: snapshot.tickUpper,
    currentTick: snapshot.currentTick,
    sqrtPriceX96: snapshot.sqrtPriceX96.toString(),
    liquidity: snapshot.positionLiquidity.toString(),
    feeGrowthInside0LastX128: snapshot.feeGrowthInside0LastX128.toString(),
    feeGrowthInside1LastX128: snapshot.feeGrowthInside1LastX128.toString(),
    crystallizedFees0Raw: snapshot.tokensOwed0.toString(),
    crystallizedFees1Raw: snapshot.tokensOwed1.toString(),
    principalAmount0Raw: valuation.principalAmount0Raw.toString(),
    principalAmount1Raw: valuation.principalAmount1Raw.toString(),
    principalValueUsd: valuation.principalValueUsd,
    crystallizedFeesFloorUsd: valuation.crystallizedFeesFloorUsd,
    markedValueIncludingCrystallizedFeesUsd: valuation.markedValueIncludingCrystallizedFeesUsd,
    token0PriceUsd: valuation.token0PriceUsd,
    token1PriceUsd: valuation.token1PriceUsd,
    priceEvidenceRefs: valuation.priceEvidenceRefs,
    counterfactualRule: "LEAVE_ORIGINAL_RANGE_AND_LIQUIDITY_UNCHANGED",
    counterfactualStatus: "FROZEN_NOT_MEASURED"
  };
}

export function buildRebalancerShadowDecision(input: {
  baseline: StaticV3PositionBaseline;
  proposal: StrategyProposal;
  noema: NoemaAgentAssessment<unknown>;
}): RebalancerShadowDecisionRecord {
  if (input.proposal.mode !== "shadow") throw new Error("SHADOW_MODE_REQUIRED");
  if (input.noema.economicObject.id !== input.noema.evaluation.objectId) {
    throw new Error("SHADOW_NOEMA_OBJECT_MISMATCH");
  }

  return {
    id: `shadow:${input.proposal.id}`,
    baselineId: input.baseline.id,
    proposalId: input.proposal.id,
    agentId: input.proposal.agentId,
    positionId: input.baseline.positionId,
    createdAt: input.proposal.createdAt,
    disposition: input.proposal.disposition,
    proposedAction: input.proposal.action,
    expectedNetBenefitUsd: input.proposal.expectedNetBenefit,
    estimatedCostUsd: input.proposal.estimatedCost,
    noemaObjectId: input.noema.economicObject.id,
    noemaObjectVersion: input.noema.economicObject.version,
    noemaMandateId: input.noema.mandate.id,
    noemaDecision: input.noema.evaluation.decision,
    evidenceSnapshotRoot: input.proposal.evidenceSnapshotRoot,
    marketSnapshotRoot: input.proposal.marketSnapshotRoot,
    executionStatus: "SHADOW_ONLY",
    laterOutcomeStatus: "PENDING"
  };
}
