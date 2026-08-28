import fs from "node:fs/promises";
import path from "node:path";
import {
  ChainlinkBscUsdPriceProvider,
  GeckoTerminalBscMarketDataProvider,
  PancakeV3BscReader,
  assessPancakeV3LiveShadow,
  discoverRecentPancakeV3PositionsForPool,
  preparePancakeV3LivePosition
} from "../packages/reference-agents/dist/rebalancer/index.js";

const rpcUrl = process.env.BSC_RPC_URL || "https://bsc-dataseed.bnbchain.org";
const maxCandidates = Number(process.env.KUMO_PANCAKE_SCAN_LIMIT || "64");
const preferredTokenIds = (process.env.KUMO_PREFERRED_TOKEN_IDS || "7255622")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const preferredPools = (process.env.KUMO_PREFERRED_POOL_ADDRESSES || "0x172fcD41E0913e95784454622d1c3724f546f849")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const outputPath = process.env.KUMO_EVIDENCE_PATH || "evidence/live/rebalancer-shadow-probe.json";

const policy = {
  targetRangeWidthBps: Number(process.env.KUMO_TARGET_RANGE_WIDTH_BPS || "30"),
  edgeBufferBps: Number(process.env.KUMO_EDGE_BUFFER_BPS || "5"),
  minDriftBps: Number(process.env.KUMO_MIN_DRIFT_BPS || "5"),
  minExpectedNetBenefitUsd: Number(process.env.KUMO_MIN_NET_BENEFIT_USD || "1"),
  maxSlippageBps: Number(process.env.KUMO_MAX_SLIPPAGE_BPS || "5"),
  maxGasCostUsd: Number(process.env.KUMO_MAX_GAS_COST_USD || "1.5"),
  maxTotalExecutionCostUsd: Number(process.env.KUMO_MAX_EXECUTION_COST_USD || "5"),
  maxPositionValueUsd: Number(process.env.KUMO_MAX_POSITION_VALUE_USD || "100000"),
  minPoolLiquidityUsd: Number(process.env.KUMO_MIN_POOL_LIQUIDITY_USD || "1000000"),
  maxVolatilityAnnualized: Number(process.env.KUMO_MAX_VOLATILITY || "2.5"),
  allowOutOfRangeImmediateRecenter: true,
  observationMaxAgeSeconds: Number(process.env.KUMO_OBSERVATION_MAX_AGE_SECONDS || "180"),
  proposalTtlSeconds: 90,
  quoteTtlSeconds: 30
};

const json = (value) => JSON.stringify(
  value,
  (_key, item) => typeof item === "bigint" ? item.toString() : item,
  2
);

const output = {
  schemaVersion: "kumo-rebalancer-live-shadow-v1",
  generatedAt: new Date().toISOString(),
  mode: "SHADOW_READ_ONLY",
  rpcProvider: new URL(rpcUrl).hostname,
  policy,
  preferredTokenIds,
  preferredPools,
  status: "STARTED",
  discovery: undefined,
  poolDiscovery: [],
  selectedCandidate: undefined,
  preparation: undefined,
  shadowAssessment: undefined,
  rejections: []
};

