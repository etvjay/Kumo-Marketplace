import fs from "node:fs/promises";
import {
  computePreparedActionAuthorizationCommitment,
  sealPreparedActionSimulationReceipt
} from "../packages/financial-agent-kernel/dist/index.js";
import {
  buildAltanaSessionBlueprint,
  grantAltanaAuthority,
  parseLiveRebalancerAuthorizationPackage
} from "../packages/adapters/dist/index.js";

const evidencePath = process.env.KUMO_EVIDENCE_PATH || "evidence/fixtures/rebalancer-prepared-action.json";
const artifact = JSON.parse(await fs.readFile(evidencePath, "utf8"));
const baseAction = artifact.preparedAction;
const simulationReceipt = artifact.simulationReceipt;
if (!baseAction || !simulationReceipt) throw new Error("PREPARED_ACTION_AND_SIMULATION_FIXTURE_REQUIRED");
const action = { ...baseAction, simulationStatus: "PASSED" };
const proposal = {
  id: action.proposalId, agentId: "kumo-rebalancer-reference-bsc-v1", category: "rebalancing", mode: "shadow",
  createdAt: "2026-08-29T04:59:59.000Z", expiresAt: "2026-08-29T05:00:20.000Z", objective: "TEST FIXTURE",
  action: "TEST FIXTURE", disposition: "propose", rationale: "TEST FIXTURE", expectedNetBenefit: 5, estimatedCost: 1,
  evidencePacketRef: "fixture:evidence", evidenceSnapshotRoot: action.evidenceSnapshotRoot, marketSnapshotRoot: action.marketSnapshotRoot, refusalReasons: []
};
const quote = { id: action.quoteId, proposalId: action.proposalId, quotedAt: action.createdAt, expiresAt: action.expiresAt, chainId: 56, venue: "pancakeswap-v3", totalCost: 1, slippageBps: 5, marketSnapshotRoot: action.marketSnapshotRoot };
const previousObservation = {
  id: "fixture:prior-observation",
  agentId: proposal.agentId,
  category: "rebalancing",
  observedAt: "2026-08-29T04:59:58.000Z",
  chainId: 56,
  marketSnapshotRoot: action.marketSnapshotRoot,
  values: {
    positionId: "999001",
    currentTick: -65369,
    tickLower: -64979,
    tickUpper: 887272,
    valueUsd: 100,
    inRange: false,
    poolLiquidityUsd: 10000000,
    spotPrice: 0.00145,
    blockNumber: 118704833
  },
  evidenceRefs: ["fixture:prior:block:118704833"]
};
const authorizationArtifact = {
  preparedAction: baseAction,
  proposal,
  quote,
  previousObservation,
  positionId: "999001"
};
const simulationArtifact = { simulationReceipt };

const parsedPackage = parseLiveRebalancerAuthorizationPackage({ authorizationArtifact, simulationArtifact });
const validPackageParsed = parsedPackage.positionId === "999001"
  && parsedPackage.baseAction.id === baseAction.id
  && parsedPackage.simulationReceipt.receiptCommitment === simulationReceipt.receiptCommitment;

function parserRejects(authorizationMutation, simulationMutation, expectedMessage) {
  try {
    parseLiveRebalancerAuthorizationPackage({
      authorizationArtifact: authorizationMutation ?? authorizationArtifact,
      simulationArtifact: simulationMutation ?? simulationArtifact
    });
    return false;
  } catch (error) {
    if (!expectedMessage) return true;
    return error instanceof Error && error.message.includes(expectedMessage);
  }
}

const proposalLineageRejected = parserRejects({
  ...authorizationArtifact,
  proposal: { ...proposal, id: "proposal:other" }
}, undefined, "LIVE_EXECUTION_PROPOSAL_LINEAGE_MISMATCH");
const chainLineageRejected = parserRejects({
  ...authorizationArtifact,
  quote: { ...quote, chainId: 1 }
}, undefined, "LIVE_EXECUTION_QUOTE_CHAIN_MISMATCH");
const positionLineageRejected = parserRejects({
  ...authorizationArtifact,
  positionId: "999002"
}, undefined, "LIVE_EXECUTION_POSITION_ID_LINEAGE_MISMATCH");
const marketRootLineageRejected = parserRejects({
  ...authorizationArtifact,
  quote: { ...quote, marketSnapshotRoot: "fixture:other-market-root" }
}, undefined, "LIVE_EXECUTION_MARKET_ROOT_LINEAGE_MISMATCH");
const malformedSimulationRejected = parserRejects(undefined, {
  simulationReceipt: { ...simulationReceipt, callResults: "not-an-array" }
});

