import {
  RebalancerMarketDriftProvider
} from "../packages/reference-agents/dist/rebalancer/index.js";

const provider = new RebalancerMarketDriftProvider();
const context = { agentId: "kumo-rebalancer-reference-bsc-v1", mode: "shadow" };

function observation(overrides = {}) {
  return {
    id: overrides.id ?? "obs:base",
    agentId: "kumo-rebalancer-reference-bsc-v1",
    category: "rebalancing",
    observedAt: overrides.observedAt ?? "2026-08-29T05:00:00.000Z",
    chainId: 56,
    marketSnapshotRoot: overrides.marketSnapshotRoot ?? "root:block:100",
    values: {
      positionId: "123",
      currentTick: -65370,
      tickLower: -65400,
      tickUpper: -65340,
      valueUsd: 10000,
      uncollectedFeesUsd: 10,
      inRange: true,
      poolLiquidityUsd: 10000000,
      spotPrice: 0.00145,
      feeAprEstimate: 0.25,
      realizedVolatilityAnnualized: 0.1,
      blockNumber: 100,
      ...(overrides.values ?? {})
    },
    evidenceRefs: overrides.evidenceRefs ?? ["block:100", "position:123"]
  };
}

const previous = observation();
const proposal = {
  id: "proposal:drift-fixture",
  agentId: context.agentId,
  category: "rebalancing",
  mode: "shadow",
  createdAt: "2026-08-29T05:00:00.000Z",
  expiresAt: "2026-08-29T05:01:00.000Z",
  objective: "fixture",
  action: "fixture",
  disposition: "propose",
  rationale: "fixture",
  evidencePacketRef: "fixture",
  evidenceSnapshotRoot: "fixture",
  marketSnapshotRoot: previous.marketSnapshotRoot,
  refusalReasons: []
};
const quote = {
  id: "quote:fixture",
  proposalId: proposal.id,
  quotedAt: "2026-08-29T05:00:01.000Z",
  expiresAt: "2026-08-29T05:00:30.000Z",
  chainId: 56,
  venue: "pancakeswap-v3",
  totalCost: 1,
  slippageBps: 5,
  marketSnapshotRoot: previous.marketSnapshotRoot
};

const cases = [
  {
    name: "new block only",
    refreshed: observation({
      id: "obs:block101",
      marketSnapshotRoot: "root:block:101",
      values: { blockNumber: 101 },
      evidenceRefs: ["block:101", "position:123"]
    }),
    expectedDrift: false
  },
  {
    name: "small price and tick movement",
    refreshed: observation({
      id: "obs:small",
      marketSnapshotRoot: "root:block:102",
      values: {
        blockNumber: 102,
        currentTick: -65368,
        spotPrice: 0.001450435,
        valueUsd: 10010,
        poolLiquidityUsd: 9995000
      }
    }),
    expectedDrift: false
  },
  {
    name: "price drift exceeds tolerance",
    refreshed: observation({
      id: "obs:price",
      marketSnapshotRoot: "root:block:103",
      values: { blockNumber: 103, spotPrice: 0.00145145 }
    }),
    expectedDrift: true,
    reasonPrefix: "SPOT_PRICE_DRIFT_BPS"
  },
  {
    name: "range regime changes",
    refreshed: observation({
      id: "obs:range-regime",
      marketSnapshotRoot: "root:block:104",
      values: { blockNumber: 104, inRange: false }
    }),
    expectedDrift: true,
    reasonPrefix: "RANGE_REGIME_CHANGED"
  },
  {
    name: "position range changes",
    refreshed: observation({
      id: "obs:range",
      marketSnapshotRoot: "root:block:105",
      values: { blockNumber: 105, tickUpper: -65330 }
    }),
    expectedDrift: true,
    reasonPrefix: "TICKUPPER_CHANGED"
  },
  {
    name: "pool liquidity drops materially",
    refreshed: observation({
      id: "obs:liquidity",
      marketSnapshotRoot: "root:block:106",
      values: { blockNumber: 106, poolLiquidityUsd: 9800000 }
    }),
    expectedDrift: true,
    reasonPrefix: "POOL_LIQUIDITY_DECLINE_BPS"
  }
];

const results = [];
let passed = true;
for (const testCase of cases) {
  const result = await provider.compare({
    context,
    proposal,
    quote,
    previousObservation: previous,
    refreshedObservation: testCase.refreshed
  });
  const reasonOk = !testCase.reasonPrefix
    || result.reasons.some((reason) => reason.startsWith(testCase.reasonPrefix));
  const casePassed = result.drifted === testCase.expectedDrift && reasonOk;
  if (!casePassed) passed = false;
  results.push({ name: testCase.name, expectedDrift: testCase.expectedDrift, result, casePassed });
}

console.log(JSON.stringify({
  schemaVersion: "kumo-rebalancer-market-drift-fixture-v1",
  classification: "TEST_FIXTURE_NOT_LIVE_EVIDENCE",
  provider: provider.id,
  passed,
  results
}, null, 2));

if (!passed) process.exitCode = 1;
