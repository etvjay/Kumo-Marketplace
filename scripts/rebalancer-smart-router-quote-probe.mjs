import fs from "node:fs/promises";
import path from "node:path";
import {
  PancakeSmartRouterQuoteProvider,
  PancakeV3BscReader,
  discoverRecentPancakeV3PositionsForPool
} from "../packages/reference-agents/dist/rebalancer/index.js";

const rpcUrl = process.env.BSC_RPC_URL || "https://bsc-rpc.publicnode.com";
const pool = process.env.KUMO_PREFERRED_POOL_ADDRESS || "0x172fcD41E0913e95784454622d1c3724f546f849";
const outputPath = process.env.KUMO_EVIDENCE_PATH || "evidence/live/rebalancer-smart-router-quote-probe.json";
const slippageBps = Number(process.env.KUMO_QUOTE_SLIPPAGE_BPS || "5");

const json = (value) => JSON.stringify(
  value,
  (_key, item) => typeof item === "bigint" ? item.toString() : item,
  2
);

const output = {
  schemaVersion: "kumo-pancake-smart-router-quote-probe-v1",
  generatedAt: new Date().toISOString(),
  mode: "QUOTE_ONLY_UNSIGNED",
  rpcProvider: new URL(rpcUrl).hostname,
  pool,
  status: "STARTED",
  discovery: undefined,
  snapshot: undefined,
  quote: undefined,
  errors: []
};

async function persist() {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${json(output)}\n`, "utf8");
}

try {
  const rpcProviderId = new URL(rpcUrl).hostname;
  const discovery = await discoverRecentPancakeV3PositionsForPool({
    rpcUrl,
    rpcProviderId,
    pool,
    lookbackBlocks: Number(process.env.KUMO_POOL_LOOKBACK_BLOCKS || "5000"),
    maxTransactions: 32
  });
  output.discovery = {
    blockNumber: discovery.snapshot.blockNumber,
    blockHash: discovery.snapshot.blockHash,
    poolMintEvents: discovery.poolMintEvents,
    tokenIdsResolved: discovery.tokenIdsResolved,
    survivingPositions: discovery.survivingPositions.map((position) => position.tokenId)
  };

  const reader = new PancakeV3BscReader({
    rpcUrl,
    rpcProviderId,
    purpose: "evidence"
  });

  let snapshot;
  for (const candidate of discovery.survivingPositions) {
    try {
      const current = await reader.readPosition(candidate.tokenId);
      if (current.pool.toLowerCase() === pool.toLowerCase() && current.positionLiquidity > 0n) {
        snapshot = current;
        break;
      }
    } catch (error) {
      output.errors.push({
        stage: "POSITION_REVALIDATION",
        tokenId: candidate.tokenId,
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }
  if (!snapshot) throw new Error("NO_SURVIVING_POOL_POSITION_FOR_QUOTE_PROBE");

  const amountIn = 10n ** BigInt(snapshot.token0Decimals);
  const provider = new PancakeSmartRouterQuoteProvider({
    rpcUrl,
    rpcProviderId
  });
  const expiresAt = new Date(Date.now() + 30_000).toISOString();
  const quote = await provider.quoteExactInput({
    tokenIn: snapshot.token0,
    tokenOut: snapshot.token1,
    tokenInDecimals: snapshot.token0Decimals,
    tokenOutDecimals: snapshot.token1Decimals,
    amountIn,
    recipient: snapshot.owner,
    maxSlippageBps: slippageBps,
    expiresAt,
    pool: snapshot.pool,
    feeTier: snapshot.fee,
    sqrtPriceX96: snapshot.sqrtPriceX96,
    poolLiquidity: snapshot.poolLiquidity,
    currentTick: snapshot.currentTick
  });

  output.snapshot = {
    tokenId: snapshot.tokenId,
    owner: snapshot.owner,
    token0: snapshot.token0,
    token1: snapshot.token1,
    fee: snapshot.fee,
    pool: snapshot.pool,
    currentTick: snapshot.currentTick,
    blockNumber: snapshot.blockNumber,
    blockHash: snapshot.blockHash
  };
  output.quote = {
    quoteId: quote.quoteId,
    quotedAt: quote.quotedAt,
    expiresAt: quote.expiresAt,
    router: quote.router,
    tokenIn: quote.tokenIn,
    tokenOut: quote.tokenOut,
    amountIn: quote.amountIn,
    expectedAmountOut: quote.expectedAmountOut,
    calldata: quote.calldata,
    calldataBytes: (quote.calldata.length - 2) / 2,
    value: quote.value,
    routeRef: quote.routeRef,
    evidenceRefs: quote.evidenceRefs
  };
  output.status = "LIVE_UNSIGNED_SMART_ROUTER_QUOTE";
} catch (error) {
  output.status = "QUOTE_PROBE_FAILED";
  output.errors.push({
    stage: "QUOTE_PROBE",
    reason: error instanceof Error ? error.message : String(error)
  });
} finally {
  await persist();
  console.log(json(output));
}