const now = "2026-08-29T05:00:01.000Z";
const marketDrift = {
  drifted: false,
  reasons: [],
  evaluatedAt: "2026-08-29T05:00:00.500Z",
  priorSnapshotRoot: action.marketSnapshotRoot,
  refreshedSnapshotRoot: "fixture:market-root:refresh:v1",
  evidenceRefs: ["fixture:semantic-refresh:pass"]
};

const blueprint = buildAltanaSessionBlueprint({ action, proposal, quote, marketDrift, simulationReceipt, now, altanaWalletAddress: action.signer });
let staleDriftRejected = false;
try {
  buildAltanaSessionBlueprint({ action, proposal, quote, marketDrift: { ...marketDrift, evaluatedAt: "2026-08-29T04:59:00.000Z" }, simulationReceipt, now, altanaWalletAddress: action.signer });
} catch (error) {
  staleDriftRejected = error instanceof Error && error.message.includes("MARKET_DRIFT_RESULT_STALE");
}
let ownershipRejected = false;
try {
  buildAltanaSessionBlueprint({ action, proposal, quote, marketDrift, simulationReceipt, now, altanaWalletAddress: "0x0000000000000000000000000000000000000001" });
} catch (error) {
  ownershipRejected = error instanceof Error && error.message === "ALTANA_WALLET_DOES_NOT_OWN_PREPARED_ACTION";
}
let unknownSelectorRejected = false;
let unknownSelectorReason;
try {
  const selectorMutatedBase = { ...action, calls: action.calls.map((call, index) => index === 0 ? { ...call, data: "0xdeadbeef" } : call) };
  const selectorMutated = { ...selectorMutatedBase, authorizationCommitment: computePreparedActionAuthorizationCommitment(selectorMutatedBase) };
  const selectorSimulation = sealPreparedActionSimulationReceipt({ ...simulationReceipt, authorizationCommitment: selectorMutated.authorizationCommitment, receiptCommitment: undefined });
  buildAltanaSessionBlueprint({ action: selectorMutated, proposal, quote, marketDrift, simulationReceipt: selectorSimulation, now, altanaWalletAddress: action.signer });
} catch (error) {
  unknownSelectorReason = error instanceof Error ? error.message : String(error);
  unknownSelectorRejected = unknownSelectorReason.startsWith("ALTANA_UNRECOGNIZED_CALL_SELECTOR:");
}
let grantCalls = 0;
const fakePort = {
  async grantSession(input) {
    grantCalls += 1;
    return { walletAddress: input.walletAddress, publicKey: "0x02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", expiry: input.expiry, transactionHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", authorityRef: `altana:fixture:${input.authorizationCommitment}` };
  }
};
const receipt = await grantAltanaAuthority({ blueprint, port: fakePort });
const unique = new Set(blueprint.permissions.calls.map((item) => `${item.to.toLowerCase()}|${item.signature}`));
const callPermissionsUnique = unique.size === blueprint.permissions.calls.length;
const everyCallMethodScoped = blueprint.permissions.calls.every((item) => item.signature.includes("("));
const spendPositive = blueprint.permissions.spend.every((item) => item.limit > 0n && item.period === "minute");
const registered = blueprint.register === true && receipt.registeredInKeyStore === true;
const commitmentBound = receipt.authorizationCommitment === action.authorizationCommitment;
const simulationBound = receipt.simulationReceiptCommitment === simulationReceipt.receiptCommitment;
const exactlyOneGrantAfterAllParserChecks = grantCalls === 1;
const passed = validPackageParsed && proposalLineageRejected && chainLineageRejected && positionLineageRejected
  && marketRootLineageRejected && malformedSimulationRejected && ownershipRejected && staleDriftRejected
  && callPermissionsUnique && everyCallMethodScoped && spendPositive && registered && commitmentBound
  && simulationBound && unknownSelectorRejected && exactlyOneGrantAfterAllParserChecks;

console.log(JSON.stringify({
  schemaVersion: "kumo-altana-session-blueprint-fixture-v5", classification: "TEST_FIXTURE_NOT_LIVE_ALTANA_EVIDENCE",
  status: passed ? "ALTANA_SESSION_BLUEPRINT_FIXTURE_PASS" : "ALTANA_SESSION_BLUEPRINT_FIXTURE_FAIL",
  blueprint: { ...blueprint, permissions: { calls: blueprint.permissions.calls, spend: blueprint.permissions.spend.map((item) => ({ ...item, limit: item.limit.toString() })) } },
  receipt, unknownSelectorReason,
  invariants: {
    validPackageParsed, proposalLineageRejected, chainLineageRejected, positionLineageRejected,
    marketRootLineageRejected, malformedSimulationRejected, ownershipRejected, staleDriftRejected,
    unknownSelectorRejected, callPermissionsUnique, everyCallMethodScoped, spendPositive, registered,
    commitmentBound, simulationBound, exactlyOneGrantAfterAllParserChecks, passed
  }
}, null, 2));
if (!passed) process.exitCode = 1;
