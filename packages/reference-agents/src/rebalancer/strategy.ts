import type {
  EvidencePacket,
  ExecutableQuote,
  FinancialAgentStrategy,
  ObservationSnapshot,
  OutcomeRecord,
  StrategyProposal,
  StrategyRunContext
} from "@kumo/financial-agent-kernel";
import {
  chooseCenteredTicks,
  evaluateRebalanceEconomics
} from "./economics.js";
import type {
  RebalancePolicy,
  RebalancerMarketState,
  RebalancerPosition
} from "./types.js";
import type {
  RebalancerFeeModel,
  RebalancerPerformanceProvider,
  RebalancerRiskModel,
  RebalancerVenueProvider
} from "./ports.js";

function root(parts: Array<string | number | boolean | undefined>): string {
  // This is a stable local identifier, not a cryptographic evidence commitment.
  // Production adapters should replace it with canonical serialization + hashing.
  return parts.map((part) => String(part ?? "")).join("|");
}

export interface PancakeV3RebalancerOptions {
  agentId: string;
  positionId: string;
  policy: RebalancePolicy;
  venue: RebalancerVenueProvider;
  feeModel: RebalancerFeeModel;
  riskModel: RebalancerRiskModel;
  performance: RebalancerPerformanceProvider;
  tickSpacing?: number;
  clock?: () => string;
}

export class PancakeV3RebalancerStrategy implements FinancialAgentStrategy {
  readonly id = "kumo-pancakeswap-v3-rebalancer-v1";
  readonly category = "rebalancing" as const;
  private readonly clock: () => string;
  private lastPosition?: RebalancerPosition;
  private lastMarket?: RebalancerMarketState;

