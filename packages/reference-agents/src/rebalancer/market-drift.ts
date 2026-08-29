import type {
  ExecutableQuote,
  MarketDriftProvider,
  MarketDriftResult,
  ObservationSnapshot,
  StrategyProposal,
  StrategyRunContext
} from "@kumo/financial-agent-kernel";

export interface RebalancerMarketDriftPolicy {
  maxTickDrift: number;
  maxSpotPriceDriftBps: number;
  maxPositionValueDriftBps: number;
  maxPoolLiquidityDeclineBps: number;
}

export const DEFAULT_REBALANCER_MARKET_DRIFT_POLICY: RebalancerMarketDriftPolicy = {
  maxTickDrift: 5,
  maxSpotPriceDriftBps: 5,
  maxPositionValueDriftBps: 25,
  maxPoolLiquidityDeclineBps: 100
};

function numberValue(observation: ObservationSnapshot, key: string): number | undefined {
  const value = observation.values[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function stringValue(observation: ObservationSnapshot, key: string): string | undefined {
  const value = observation.values[key];
  return typeof value === "string" ? value : undefined;
}
function booleanValue(observation: ObservationSnapshot, key: string): boolean | undefined {
  const value = observation.values[key];
  return typeof value === "boolean" ? value : undefined;
}
function driftBps(previous: number, current: number): number {
  if (previous === 0) return current === 0 ? 0 : Number.POSITIVE_INFINITY;
  return Math.abs(current - previous) / Math.abs(previous) * 10_000;
}
function declineBps(previous: number, current: number): number {
  if (previous <= 0) return current < previous ? Number.POSITIVE_INFINITY : 0;
  return Math.max(0, previous - current) / previous * 10_000;
}

export class RebalancerMarketDriftProvider implements MarketDriftProvider {
  readonly id = "kumo-rebalancer-market-drift-v2";
  private readonly clock: () => string;

  constructor(
    private readonly policy: RebalancerMarketDriftPolicy = DEFAULT_REBALANCER_MARKET_DRIFT_POLICY,
    clock?: () => string
  ) {
    this.clock = clock ?? (() => new Date().toISOString());
  }

  async compare(input: {
    context: StrategyRunContext;
    proposal: StrategyProposal;
    quote: ExecutableQuote | null;
    previousObservation: ObservationSnapshot;
    refreshedObservation: ObservationSnapshot;
  }): Promise<MarketDriftResult> {
    const reasons: string[] = [];
    const previous = input.previousObservation;
    const current = input.refreshedObservation;

    if (input.proposal.marketSnapshotRoot !== previous.marketSnapshotRoot) reasons.push("PROPOSAL_PRIOR_ROOT_MISMATCH");
    if (input.quote && input.quote.marketSnapshotRoot !== input.proposal.marketSnapshotRoot) reasons.push("QUOTE_PROPOSAL_ROOT_MISMATCH");
    if (previous.chainId !== current.chainId) reasons.push("CHAIN_CHANGED");
    if (previous.agentId !== current.agentId) reasons.push("AGENT_CHANGED");
    if (previous.category !== current.category) reasons.push("CATEGORY_CHANGED");

    const previousPositionId = stringValue(previous, "positionId");
    const currentPositionId = stringValue(current, "positionId");
    if (!previousPositionId || !currentPositionId || previousPositionId !== currentPositionId) reasons.push("POSITION_ID_CHANGED");

    for (const key of ["tickLower", "tickUpper"] as const) {
      const a = numberValue(previous, key);
      const b = numberValue(current, key);
      if (a === undefined || b === undefined) reasons.push(`${key.toUpperCase()}_MISSING`);
      else if (a !== b) reasons.push(`${key.toUpperCase()}_CHANGED`);
    }

    const previousInRange = booleanValue(previous, "inRange");
    const currentInRange = booleanValue(current, "inRange");
    if (previousInRange === undefined || currentInRange === undefined) reasons.push("RANGE_REGIME_MISSING");
    else if (previousInRange !== currentInRange) reasons.push("RANGE_REGIME_CHANGED");

    const previousTick = numberValue(previous, "currentTick");
    const currentTick = numberValue(current, "currentTick");
    if (previousTick === undefined || currentTick === undefined) reasons.push("CURRENT_TICK_MISSING");
    else if (Math.abs(currentTick - previousTick) > this.policy.maxTickDrift) reasons.push(`TICK_DRIFT_EXCEEDED:${Math.abs(currentTick - previousTick)}`);

    const previousSpot = numberValue(previous, "spotPrice");
    const currentSpot = numberValue(current, "spotPrice");
    if (previousSpot === undefined || currentSpot === undefined) reasons.push("SPOT_PRICE_MISSING");
    else {
      const bps = driftBps(previousSpot, currentSpot);
      if (bps > this.policy.maxSpotPriceDriftBps) reasons.push(`SPOT_PRICE_DRIFT_BPS:${bps.toFixed(4)}`);
    }

    const previousValue = numberValue(previous, "valueUsd");
    const currentValue = numberValue(current, "valueUsd");
    if (previousValue === undefined || currentValue === undefined) reasons.push("POSITION_VALUE_MISSING");
    else {
      const bps = driftBps(previousValue, currentValue);
      if (bps > this.policy.maxPositionValueDriftBps) reasons.push(`POSITION_VALUE_DRIFT_BPS:${bps.toFixed(4)}`);
    }

    const previousLiquidity = numberValue(previous, "poolLiquidityUsd");
    const currentLiquidity = numberValue(current, "poolLiquidityUsd");
    if (previousLiquidity === undefined || currentLiquidity === undefined) reasons.push("POOL_LIQUIDITY_MISSING");
    else {
      const bps = declineBps(previousLiquidity, currentLiquidity);
      if (bps > this.policy.maxPoolLiquidityDeclineBps) reasons.push(`POOL_LIQUIDITY_DECLINE_BPS:${bps.toFixed(4)}`);
    }

    const previousBlock = numberValue(previous, "blockNumber");
    const currentBlock = numberValue(current, "blockNumber");
    if (previousBlock !== undefined && currentBlock !== undefined && currentBlock < previousBlock) reasons.push(`BLOCK_REGRESSION:${previousBlock}->${currentBlock}`);

    const evaluatedAt = this.clock();
    if (!Number.isFinite(Date.parse(evaluatedAt))) throw new Error("REBALANCER_DRIFT_CLOCK_INVALID");
    return {
      drifted: reasons.length > 0,
      reasons,
      evaluatedAt,
      priorSnapshotRoot: previous.marketSnapshotRoot,
      refreshedSnapshotRoot: current.marketSnapshotRoot,
      evidenceRefs: [
        ...previous.evidenceRefs.map((ref) => `prior:${ref}`),
        ...current.evidenceRefs.map((ref) => `refresh:${ref}`)
      ]
    };
  }
}
