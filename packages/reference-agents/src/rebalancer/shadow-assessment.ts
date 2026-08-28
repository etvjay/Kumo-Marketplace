import type { StrategyRunContext } from "@kumo/financial-agent-kernel";
import type { NoemaAgentAssessment } from "@kumo/noema-agent-profile";
import {
  buildRebalancerShadowDecision,
  type RebalancerShadowDecisionRecord
} from "./baseline.js";
import type { PancakeV3LivePreparationSuccess } from "./live-preparation.js";
import {
  GeckoTerminalBscMarketDataProvider,
  grossPoolFeeApr,
  realizedHourlyVolatilityAnnualized,
  type GeckoTerminalOhlcvSnapshot,
  type GeckoTerminalPoolSnapshot
} from "./geckoterminal-market-data.js";
import type { LiquidityPositionEconomicState } from "./noema.js";
import {
  StaticShadowRebalancerVenue,
  UnmeasuredShadowPerformanceProvider,
  V3ConcentrationRiskModel,
  V3RangeFeeOpportunityModel
} from "./shadow-models.js";
import { PancakeV3RebalancerStrategy } from "./strategy.js";
import type {
  RebalancePolicy,
  RebalancerMarketState,
  RebalancerPosition
} from "./types.js";

export interface RebalancerLiveShadowAssessment {
  mode: "SHADOW";
  preparedPositionId: string;
  marketData: GeckoTerminalPoolSnapshot;
  ohlcv: GeckoTerminalOhlcvSnapshot;
  modelOutputs: {
    realizedVolatilityAnnualized: number;
    grossPoolFeeAprEstimate: number;
    volatilityModel: "hourly-log-return-sample-vol-v1";
    feeModel: "kumo-v3-range-fee-opportunity-v1";
    riskModel: "kumo-v3-concentration-risk-v1";
    horizonHours: number;
  };
  domainPosition: RebalancerPosition;
  domainMarket: RebalancerMarketState;
  observation: Awaited<ReturnType<PancakeV3RebalancerStrategy["observe"]>>;
  evidence: Awaited<ReturnType<PancakeV3RebalancerStrategy["investigate"]>>;
  proposal: Awaited<ReturnType<PancakeV3RebalancerStrategy["propose"]>>;
  noema: NoemaAgentAssessment<LiquidityPositionEconomicState>;
  shadowDecision: RebalancerShadowDecisionRecord;
  sourceEvidenceRefs: string[];
  limitations: string[];
}

