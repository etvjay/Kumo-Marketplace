import type {
  RebalancerFeeModel,
  RebalancerPerformanceProvider,
  RebalancerRiskModel,
  RebalancerVenueProvider
} from "./ports.js";
import type {
  RebalancerMarketState,
  RebalancerPosition
} from "./types.js";

const LN_1_0001 = Math.log(1.0001);
const HOURS_PER_YEAR = 24 * 365;

function erf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return sign * y;
}

function normalCdf(value: number): number {
  return 0.5 * (1 + erf(value / Math.SQRT2));
}

/**
 * Terminal in-range probability proxy under zero-drift lognormal diffusion.
 * It is deliberately a model output, not a claim about future realized path.
 */
export function terminalInRangeProbability(input: {
  currentTick: number;
  tickLower: number;
  tickUpper: number;
  volatilityAnnualized: number;
  horizonHours: number;
}): number {
  if (input.tickLower >= input.tickUpper) return 0;
  const sigma = Math.max(0, input.volatilityAnnualized) * Math.sqrt(input.horizonHours / HOURS_PER_YEAR);
  if (sigma === 0) {
    return input.currentTick >= input.tickLower && input.currentTick < input.tickUpper ? 1 : 0;
  }
  const lowerLogReturn = (input.tickLower - input.currentTick) * LN_1_0001;
  const upperLogReturn = (input.tickUpper - input.currentTick) * LN_1_0001;
  return Math.max(0, Math.min(1, normalCdf(upperLogReturn / sigma) - normalCdf(lowerLogReturn / sigma)));
}

export class V3RangeFeeOpportunityModel implements RebalancerFeeModel {
  readonly id = "kumo-v3-range-fee-opportunity-v1";

  constructor(private readonly horizonHours = 24) {}

  async estimateFeeImprovementUsd(input: {
    position: RebalancerPosition;
    market: RebalancerMarketState;
    targetTickLower: number;
    targetTickUpper: number;
  }): Promise<number> {
    const poolFeeApr = input.market.feeAprEstimate;
    const volatility = input.market.realizedVolatilityAnnualized;
    if (poolFeeApr === undefined || volatility === undefined) return 0;

    const horizonYears = this.horizonHours / HOURS_PER_YEAR;
    const grossPositionFeeOpportunity = input.position.valueUsd * Math.max(0, poolFeeApr) * horizonYears;
    const currentProbability = terminalInRangeProbability({
      currentTick: input.position.currentTick,
      tickLower: input.position.tickLower,
      tickUpper: input.position.tickUpper,
      volatilityAnnualized: volatility,
      horizonHours: this.horizonHours
    });
    const targetProbability = terminalInRangeProbability({
      currentTick: input.position.currentTick,
      tickLower: input.targetTickLower,
      tickUpper: input.targetTickUpper,
      volatilityAnnualized: volatility,
      horizonHours: this.horizonHours
    });

    return grossPositionFeeOpportunity * (targetProbability - currentProbability);
  }
}

/**
 * Bounded concentration-risk proxy for a proposed V3 range change.
 *
 * v2 fixes a pathology in v1: comparing a full-range/very-wide LP directly to
 * a narrow target made the linear width ratio explode, allowing the one-horizon
 * risk delta to exceed the entire position value. v2 log-compresses the width
 * ratio and caps the modeled horizon loss fraction. It remains an inference,
 * not an exact impermanent-loss calculator.
 */
export class V3ConcentrationRiskModel implements RebalancerRiskModel {
  readonly id = "kumo-v3-concentration-risk-v2";

  constructor(
    private readonly horizonHours = 24,
    private readonly centerMoveWeight = 0.2,
    private readonly concentrationWeight = 0.1,
    private readonly maxHorizonRiskFraction = 0.25
  ) {}

  async estimateImpermanentLossDeltaUsd(input: {
    position: RebalancerPosition;
    market: RebalancerMarketState;
    targetTickLower: number;
    targetTickUpper: number;
  }): Promise<number> {
    const valueUsd = Math.max(0, input.position.valueUsd);
    if (valueUsd === 0) return 0;

    const volatility = input.market.realizedVolatilityAnnualized;
    if (volatility === undefined) return valueUsd * 0.0025;

    const currentCenter = (input.position.tickLower + input.position.tickUpper) / 2;
    const targetCenter = (input.targetTickLower + input.targetTickUpper) / 2;
    const currentWidth = Math.max(1, input.position.tickUpper - input.position.tickLower);
    const targetWidth = Math.max(1, input.targetTickUpper - input.targetTickLower);
    const centerMoveRatio = Math.min(
      1,
      Math.abs(targetCenter - currentCenter) / Math.max(1, targetWidth / 2)
    );

    // A 2x narrowing and a 2000x narrowing are materially different, but the
    // latter must not be treated as 1000 times more dangerous. Log compression
    // keeps the signal monotonic without allowing full-range legacy positions
    // to dominate every other economic term by construction.
    const widthRatio = Math.max(1, currentWidth / targetWidth);
    const concentrationIncreaseLog = Math.log(widthRatio);
    const horizonSigma = Math.max(0, volatility) * Math.sqrt(this.horizonHours / HOURS_PER_YEAR);
    const uncappedRiskRate = horizonSigma * (
      this.centerMoveWeight * centerMoveRatio
      + this.concentrationWeight * concentrationIncreaseLog
    );
    const cap = Math.max(0, Math.min(1, this.maxHorizonRiskFraction));
    const boundedRiskRate = Math.max(0, Math.min(cap, uncappedRiskRate));

    return valueUsd * boundedRiskRate;
  }
}

export class StaticShadowRebalancerVenue implements RebalancerVenueProvider {
  readonly id = "kumo-live-pancake-v3-shadow-evidence-bundle";

  constructor(
    private readonly position: RebalancerPosition,
    private readonly market: RebalancerMarketState
  ) {}

  async getPosition(positionId: string): Promise<RebalancerPosition> {
    if (positionId !== this.position.positionId) throw new Error("SHADOW_POSITION_ID_MISMATCH");
    return this.position;
  }

  async getMarketState(position: RebalancerPosition): Promise<RebalancerMarketState> {
    if (position.positionId !== this.position.positionId) throw new Error("SHADOW_MARKET_POSITION_MISMATCH");
    return this.market;
  }

  async quoteRebalance(): Promise<never> {
    throw new Error("SHADOW_ONLY_EXECUTABLE_QUOTE_NOT_IMPLEMENTED");
  }
}

export class UnmeasuredShadowPerformanceProvider implements RebalancerPerformanceProvider {
  readonly id = "kumo-shadow-outcome-not-yet-measured";

  async measure(): Promise<never> {
    throw new Error("SHADOW_OUTCOME_REQUIRES_LATER_COUNTERFACTUAL_MEASUREMENT");
  }
}