  constructor(private readonly options: PancakeV3RebalancerOptions) {
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  async observe(context: StrategyRunContext): Promise<ObservationSnapshot> {
    if (context.agentId !== this.options.agentId) throw new Error("REBALANCER_AGENT_MISMATCH");
    const position = await this.options.venue.getPosition(this.options.positionId);
    const market = await this.options.venue.getMarketState(position);
    this.lastPosition = position;
    this.lastMarket = market;

    const marketSnapshotRoot = root([
      position.positionId,
      position.currentTick,
      position.tickLower,
      position.tickUpper,
      position.valueUsd,
      market.poolAddress,
      market.spotPrice,
      market.liquidityUsd,
      market.blockNumber
    ]);

    return {
      id: `obs:${position.positionId}:${market.observedAt}`,
      agentId: this.options.agentId,
      category: this.category,
      observedAt: market.observedAt,
      chainId: position.chainId,
      marketSnapshotRoot,
      values: {
        positionId: position.positionId,
        currentTick: position.currentTick,
        tickLower: position.tickLower,
        tickUpper: position.tickUpper,
        valueUsd: position.valueUsd,
        uncollectedFeesUsd: position.uncollectedFeesUsd,
        inRange: position.inRange,
        poolLiquidityUsd: market.liquidityUsd,
        spotPrice: market.spotPrice,
        feeAprEstimate: market.feeAprEstimate ?? null,
        realizedVolatilityAnnualized: market.realizedVolatilityAnnualized ?? null,
        blockNumber: market.blockNumber ?? null
      },
      evidenceRefs: [
        `position:${position.positionId}`,
        `pool:${market.poolAddress}`,
        ...(market.blockNumber !== undefined ? [`block:${market.blockNumber}`] : [])
      ]
    };
  }

  async investigate(input: {
    context: StrategyRunContext;
    observation: ObservationSnapshot;
  }): Promise<EvidencePacket> {
    if (!this.lastPosition || !this.lastMarket) throw new Error("REBALANCER_OBSERVATION_REQUIRED");
    const createdAt = this.clock();
    return {
      id: `evidence:${this.lastPosition.positionId}:${createdAt}`,
      agentId: this.options.agentId,
      category: this.category,
      createdAt,
      evidenceRoot: root([
        input.observation.marketSnapshotRoot,
        this.lastPosition.observedAt,
        this.lastMarket.observedAt,
        this.lastMarket.blockNumber
      ]),
      claims: [
        {
          id: "position-range-state",
          kind: "observation",
          statement: this.lastPosition.inRange ? "Position is currently in range" : "Position is currently out of range",
          supportRefs: input.observation.evidenceRefs
        },
        {
          id: "pool-liquidity-state",
          kind: "observation",
          statement: `Pool liquidity observed at ${this.lastMarket.liquidityUsd} USD`,
          supportRefs: input.observation.evidenceRefs
        }
      ],
      sourceRefs: input.observation.evidenceRefs
    };
  }

  async propose(input: {
    context: StrategyRunContext;
    observation: ObservationSnapshot;
    evidence: EvidencePacket;
  }): Promise<StrategyProposal> {
    if (!this.lastPosition || !this.lastMarket) throw new Error("REBALANCER_OBSERVATION_REQUIRED");

    const target = chooseCenteredTicks({
      currentTick: this.lastPosition.currentTick,
      targetRangeWidthBps: this.options.policy.targetRangeWidthBps,
      tickSpacing: this.options.tickSpacing
    });

    const estimatedFeeImprovementUsd = await this.options.feeModel.estimateFeeImprovementUsd({
      position: this.lastPosition,
      market: this.lastMarket,
      targetTickLower: target.tickLower,
      targetTickUpper: target.tickUpper
    });
    const estimatedImpermanentLossDeltaUsd = await this.options.riskModel.estimateImpermanentLossDeltaUsd({
      position: this.lastPosition,
      market: this.lastMarket,
      targetTickLower: target.tickLower,
      targetTickUpper: target.tickUpper
    });

    // Quote-derived costs are checked again later. Proposal-time estimates remain
    // conservative and must not be treated as executable economics.
    const estimatedGasCostUsd = Math.min(this.options.policy.maxGasCostUsd, this.options.policy.maxTotalExecutionCostUsd);
    const estimatedSlippageCostUsd = this.lastPosition.valueUsd * this.options.policy.maxSlippageBps / 10_000;

    const economics = evaluateRebalanceEconomics({
      position: this.lastPosition,
      market: this.lastMarket,
      policy: this.options.policy,
      targetTickLower: target.tickLower,
      targetTickUpper: target.tickUpper,
      estimatedFeeImprovementUsd,
      estimatedImpermanentLossDeltaUsd,
      estimatedGasCostUsd,
      estimatedSlippageCostUsd
    });

    const createdAt = this.clock();
    const expiresAt = new Date(Date.parse(createdAt) + this.options.policy.proposalTtlSeconds * 1000).toISOString();

    return {
      id: `proposal:${this.lastPosition.positionId}:${createdAt}`,
      agentId: this.options.agentId,
      category: this.category,
      mode: input.context.mode,
      createdAt,
      expiresAt,
      objective: "Keep a PancakeSwap V3 LP position productively in range when executable net benefit justifies repositioning",
      action: economics.shouldRebalance
        ? `Recenter position ${this.lastPosition.positionId} to ticks ${target.tickLower}:${target.tickUpper}`
        : `Hold position ${this.lastPosition.positionId}`,
      disposition: economics.shouldRebalance ? "propose" : "refuse",
      rationale: economics.shouldRebalance
        ? `Expected net benefit ${economics.expectedNetBenefitUsd.toFixed(2)} USD after estimated IL and execution costs`
        : `Rebalance refused: ${economics.reasons.join(", ")}`,
      expectedNetBenefit: economics.expectedNetBenefitUsd,
      estimatedCost: economics.estimatedTotalCostUsd,
      evidencePacketRef: input.evidence.id,
      evidenceSnapshotRoot: input.evidence.evidenceRoot,
      marketSnapshotRoot: input.observation.marketSnapshotRoot,
      refusalReasons: economics.reasons
    };
  }

  async quote(input: {
    context: StrategyRunContext;
    observation: ObservationSnapshot;
    evidence: EvidencePacket;
    proposal: StrategyProposal;
  }): Promise<ExecutableQuote | null> {
    if (input.proposal.disposition === "refuse") return null;
    if (!this.lastPosition || !this.lastMarket) throw new Error("REBALANCER_OBSERVATION_REQUIRED");

    const target = chooseCenteredTicks({
      currentTick: this.lastPosition.currentTick,
      targetRangeWidthBps: this.options.policy.targetRangeWidthBps,
      tickSpacing: this.options.tickSpacing
    });
    const quote = await this.options.venue.quoteRebalance({
      position: this.lastPosition,
      market: this.lastMarket,
      targetTickLower: target.tickLower,
      targetTickUpper: target.tickUpper,
      maxSlippageBps: this.options.policy.maxSlippageBps,
      quoteTtlSeconds: this.options.policy.quoteTtlSeconds
    });

    return {
      id: quote.quoteId,
      proposalId: input.proposal.id,
      quotedAt: quote.quotedAt,
      expiresAt: quote.expiresAt,
      chainId: this.lastPosition.chainId,
      venue: this.lastPosition.venue,
      totalCost: quote.totalCostUsd,
      slippageBps: quote.slippageBps,
      gasCost: quote.gasCostUsd,
      amountIn: undefined,
      expectedAmountOut: undefined,
      liquidityScore: this.lastMarket.liquidityUsd > this.options.policy.minPoolLiquidityUsd ? 1 : 0,
      quoteRef: quote.rawQuoteRef ?? quote.quoteId,
      marketSnapshotRoot: input.observation.marketSnapshotRoot
    };
  }

  async refresh(input: {
    context: StrategyRunContext;
    proposal: StrategyProposal;
    previousObservation: ObservationSnapshot;
  }): Promise<ObservationSnapshot> {
    return this.observe(input.context);
  }

  async measure(input: {
    context: StrategyRunContext;
    receipt: { id: string };
    baselineRef?: string;
  }): Promise<OutcomeRecord> {
    const result = await this.options.performance.measure({
      positionId: this.options.positionId,
      receiptId: input.receipt.id,
      baselineRef: input.baselineRef
    });
    const delta = result.metrics.netValueVsBaselineUsd;
    const outcome = delta === undefined
      ? "undetermined"
      : delta > 0
        ? "beneficial"
        : delta < 0
          ? "harmful"
          : "neutral";

    return {
      id: `outcome:${input.receipt.id}:${result.measuredAt}`,
      proposalId: input.receipt.id,
      receiptId: input.receipt.id,
      measuredAt: result.measuredAt,
      baselineRef: input.baselineRef,
      outcome,
      metrics: result.metrics,
      evidenceRefs: result.evidenceRefs
    };
  }
}
