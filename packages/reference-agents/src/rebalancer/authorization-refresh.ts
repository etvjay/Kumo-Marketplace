import type {
  ExecutableQuote,
  MarketDriftResult,
  ObservationSnapshot,
  StrategyProposal,
  StrategyRunContext
} from "@kumo/financial-agent-kernel";
import type { ChainlinkBscUsdPriceProvider } from "./chainlink-price-provider.js";
import type { GeckoTerminalBscMarketDataProvider } from "./geckoterminal-market-data.js";
import {
  preparePancakeV3LivePosition,
  type PancakeV3LivePreparationSuccess
} from "./live-preparation.js";
import type { PancakeV3BscReader } from "./pancakeswap-v3-reader.js";
import {
  RebalancerMarketDriftProvider,
  type RebalancerMarketDriftPolicy
} from "./market-drift.js";

function root(parts: Array<string | number | boolean | undefined>): string {
  return parts.map((part) => String(part ?? "")).join("|");
}

export interface RebalancerAuthorizationRefreshResult {
  prepared: PancakeV3LivePreparationSuccess;
  refreshedObservation: ObservationSnapshot;
  marketDrift: MarketDriftResult;
}

/**
 * Re-reads one live Pancake position immediately before authority creation and
 * compares it semantically with the exact observation on which the proposal
 * was based. This function creates no session and sends no transaction.
 */
export async function refreshPancakeV3AuthorizationState(input: {
  tokenId: string;
  expectedOwner: string;
  agentId: string;
  previousObservation: ObservationSnapshot;
  proposal: StrategyProposal;
  quote: ExecutableQuote | null;
  reader: PancakeV3BscReader;
  priceProvider: ChainlinkBscUsdPriceProvider;
  marketDataProvider: GeckoTerminalBscMarketDataProvider;
  driftPolicy?: RebalancerMarketDriftPolicy;
  clock?: () => string;
}): Promise<RebalancerAuthorizationRefreshResult> {
  if (input.proposal.marketSnapshotRoot !== input.previousObservation.marketSnapshotRoot) {
    throw new Error("AUTH_REFRESH_PROPOSAL_PRIOR_ROOT_MISMATCH");
  }
  const prepared = await preparePancakeV3LivePosition({
    tokenId: input.tokenId,
    reader: input.reader,
    priceProvider: input.priceProvider
  });
  if (!prepared.ok) throw new Error(`AUTH_REFRESH_POSITION_PREPARATION_FAILED:${prepared.code}:${prepared.reason}`);
  if (prepared.snapshot.owner.toLowerCase() !== input.expectedOwner.toLowerCase()) {
    throw new Error("AUTH_REFRESH_POSITION_OWNER_MISMATCH");
  }
  if (prepared.snapshot.tokenId !== input.tokenId) throw new Error("AUTH_REFRESH_POSITION_ID_MISMATCH");

  const marketData = await input.marketDataProvider.getPoolSnapshot(prepared.snapshot.pool);
  if (marketData.poolAddress.toLowerCase() !== prepared.snapshot.pool.toLowerCase()) {
    throw new Error("AUTH_REFRESH_POOL_IDENTITY_MISMATCH");
  }

  const observedAtMs = Math.max(
    Date.parse(prepared.snapshot.observedAt),
    Date.parse(marketData.fetchedAt)
  );
  if (!Number.isFinite(observedAtMs)) throw new Error("AUTH_REFRESH_OBSERVATION_TIME_INVALID");
  const observedAt = new Date(observedAtMs).toISOString();
  const valueUsd = prepared.valuation.markedValueIncludingCrystallizedFeesUsd;
  const spotPrice = prepared.valuation.spotToken1PerToken0;
  const blockNumber = Number(prepared.snapshot.blockNumber);
  if (!Number.isSafeInteger(blockNumber)) throw new Error("AUTH_REFRESH_BLOCK_NUMBER_UNSAFE");

  const marketSnapshotRoot = root([
    prepared.snapshot.tokenId,
    prepared.snapshot.currentTick,
    prepared.snapshot.tickLower,
    prepared.snapshot.tickUpper,
    valueUsd,
    prepared.snapshot.pool,
    spotPrice,
    marketData.reserveUsd,
    blockNumber
  ]);

  const refreshedObservation: ObservationSnapshot = {
    id: `auth-refresh:${prepared.snapshot.tokenId}:${observedAt}`,
    agentId: input.agentId,
    category: "rebalancing",
    observedAt,
    chainId: 56,
    marketSnapshotRoot,
    values: {
      positionId: prepared.snapshot.tokenId,
      currentTick: prepared.snapshot.currentTick,
      tickLower: prepared.snapshot.tickLower,
      tickUpper: prepared.snapshot.tickUpper,
      valueUsd,
      uncollectedFeesUsd: prepared.valuation.crystallizedFeesFloorUsd,
      inRange: prepared.valuation.priceRegion === "IN_RANGE",
      poolLiquidityUsd: marketData.reserveUsd,
      spotPrice,
      blockNumber
    },
    evidenceRefs: [
      ...prepared.evidenceRefs,
      marketData.evidenceRef
    ]
  };

  const context: StrategyRunContext = {
    agentId: input.agentId,
    mode: input.proposal.mode,
    requestedExecutionChainId: 56
  };
  const driftProvider = new RebalancerMarketDriftProvider(input.driftPolicy, input.clock);
  const marketDrift = await driftProvider.compare({
    context,
    proposal: input.proposal,
    quote: input.quote,
    previousObservation: input.previousObservation,
    refreshedObservation
  });

  return { prepared, refreshedObservation, marketDrift };
}