async function persist() {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${json(output)}\n`, "utf8");
}

try {
  const rpcProviderId = new URL(rpcUrl).hostname;
  const reader = new PancakeV3BscReader({
    rpcUrl,
    rpcProviderId,
    purpose: "evidence"
  });
  const priceProvider = new ChainlinkBscUsdPriceProvider({
    rpcUrl,
    rpcProviderId
  });
  const marketDataProvider = new GeckoTerminalBscMarketDataProvider();

  const candidateIds = [];
  const seen = new Set();

  // Prior evidence is a locator hint only. It must survive a fresh finalized
  // ownerOf/positions read later before it can become current evidence.
  for (const tokenId of preferredTokenIds) {
    if (!seen.has(tokenId)) {
      seen.add(tokenId);
      candidateIds.push({ tokenId, source: "REVALIDATED_PRIOR_EVIDENCE" });
    }
  }

  // Primary discovery is venue-scoped. This avoids querying the global NPM
  // Transfer firehose, which the public BSC RPC can reject even for one busy block.
  for (const pool of preferredPools) {
    try {
      const result = await discoverRecentPancakeV3PositionsForPool({
        rpcUrl,
        rpcProviderId,
        pool,
        lookbackBlocks: Number(process.env.KUMO_POOL_LOOKBACK_BLOCKS || "50000"),
        maxTransactions: Number(process.env.KUMO_POOL_MAX_TRANSACTIONS || "96")
      });
      const supported = result.survivingPositions.filter((position) =>
        position.liquidity > 0n
        && priceProvider.supports(position.token0)
        && priceProvider.supports(position.token1)
      );
      output.poolDiscovery.push({
        snapshot: result.snapshot,
        pool: result.pool,
        fromBlock: result.fromBlock,
        toBlock: result.toBlock,
        poolMintEvents: result.poolMintEvents,
        transactionsInspected: result.transactionsInspected,
        tokenIdsResolved: result.tokenIdsResolved,
        survivingPositions: result.survivingPositions.length,
        supportedCandidates: supported.map((position) => position.tokenId)
      });
      for (const position of supported) {
        if (!seen.has(position.tokenId)) {
          seen.add(position.tokenId);
          candidateIds.push({ tokenId: position.tokenId, source: `POOL_ACTIVITY:${result.pool}` });
        }
      }
    } catch (error) {
      output.rejections.push({
        pool,
        stage: "POOL_DISCOVERY",
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // Enumeration is an independent fallback for long-lived positions.
  const discovery = await reader.discoverRecentPositions(maxCandidates);
  const supportedInEnumeration = discovery.positions.filter((position) =>
    position.liquidity > 0n
    && priceProvider.supports(position.token0)
    && priceProvider.supports(position.token1)
  );
  output.discovery = {
    snapshot: discovery.snapshot,
    totalSupply: discovery.totalSupply,
    scanned: discovery.scanned,
    supportedInScan: supportedInEnumeration.map((position) => position.tokenId)
  };

  for (const position of supportedInEnumeration) {
    if (!seen.has(position.tokenId)) {
      seen.add(position.tokenId);
      candidateIds.push({ tokenId: position.tokenId, source: "CURRENT_ENUMERATION" });
    }
  }

  for (const candidate of candidateIds) {
    const prepared = await preparePancakeV3LivePosition({
      tokenId: candidate.tokenId,
      reader,
      priceProvider
    });
    if (!prepared.ok) {
      output.rejections.push({
        tokenId: candidate.tokenId,
        source: candidate.source,
        stage: "PREPARATION",
        code: prepared.code,
        reason: prepared.reason
      });
      continue;
    }

    if (!priceProvider.supports(prepared.snapshot.token0) || !priceProvider.supports(prepared.snapshot.token1)) {
      output.rejections.push({
        tokenId: candidate.tokenId,
        source: candidate.source,
        stage: "PRICE_SUPPORT",
        reason: "CURRENT_POSITION_ASSETS_NOT_SUPPORTED_BY_CHAINLINK_PRICE_PROFILE"
      });
      continue;
    }

    try {
      const shadow = await assessPancakeV3LiveShadow({
        prepared,
        marketDataProvider,
        policy,
        horizonHours: 24
      });
      output.selectedCandidate = {
        tokenId: candidate.tokenId,
        candidateSource: candidate.source,
        owner: prepared.snapshot.owner,
        pool: prepared.snapshot.pool,
        token0: prepared.snapshot.token0,
        token1: prepared.snapshot.token1,
        fee: prepared.snapshot.fee
      };
      output.preparation = {
        blockNumber: prepared.snapshot.blockNumber,
        blockHash: prepared.snapshot.blockHash,
        valuation: prepared.valuation,
        baseline: prepared.baseline,
        evidenceRefs: prepared.evidenceRefs
      };
      output.shadowAssessment = shadow;
      output.status = shadow.proposal.disposition === "propose"
        ? "LIVE_SHADOW_REBALANCE_PROPOSED"
        : "LIVE_SHADOW_HOLD";
      break;
    } catch (error) {
      output.rejections.push({
        tokenId: candidate.tokenId,
        source: candidate.source,
        stage: "SHADOW_ASSESSMENT",
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }

  if (!output.shadowAssessment) {
    output.status = candidateIds.length === 0
      ? "NO_SUPPORTED_LIVE_POSITION_DISCOVERED"
      : "NO_CANDIDATE_COMPLETED_SHADOW_ASSESSMENT";
  }
} catch (error) {
  output.status = "SHADOW_PROBE_FAILED";
  output.rejections.push({
    stage: "PROBE",
    reason: error instanceof Error ? error.message : String(error)
  });
} finally {
  await persist();
  console.log(json(output));
}
