import fs from "node:fs/promises";
import path from "node:path";
import {
  VenusCorePoolReader,
  buildVenusHealthNoemaAssessment
} from "../packages/reference-agents/dist/health/index.js";

const rpcUrl = process.env.BSC_RPC_URL || "https://bsc-dataseed.bnbchain.org";
const account = process.env.VENUS_NOEMA_ACCOUNT || "0x9FBd07c1db2a93b1BB079C6c958DF374EF93fFd9";
const outputPath = process.env.KUMO_EVIDENCE_PATH || "evidence/live/venus-health-noema-live-probe.json";
if (!/^0x[0-9a-fA-F]{40}$/.test(account)) throw new Error("VENUS_NOEMA_ACCOUNT_INVALID");

const evaluatedAt = Date.now();
const rpcProviderId = new URL(rpcUrl).hostname;
const reader = new VenusCorePoolReader({ rpcUrl, rpcProviderId, purpose: "evidence" });
const state = await reader.readAccount(account);
const assessment = buildVenusHealthNoemaAssessment({
  state,
  principal: `public-chain-observer:${account.toLowerCase()}`,
  evaluatedAt,
  maxEvidenceAgeMs: 60_000
});

const passed = assessment.economicObject.verification.status === "PASS"
  && assessment.economicObject.status === "RESOLVED"
  && assessment.evaluation.decision === "ALLOW"
  && assessment.inferenceProposals.length === 0
  && assessment.economicObject.economics.finalizedBlockHash === state.snapshot.blockHash
  && assessment.economicObject.economics.finalizedBlockNumber === state.snapshot.blockNumber;

const output = {
  schemaVersion: "kumo-venus-health-noema-live-probe-v1",
  generatedAt: new Date(evaluatedAt).toISOString(),
  classification: "LIVE_READ_ONLY_NOEMA_ASSESSMENT",
  ownershipClaim: "NONE_PUBLIC_CHAIN_ACCOUNT_ONLY",
  borrowerRiskClaim: "NONE_UNLESS_CURRENT_DEBT_IS_OBSERVED",
  account,
  rpcProviderId,
  state,
  noema: assessment,
  invariants: {
    finalized: state.snapshot.blockTag === "finalized",
    verificationPassed: assessment.economicObject.verification.status === "PASS",
    objectResolved: assessment.economicObject.status === "RESOLVED",
    mandateAllowed: assessment.evaluation.decision === "ALLOW",
    noInferencePromoted: assessment.inferenceProposals.length === 0,
    blockLineagePreserved: assessment.economicObject.economics.finalizedBlockHash === state.snapshot.blockHash
      && assessment.economicObject.economics.finalizedBlockNumber === state.snapshot.blockNumber,
    passed
  }
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
const json = JSON.stringify(output, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2);
await fs.writeFile(outputPath, `${json}\n`, "utf8");
console.log(json);
if (!passed) process.exitCode = 1;