export async function assessPancakeV3LiveShadow(input: {
  prepared: PancakeV3LivePreparationSuccess;
  marketDataProvider: GeckoTerminalBscMarketDataProvider;
  policy: RebalancePolicy;
  agentId?: string;
  mandatePrincipal?: string;
  horizonHours?: number;
}): Promise<RebalancerLiveShadowAssessment> {
  const horizonHours = input.horizonHours ?? 24;
  const [marketData, ohlcv] = await Promise.all([
    input.marketDataProvider.getPoolSnapshot(input.prepared.snapshot.pool),
    input.marketDataProvider.getHourlyOhlcv(input.prepared.snapshot.pool, Math.max(24, horizonHours + 1))
  ]);

  if (marketData.poolAddress !== input.prepared.snapshot.pool) throw new Error("SHADOW_POOL_IDENTITY_MISMATCH");
  if (marketData.dexId !== "pancakeswap_v3") throw new Error(`SHADOW_UNEXPECTED_DEX:${marketData.dexId}`);

  const realizedVolatilityAnnualized = realizedHourlyVolatilityAnnualized(ohlcv.candles);
  const grossPoolFeeAprEstimate = grossPoolFeeApr({
    volume24hUsd: marketData.volume24hUsd,
    reserveUsd: marketData.reserveUsd,
    feeTier: input.prepared.snapshot.fee
  });

  const position: RebalancerPosition = {
    chainId: 56,
    venue: "pancakeswap-v3",
    positionId: input.prepared.snapshot.tokenId,
    token0: input.prepared.snapshot.token0,
    token1: input.prepared.snapshot.token1,
    feeTier: input.prepared.snapshot.fee,
    tickLower: input.prepared.snapshot.tickLower,
    tickUpper: input.prepared.snapshot.tickUpper,
    currentTick: input.prepared.snapshot.currentTick,
    amount0: input.prepared.valuation.principalAmount0,
    amount1: input.prepared.valuation.principalAmount1,
    valueUsd: input.prepared.valuation.markedValueIncludingCrystallizedFeesUsd,
    // Current schema name is retained for compatibility. For this live adapter,
    // the value is only the directly evidenced crystallized fee floor.
    uncollectedFeesUsd: input.prepared.valuation.crystallizedFeesFloorUsd,
    inRange: input.prepared.valuation.priceRegion === "IN_RANGE",
    observedAt: input.prepared.snapshot.observedAt,
    blockNumber: Number(input.prepared.snapshot.blockNumber)
  };

  const market: RebalancerMarketState = {
    chainId: 56,
    venue: "pancakeswap-v3",
    poolAddress: input.prepared.snapshot.pool,
    token0PriceUsd: input.prepared.valuation.token0PriceUsd,
    token1PriceUsd: input.prepared.valuation.token1PriceUsd,
    spotPrice: input.prepared.valuation.spotToken1PerToken0,
    realizedVolatilityAnnualized,
    liquidityUsd: marketData.reserveUsd,
    volume24hUsd: marketData.volume24hUsd,
    feeAprEstimate: grossPoolFeeAprEstimate,
    observedAt: marketData.fetchedAt,
    blockNumber: Number(input.prepared.snapshot.blockNumber)
  };

  const venue = new StaticShadowRebalancerVenue(position, market);
  const feeModel = new V3RangeFeeOpportunityModel(horizonHours);
  const riskModel = new V3ConcentrationRiskModel(horizonHours);
  const strategy = new PancakeV3RebalancerStrategy({
    agentId: input.agentId ?? "kumo-rebalancer-reference-bsc-v1",
    positionId: position.positionId,
    policy: input.policy,
    venue,
    feeModel,
    riskModel,
    performance: new UnmeasuredShadowPerformanceProvider(),
    mandatePrincipal: input.mandatePrincipal ?? "kumo:shadow-evaluation",
    tickSpacing: 1
  });

  const context: StrategyRunContext = {
    agentId: input.agentId ?? "kumo-rebalancer-reference-bsc-v1",
    mode: "shadow",
    requestedExecutionChainId: 56,
    metadata: {
      baselineId: input.prepared.baseline.id,
      feeValueSemantics: "CRYSTALLIZED_FEE_FLOOR_ONLY",
      marketDataEvidenceRef: marketData.evidenceRef,
      ohlcvEvidenceRef: ohlcv.evidenceRef
    }
  };

  const observation = await strategy.observe(context);
  const evidence = await strategy.investigate({ context, observation });
  const proposal = await strategy.propose({ context, observation, evidence });
  const noema = strategy.getNoemaAssessment();
  if (!noema) throw new Error("SHADOW_NOEMA_ASSESSMENT_MISSING");

  const shadowDecision = buildRebalancerShadowDecision({
    baseline: input.prepared.baseline,
    proposal,
    noema
  });

  return {
    mode: "SHADOW",
    preparedPositionId: position.positionId,
    marketData,
    ohlcv,
    modelOutputs: {
      realizedVolatilityAnnualized,
      grossPoolFeeAprEstimate,
      volatilityModel: "hourly-log-return-sample-vol-v1",
      feeModel: "kumo-v3-range-fee-opportunity-v1",
      riskModel: "kumo-v3-concentration-risk-v1",
      horizonHours
    },
    domainPosition: position,
    domainMarket: market,
    observation,
    evidence,
    proposal,
    noema,
    shadowDecision,
    sourceEvidenceRefs: [
      ...input.prepared.evidenceRefs,
      marketData.evidenceRef,
      ohlcv.evidenceRef
    ],
    limitations: [
      "GeckoTerminal reserve and volume are sourced market data fetched after the finalized chain snapshot; they are not block-bound protocol state.",
      "Gross pool fee APR is volume × fee-tier annualized over pool reserve; it is not realized position APR.",
      "Fee opportunity uses a terminal in-range probability proxy over sourced realized volatility; it is an inference, not a forecast guarantee.",
      "The concentration-risk model is a conservative heuristic, not an exact impermanent-loss calculator.",
      "No executable PancakeSwap remove/collect/swap/mint quote is produced in this shadow assessment.",
      "The field uncollectedFeesUsd currently carries only the directly evidenced crystallized tokensOwed fee floor for compatibility with the existing domain schema."
    ]
  };
}
