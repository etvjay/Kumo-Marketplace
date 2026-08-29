import fs from "node:fs/promises";
import { buildAltanaSessionBlueprint, grantAltanaAuthority } from "../packages/adapters/dist/index.js";

const evidencePath = process.env.KUMO_EVIDENCE_PATH || "evidence/fixtures/rebalancer-prepared-action.json";
const artifact = JSON.parse(await fs.readFile(evidencePath, "utf8"));
const baseAction = artifact.preparedAction;
if (!baseAction) throw new Error("PREPARED_ACTION_FIXTURE_REQUIRED");

const action = { ...baseAction, simulationStatus: "PASSED" };
const proposal = {
  id: action.proposalId,
  agentId: "kumo-rebalancer-reference-bsc-v1",
  category: "rebalancing",
  mode: "shadow",
  createdAt: "2026-08-29T04:59:59.000Z",
  expiresAt: "2026-08-29T05:00:20.000Z",
  objective: "TEST FIXTURE",
  action: "TEST FIXTURE",
  disposition: "propose",
  rationale: "TEST FIXTURE",
  expectedNetBenefit: 5,
  estimatedCost: 1,
  evidencePacketRef: "fixture:evidence",
  evidenceSnapshotRoot: action.evidenceSnapshotRoot,
  marketSnapshotRoot: action.marketSnapshotRoot,
  refusalReasons: []
};
const quote = {
  id: action.quoteId,
  proposalId: action.proposalId,
  quotedAt: action.createdAt,
  expiresAt: action.expiresAt,
  chainId: 56,
  venue: "pancakeswap-v3",
  totalCost: 1,
  slippageBps: 5,
  marketSnapshotRoot: action.marketSnapshotRoot
};
const marketDrift = { drifted: false, reasons: [], evidenceRefs: ["fixture:semantic-refresh:pass"] };
const now = "2026-08-29T05:00:01.000Z";

const blueprint = buildAltanaSessionBlueprint({
  action,
  proposal,
  quote,
  marketDrift,
  now,
  altanaWalletAddress: action.signer
});

let ownershipRejected = false;
try {
  buildAltanaSessionBlueprint({
    action,
    proposal,
    quote,
    marketDrift,
    now,
    altanaWalletAddress: "0x0000000000000000000000000000000000000001"
  });
} catch (error) {
  ownershipRejected = error instanceof Error && error.message === "ALTANA_WALLET_DOES_NOT_OWN_PREPARED_ACTION";
}

const fakePort = {
  async grantSession(input) {
    return {
      walletAddress: input.walletAddress,
      publicKey: "0x02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      expiry: input.expiry,
      transactionHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      authorityRef: `altana:fixture:${input.authorizationCommitment}`
    };
  }
};
const receipt = await grantAltanaAuthority({ blueprint, port: fakePort });
const callTargetsUnique = new Set(blueprint.permissions.calls.map((item) => item.to.toLowerCase())).size === blueprint.permissions.calls.length;
const spendPositive = blueprint.permissions.spend.every((item) => item.limit > 0n && item.period === "minute");
const registered = blueprint.register === true && receipt.registeredInKeyStore === true;
const commitmentBound = receipt.authorizationCommitment === action.authorizationCommitment;
const passed = ownershipRejected && callTargetsUnique && spendPositive && registered && commitmentBound;

console.log(JSON.stringify({
  schemaVersion: "kumo-altana-session-blueprint-fixture-v1",
  classification: "TEST_FIXTURE_NOT_LIVE_ALTANA_EVIDENCE",
  status: passed ? "ALTANA_SESSION_BLUEPRINT_FIXTURE_PASS" : "ALTANA_SESSION_BLUEPRINT_FIXTURE_FAIL",
  blueprint: {
    ...blueprint,
    permissions: {
      calls: blueprint.permissions.calls,
      spend: blueprint.permissions.spend.map((item) => ({ ...item, limit: item.limit.toString() }))
    }
  },
  receipt,
  invariants: { ownershipRejected, callTargetsUnique, spendPositive, registered, commitmentBound, passed }
}, null, 2));
if (!passed) process.exitCode = 1;
