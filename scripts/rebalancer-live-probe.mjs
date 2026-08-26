import fs from "node:fs/promises";
import path from "node:path";
import {
  ChainlinkBscUsdPriceProvider,
  PancakeV3BscReader,
  preparePancakeV3LivePosition
} from "../packages/reference-agents/dist/rebalancer/index.js";

const rpcUrl = process.env.BSC_RPC_URL || "https://bsc-dataseed.bnbchain.org";
const maxCandidates = Number(process.env.KUMO_PANCAKE_SCAN_LIMIT || "48");
const outputPath = process.env.KUMO_EVIDENCE_PATH || "evidence/live/rebalancer-live-probe.json";

const json = (value) => JSON.stringify(
  value,
  (_key, item) => typeof item === "bigint" ? item.toString() : item,
  2
);

const result = {
  schemaVersion: "kumo-rebalancer-live-probe-v1",
  generatedAt: new Date().toISOString(),
  mode: "READ_ONLY",
  rpcProvider: new URL(rpcUrl).hostname,
  requestedScanLimit: maxCandidates,
  status: "STARTED",
  discovery: undefined,
  selectedCandidate: undefined,
  preparation: undefined,
  rejections: []
};

async function persist() {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${json(result)}\n`, "utf8");
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

  const discovery = await reader.discoverRecentPositions(maxCandidates);
  result.discovery = {
    snapshot: discovery.snapshot,
    totalSupply: discovery.totalSupply,
    scanned: discovery.scanned,
    supportedPairCandidates: discovery.positions
      .filter((position) => priceProvider.supports(position.token0) && priceProvider.supports(position.token1))
      .map((position) => ({
        tokenId: position.tokenId,
        owner: position.owner,
        token0: position.token0,
        token1: position.token1,
        fee: position.fee,
        liquidity: position.liquidity.toString()
      }))
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
      result.rejections.push({
        tokenId: candidate.tokenId,
        code: prepared.code,
        reason: prepared.reason
      });
      continue;
    }

    result.selectedCandidate = {
      tokenId: candidate.tokenId,
      owner: prepared.snapshot.owner,
      pool: prepared.snapshot.pool,
      token0: prepared.snapshot.token0,
      token1: prepared.snapshot.token1,
      fee: prepared.snapshot.fee
    };
    result.preparation = {
      snapshot: prepared.snapshot,
      token0Price: prepared.token0Price,
      token1Price: prepared.token1Price,
      valuation: prepared.valuation,
      baseline: prepared.baseline,
      evidenceRefs: prepared.evidenceRefs
    };
    result.status = "LIVE_POSITION_PREPARED";
    break;
  }

  if (result.status !== "LIVE_POSITION_PREPARED") {
    result.status = candidates.length === 0
      ? "NO_SUPPORTED_LIVE_POSITION_IN_SCAN_WINDOW"
      : "SUPPORTED_POSITIONS_FAILED_PREPARATION";
  }
} catch (error) {
  result.status = "PROBE_FAILED";
  result.rejections.push({
    code: "PROBE_EXCEPTION",
    reason: error instanceof Error ? error.message : String(error)
  });
} finally {
  await persist();
  console.log(json(result));
}
