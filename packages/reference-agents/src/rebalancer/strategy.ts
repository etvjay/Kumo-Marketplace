import type {
  EvidencePacket,
  ExecutableQuote,
  ExecutionReceipt,
  FinancialAgentStrategy,
  ObservationSnapshot,
  OutcomeRecord,
  StrategyProposal,
  StrategyRunContext
} from "@kumo/financial-agent-kernel";
import type {
  NoemaAgentAssessment,
  NoemaAgentClaim,
  NoemaStandardAgent
} from "@kumo/noema-agent-profile";
import {
  chooseCenteredTicks,
  evaluateRebalanceEconomics
} from "./economics.js";
import {
  buildLiquidityPositionEconomicObject,
  buildRebalanceMandate,
  buildRebalancerNoemaAssessment,
  type LiquidityPositionEconomicState
} from "./noema.js";
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

function noemaClaimKind(claim: NoemaAgentClaim): "observation" | "source-assertion" | "inference" | "assumption" {
  if (claim.state === "INFERRED") return "inference";
  if (claim.state === "UNKNOWN") return "assumption";
  if (claim.state === "SOURCED" || claim.state === "ATTESTED") return "source-assertion";
  return "observation";
}

export interface PancakeV3RebalancerOptions {
  agentId: string;
  positionId: string;
  policy: RebalancePolicy;
  venue: RebalancerVenueProvider;
  feeModel: RebalancerFeeModel;
  riskModel: RebalancerRiskModel;
  performance: RebalancerPerformanceProvider;
  mandatePrincipal?: string;
  tickSpacing?: number;
  clock?: () => string;
}

export class PancakeV3RebalancerStrategy
  implements FinancialAgentStrategy, NoemaStandardAgent<LiquidityPositionEconomicState> {
  readonly id = "kumo-pancakeswap-v3-rebalancer-v1";
  readonly category = "rebalancing" as const;
  private readonly clock: () => string;
  private lastPosition?: RebalancerPosition;
  private lastMarket?: RebalancerMarketState;
  private lastNoemaObject?: ReturnType<typeof buildLiquidityPositionEconomicObject>;
  private lastNoemaAssessment?: NoemaAgentAssessment<LiquidityPositionEconomicState>;

  constructor(private readonly options: PancakeV3RebalancerOptions) {
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  getNoemaAssessment(): NoemaAgentAssessment<LiquidityPositionEconomicState> | undefined {
    return this.lastNoemaAssessment;
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
    const evaluatedAt = Date.parse(createdAt);
    if (!Number.isFinite(evaluatedAt)) throw new Error("REBALANCER_INVALID_CLOCK");

    this.lastNoemaObject = buildLiquidityPositionEconomicObject({
      position: this.lastPosition,
      market: this.lastMarket,
      policy: this.options.policy,
      venueSourceRef: this.options.venue.id,
      evaluatedAt
    });

    return {
      id: `evidence:${this.lastPosition.positionId}:${createdAt}`,
      agentId: this.options.agentId,
      category: this.category,
      createdAt,
      evidenceRoot: root([
        input.observation.marketSnapshotRoot,
        this.lastNoemaObject.id,
        this.lastNoemaObject.version,
        this.lastNoemaObject.status,
        this.lastNoemaObject.verification.status
      ]),
      claims: this.lastNoemaObject.claims.map((claim) => ({
        id: claim.id,
        kind: noemaClaimKind(claim),
        statement: `${claim.property}=${JSON.stringify(claim.value)} [${claim.state}]`,
        supportRefs: claim.evidenceRefs,
        confidence: claim.confidence
      })),
      sourceRefs: this.lastNoemaObject.evidence.map((evidence) => evidence.id)
    };
  }

  async propose(input: {
    context: StrategyRunContext;
    observation: ObservationSnapshot;
    evidence: EvidencePacket;
  }): Promise<StrategyProposal> {
    if (!this.lastPosition || !this.lastMarket || !this.lastNoemaObject) {
      throw new Error("REBALANCER_NOEMA_OBJECT_REQUIRED");
    }

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
    const evaluatedAt = Date.parse(createdAt);
    if (!Number.isFinite(evaluatedAt)) throw new Error("REBALANCER_INVALID_CLOCK");

    const mandate = buildRebalanceMandate({
      positionId: this.lastPosition.positionId,
      principal: this.options.mandatePrincipal ?? "kumo:reference-agent-policy",
      policy: this.options.policy
    });

    this.lastNoemaAssessment = buildRebalancerNoemaAssessment({
      economicObject: this.lastNoemaObject,
      mandate,
      economics,
      policy: this.options.policy,
      feeModelRef: this.options.feeModel.id,
      riskModelRef: this.options.riskModel.id,
      evaluatedAt
    });

    const noemaAllows = this.lastNoemaAssessment.evaluation.decision === "ALLOW";
    const shouldPropose = economics.shouldRebalance && noemaAllows;
    const refusalReasons = [
      ...economics.reasons,
      ...(!noemaAllows
        ? this.lastNoemaAssessment.evaluation.reasonCodes.map((reason) => `NOEMA:${reason}`)
        : [])
    ];
    const expiresAt = new Date(evaluatedAt + this.options.policy.proposalTtlSeconds * 1000).toISOString();

    return {
      id: `proposal:${this.lastPosition.positionId}:${createdAt}`,
      agentId: this.options.agentId,
      category: this.category,
      mode: input.context.mode,
      createdAt,
      expiresAt,
      objective: "Keep a PancakeSwap V3 LP position productively in range when executable net benefit justifies repositioning",
      action: shouldPropose
        ? `Recenter position ${this.lastPosition.positionId} to ticks ${target.tickLower}:${target.tickUpper}`
        : `Hold position ${this.lastPosition.positionId}`,
      disposition: shouldPropose ? "propose" : "refuse",
      rationale: shouldPropose
        ? `Noema mandate ALLOW; expected net benefit ${economics.expectedNetBenefitUsd.toFixed(2)} USD after estimated IL and execution costs`
        : `Rebalance refused: ${refusalReasons.join(", ")}`,
      expectedNetBenefit: economics.expectedNetBenefitUsd,
      estimatedCost: economics.estimatedTotalCostUsd,
      evidencePacketRef: input.evidence.id,
      evidenceSnapshotRoot: input.evidence.evidenceRoot,
      marketSnapshotRoot: input.observation.marketSnapshotRoot,
      refusalReasons
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
    receipt: ExecutionReceipt;
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
      proposalId: input.receipt.proposalId,
      receiptId: input.receipt.id,
      measuredAt: result.measuredAt,
      baselineRef: input.baselineRef,
      outcome,
      metrics: result.metrics,
      evidenceRefs: result.evidenceRefs
    };
  }
}
