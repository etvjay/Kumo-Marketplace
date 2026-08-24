import type {
  RebalanceEconomics,
  RebalancePolicy,
  RebalancerMarketState,
  RebalancerPosition
} from "./types.js";

const BPS = 10_000;

export function tickToApproxPrice(tick: number): number {
  return Math.pow(1.0001, tick);
}

export function priceDistanceBps(a: number, b: number): number {
  if (a <= 0 || b <= 0) return Number.POSITIVE_INFINITY;
  return Math.abs(a - b) / b * BPS;
}

export function chooseCenteredTicks(input: {
  currentTick: number;
  targetRangeWidthBps: number;
  tickSpacing?: number;
}): { tickLower: number; tickUpper: number } {
  const tickSpacing = Math.max(1, input.tickSpacing ?? 1);
  const halfRatio = input.targetRangeWidthBps / BPS / 2;
  const halfTicks = Math.max(
    tickSpacing,
    Math.round(Math.log(1 + halfRatio) / Math.log(1.0001) / tickSpacing) * tickSpacing
  );
  const center = Math.round(input.currentTick / tickSpacing) * tickSpacing;
  return { tickLower: center - halfTicks, tickUpper: center + halfTicks };
}

export function computePositionDrift(input: {
  position: RebalancerPosition;
  targetTickLower: number;
  targetTickUpper: number;
}): { distanceToNearestEdgeBps: number; centerDriftBps: number } {
  const currentPrice = tickToApproxPrice(input.position.currentTick);
  const lowerPrice = tickToApproxPrice(input.position.tickLower);
  const upperPrice = tickToApproxPrice(input.position.tickUpper);
  const currentCenterPrice = Math.sqrt(lowerPrice * upperPrice);
  const targetCenterPrice = Math.sqrt(
    tickToApproxPrice(input.targetTickLower) * tickToApproxPrice(input.targetTickUpper)
  );

  const edgeDistance = Math.min(
    priceDistanceBps(currentPrice, lowerPrice),
    priceDistanceBps(currentPrice, upperPrice)
  );

  return {
    distanceToNearestEdgeBps: edgeDistance,
    centerDriftBps: priceDistanceBps(currentCenterPrice, targetCenterPrice)
  };
}

export function evaluateRebalanceEconomics(input: {
  position: RebalancerPosition;
  market: RebalancerMarketState;
  policy: RebalancePolicy;
  targetTickLower: number;
  targetTickUpper: number;
  estimatedFeeImprovementUsd: number;
  estimatedImpermanentLossDeltaUsd: number;
  estimatedGasCostUsd: number;
  estimatedSlippageCostUsd: number;
  estimatedBridgeCostUsd?: number;
}): RebalanceEconomics {
  const drift = computePositionDrift({
    position: input.position,
    targetTickLower: input.targetTickLower,
    targetTickUpper: input.targetTickUpper
  });

  const estimatedBridgeCostUsd = input.estimatedBridgeCostUsd ?? 0;
  const estimatedTotalCostUsd = input.estimatedGasCostUsd
    + input.estimatedSlippageCostUsd
    + estimatedBridgeCostUsd;
  const expectedNetBenefitUsd = input.estimatedFeeImprovementUsd
    - input.estimatedImpermanentLossDeltaUsd
    - estimatedTotalCostUsd;

  const reasons: string[] = [];
  if (input.market.liquidityUsd < input.policy.minPoolLiquidityUsd) reasons.push("POOL_LIQUIDITY_BELOW_MINIMUM");
  if (input.policy.maxVolatilityAnnualized !== undefined
    && input.market.realizedVolatilityAnnualized !== undefined
    && input.market.realizedVolatilityAnnualized > input.policy.maxVolatilityAnnualized) {
    reasons.push("VOLATILITY_ABOVE_POLICY");
  }
  if (input.position.valueUsd > (input.policy.maxPositionValueUsd ?? Number.POSITIVE_INFINITY)) reasons.push("POSITION_VALUE_ABOVE_POLICY");
  if (input.estimatedGasCostUsd > input.policy.maxGasCostUsd) reasons.push("GAS_COST_ABOVE_POLICY");
  if (estimatedTotalCostUsd > input.policy.maxTotalExecutionCostUsd) reasons.push("TOTAL_COST_ABOVE_POLICY");
  if (expectedNetBenefitUsd < input.policy.minExpectedNetBenefitUsd) reasons.push("NET_BENEFIT_BELOW_HURDLE");

  const driftTriggered = !input.position.inRange
    ? input.policy.allowOutOfRangeImmediateRecenter
    : drift.centerDriftBps >= input.policy.minDriftBps
      || drift.distanceToNearestEdgeBps <= input.policy.edgeBufferBps;

  if (!driftTriggered) reasons.push("DRIFT_BELOW_REBALANCE_TRIGGER");

  return {
    currentMidTick: input.position.currentTick,
    targetTickLower: input.targetTickLower,
    targetTickUpper: input.targetTickUpper,
    distanceToNearestEdgeBps: drift.distanceToNearestEdgeBps,
    centerDriftBps: drift.centerDriftBps,
    estimatedFeeImprovementUsd: input.estimatedFeeImprovementUsd,
    estimatedImpermanentLossDeltaUsd: input.estimatedImpermanentLossDeltaUsd,
    estimatedGasCostUsd: input.estimatedGasCostUsd,
    estimatedSlippageCostUsd: input.estimatedSlippageCostUsd,
    estimatedBridgeCostUsd,
    estimatedTotalCostUsd,
    expectedNetBenefitUsd,
    shouldRebalance: driftTriggered && reasons.length === 0,
    reasons
  };
}
