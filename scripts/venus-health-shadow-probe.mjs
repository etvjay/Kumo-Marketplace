import fs from "node:fs/promises";
import path from "node:path";
import {
  VenusCorePoolReader,
  buildVenusHealthNoemaAssessment,
  decideVenusHealthStrategy
} from "../packages/reference-agents/dist/health/index.js";

const rpcUrl = process.env.BSC_RPC_URL || "https://bsc-dataseed.bnbchain.org";
const account = process.env.VENUS_HEALTH_SHADOW_ACCOUNT || "0x9FBd07c1db2a93b1BB079C6c958DF374EF93fFd9";
const outputPath = process.env.KUMO_EVIDENCE_PATH || "evidence/live/venus-health-shadow-probe.json";
if (!/^0x[0-9a-fA-F]{40}$/.test(account)) throw new Error("VENUS_HEALTH_SHADOW_ACCOUNT_INVALID");

const evaluatedAt = Date.now();
const rpcProviderId = new URL(rpcUrl).hostname;
const reader = new VenusCorePoolReader({ rpcUrl, rpcProviderId, purpose: "evidence" });
const state = await reader.readAccount(account);
const noema = buildVenusHealthNoemaAssessment({
  state,
  principal: `health-guard-shadow:${account.toLowerCase()}`,
  evaluatedAt,
  maxEvidenceAgeMs: 60_000
});
const strategy = decideVenusHealthStrategy(noema);

const expectedCurrentState = "COLLATERAL_ONLY";
const expectedDecision = "MONITOR";
const expectedPhase = "WATCH";
const passed = state.snapshot.blockTag === "finalized"
  && noema.economicObject.verification.status === "PASS"
  && noema.economicObject.status === "RESOLVED"
  && noema.evaluation.decision === "ALLOW"
  && noema.economicObject.economics.positionState === expectedCurrentState
  && strategy.decision === expectedDecision
  && strategy.phase === expectedPhase
  && strategy.rescueExecutionEligible === false
  && strategy.requiresRefreshBeforeExecution === false
  && strategy.inferenceUsed === false;

const output = {
  schemaVersion: "kumo-venus-health-shadow-probe-v1",
  generatedAt: new Date(evaluatedAt).toISOString(),
  classification: "LIVE_READ_ONLY_HEALTH_GUARD_SHADOW_DECISION",
  ownershipClaim: "NONE_PUBLIC_CHAIN_ACCOUNT_ONLY",
  executionClaim: "NONE_NO_TRANSACTION_OR_AUTHORITY_CREATED",
  account,
  rpcProviderId,
  source: {
    blockNumber: state.snapshot.blockNumber,
    blockHash: state.snapshot.blockHash,
    blockTag: state.snapshot.blockTag,
    positionState: noema.economicObject.economics.positionState,
    liveCollateralMarketCount: noema.economicObject.economics.liveCollateralMarketCount,
    debtMarketCount: noema.economicObject.economics.debtMarketCount,
    accountLiquidityMantissa: noema.economicObject.economics.accountLiquidityMantissa,
    accountShortfallMantissa: noema.economicObject.economics.accountShortfallMantissa
  },
  noema: {
    objectId: noema.economicObject.id,
    verification: noema.economicObject.verification.status,
    status: noema.economicObject.status,
    mandateDecision: noema.evaluation.decision,
    inferenceProposalCount: noema.inferenceProposals.length
  },
  strategy,
  invariants: {
    finalized: state.snapshot.blockTag === "finalized",
    noemaVerified: noema.economicObject.verification.status === "PASS",
    noemaResolved: noema.economicObject.status === "RESOLVED",
    mandateAllowed: noema.evaluation.decision === "ALLOW",
    expectedCurrentState: noema.economicObject.economics.positionState === expectedCurrentState,
    expectedDecision: strategy.decision === expectedDecision,
    expectedPhase: strategy.phase === expectedPhase,
    noRescueEligibility: strategy.rescueExecutionEligible === false,
    noExecutionRefreshRequired: strategy.requiresRefreshBeforeExecution === false,
    noInferenceUsed: strategy.inferenceUsed === false,
    passed
  }
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
const json = JSON.stringify(output, null, 2);
await fs.writeFile(outputPath, `${json}\n`, "utf8");
console.log(json);
if (!passed) process.exitCode = 1;
