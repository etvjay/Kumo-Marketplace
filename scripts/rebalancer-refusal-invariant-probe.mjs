import fs from "node:fs/promises";
import path from "node:path";
import {
  ChainlinkBscUsdPriceProvider,
  GeckoTerminalBscMarketDataProvider,
  PancakeV3BscReader,
  PancakeV3UnsignedTransactionPreparer,
  assessPancakeV3LiveShadow,
  discoverRecentPancakeV3PositionsForPool,
  preparePancakeV3LivePosition
} from "../packages/reference-agents/dist/rebalancer/index.js";

const rpcUrl = process.env.BSC_RPC_URL || "https://bsc-rpc.publicnode.com";
const pool = process.env.KUMO_PREFERRED_POOL_ADDRESS || "0x172fcD41E0913e95784454622d1c3724f546f849";
const outputPath = process.env.KUMO_EVIDENCE_PATH || "evidence/live/rebalancer-refusal-invariant-probe.json";

const policy = {
  targetRangeWidthBps: 30,
  edgeBufferBps: 5,
  minDriftBps: 5,
  minExpectedNetBenefitUsd: 1,
  maxSlippageBps: 5,
  maxGasCostUsd: 1.5,
  maxTotalExecutionCostUsd: 5,
  maxPositionValueUsd: 100000,
  minPoolLiquidityUsd: 1000000,
  maxVolatilityAnnualized: 2.5,
  allowOutOfRangeImmediateRecenter: true,
  observationMaxAgeSeconds: 180,
  proposalTtlSeconds: 90,
  quoteTtlSeconds: 30
};

const json = (value) => JSON.stringify(
  value,
  (_key, item) => typeof item === "bigint" ? item.toString() : item,
  2
);

const output = {
  schemaVersion: "kumo-rebalancer-refusal-invariant-v1",
  generatedAt: new Date().toISOString(),
  mode: "LIVE_READ_ONLY_NEGATIVE_PROOF",
  pool,
  status: "STARTED",
  candidate: undefined,
  strategy: undefined,
  invariant: undefined,
  errors: []
};

async function persist() {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${json(output)}\n`, "utf8");
}

let failed = false;
try {
  const rpcProviderId = new URL(rpcUrl).hostname;
  const reader = new PancakeV3BscReader({ rpcUrl, rpcProviderId, purpose: "evidence" });
  const priceProvider = new ChainlinkBscUsdPriceProvider({ rpcUrl, rpcProviderId });
  const marketDataProvider = new GeckoTerminalBscMarketDataProvider();
  const discovery = await discoverRecentPancakeV3PositionsForPool({
    rpcUrl,
    rpcProviderId,
    pool,
    lookbackBlocks: 5000,
    maxTransactions: 32
  });

  let selected;
  for (const candidate of discovery.survivingPositions) {
    if (!priceProvider.supports(candidate.token0) || !priceProvider.supports(candidate.token1)) continue;
    const prepared = await preparePancakeV3LivePosition({ tokenId: candidate.tokenId, reader, priceProvider });
    if (!prepared.ok) continue;
    try {
      const shadow = await assessPancakeV3LiveShadow({
        prepared,
        marketDataProvider,
        policy,
        horizonHours: 24
      });
      if (shadow.proposal.disposition === "refuse") {
        selected = { candidate, prepared, shadow };
        break;
      }
    } catch (error) {
      output.errors.push({
        stage: "SHADOW_ASSESSMENT",
        tokenId: candidate.tokenId,
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }

  if (!selected) throw new Error("NO_CURRENT_LIVE_HOLD_CANDIDATE");

  let quoteProviderCalled = false;
  const bombQuoteProvider = {
    id: "must-not-be-called-for-refused-proposal",
    async quoteExactInput() {
      quoteProviderCalled = true;
      throw new Error("REFUSAL_INVARIANT_BREACH_QUOTE_PROVIDER_CALLED");
    }
  };
  const preparer = new PancakeV3UnsignedTransactionPreparer(bombQuoteProvider);

  let rejection;
  try {
    await preparer.prepare({
      prepared: selected.prepared,
      proposal: selected.shadow.proposal,
      policy
    });
    rejection = { thrown: false };
  } catch (error) {
    rejection = {
      thrown: true,
      message: error instanceof Error ? error.message : String(error)
    };
  }

  const passed = rejection.thrown
    && rejection.message === "STRATEGY_REFUSED_ACTION"
    && quoteProviderCalled === false;

  output.candidate = {
    tokenId: selected.candidate.tokenId,
    owner: selected.prepared.snapshot.owner,
    pool: selected.prepared.snapshot.pool,
    blockNumber: selected.prepared.snapshot.blockNumber,
    blockHash: selected.prepared.snapshot.blockHash,
    valueUsd: selected.prepared.valuation.markedValueIncludingCrystallizedFeesUsd
  };
  output.strategy = {
    noemaDecision: selected.shadow.noema.evaluation.decision,
    disposition: selected.shadow.proposal.disposition,
    action: selected.shadow.proposal.action,
    rationale: selected.shadow.proposal.rationale,
    expectedNetBenefitUsd: selected.shadow.proposal.expectedNetBenefit,
    estimatedCostUsd: selected.shadow.proposal.estimatedCost,
    refusalReasons: selected.shadow.proposal.refusalReasons
  };
  output.invariant = {
    statement: "A refused strategy proposal cannot be converted into a PreparedAction or invoke the quote provider.",
    rejection,
    quoteProviderCalled,
    preparedActionCreated: false,
    passed
  };
  output.status = passed ? "LIVE_REFUSAL_INVARIANT_PASS" : "LIVE_REFUSAL_INVARIANT_FAIL";
  failed = !passed;
} catch (error) {
  failed = true;
  output.status = "LIVE_REFUSAL_INVARIANT_NOT_PROVEN";
  output.errors.push({
    stage: "PROBE",
    reason: error instanceof Error ? error.message : String(error)
  });
} finally {
  await persist();
  console.log(json(output));
  if (failed) process.exitCode = 1;
}
