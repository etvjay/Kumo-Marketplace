import fs from "node:fs/promises";
import path from "node:path";
import {
  ChainlinkBscUsdPriceProvider,
  GeckoTerminalBscMarketDataProvider,
  PancakeV3BscReader,
  assessPancakeV3LiveShadow,
  preparePancakeV3LivePosition
} from "../packages/reference-agents/dist/rebalancer/index.js";

const rpcUrl = process.env.BSC_RPC_URL || "https://bsc-dataseed.bnbchain.org";
const maxCandidates = Number(process.env.KUMO_PANCAKE_SCAN_LIMIT || "64");
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
  status: "STARTED",
  discovery: undefined,
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
  const reader = new PancakeV3BscReader({
    rpcUrl,
    rpcProviderId: new URL(rpcUrl).hostname,
    purpose: "evidence"
  });
  const priceProvider = new ChainlinkBscUsdPriceProvider({
    rpcUrl,
    rpcProviderId: new URL(rpcUrl).hostname
  });
  const marketDataProvider = new GeckoTerminalBscMarketDataProvider();

  const discovery = await reader.discoverRecentPositions(maxCandidates);
  output.discovery = {
    snapshot: discovery.snapshot,
    totalSupply: discovery.totalSupply,
    scanned: discovery.scanned
  };

  const candidates = discovery.positions.filter((position) =>
    position.liquidity > 0n
    && priceProvider.supports(position.token0)
    && priceProvider.supports(position.token1)
  );

  for (const candidate of candidates) {
    const prepared = await preparePancakeV3LivePosition({
      tokenId: candidate.tokenId,
      reader,
      priceProvider
    });
    if (!prepared.ok) {
      output.rejections.push({ tokenId: candidate.tokenId, stage: "PREPARATION", code: prepared.code, reason: prepared.reason });
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
        stage: "SHADOW_ASSESSMENT",
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }

  if (!output.shadowAssessment) {
    output.status = candidates.length === 0
      ? "NO_SUPPORTED_LIVE_POSITION_IN_SCAN_WINDOW"
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
