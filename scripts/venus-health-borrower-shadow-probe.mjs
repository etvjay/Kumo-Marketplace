import fs from "node:fs/promises";
import path from "node:path";
import {
  KUMO_VENUS_HEALTH_POLICY_V1,
  VenusCorePoolReader,
  buildVenusHealthNoemaAssessment,
  decideVenusHealthStrategy
} from "../packages/reference-agents/dist/health/index.js";

const rpcUrl = process.env.BSC_RPC_URL || "https://bsc-dataseed.bnbchain.org";
const account = process.env.VENUS_HEALTH_BORROWER_ACCOUNT || "0x234B55149E4795feE12019692D504cBb1FB6F3b7";
const outputPath = process.env.KUMO_EVIDENCE_PATH || "evidence/live/venus-health-borrower-shadow-probe.json";
if (!/^0x[0-9a-fA-F]{40}$/.test(account)) throw new Error("VENUS_HEALTH_BORROWER_ACCOUNT_INVALID");

const evaluatedAt = Date.now();
const rpcProviderId = new URL(rpcUrl).hostname;
const reader = new VenusCorePoolReader({ rpcUrl, rpcProviderId, purpose: "evidence" });
const state = await reader.readAccount(account);
const noema = buildVenusHealthNoemaAssessment({
  state,
  principal: `health-guard-borrower-shadow:${account.toLowerCase()}`,
  evaluatedAt,
  maxEvidenceAgeMs: 60_000
});
const strategy = decideVenusHealthStrategy(noema);
const economics = noema.economicObject.economics;
const thresholdUtilization = economics.thresholdUtilizationBps === null
  ? null
  : BigInt(economics.thresholdUtilizationBps);

const currentDebtObserved = economics.debtMarketCount > 0
  && BigInt(economics.protocolBorrowContributionMantissa) > 0n;
const belowWarnBand = thresholdUtilization !== null
  && thresholdUtilization < KUMO_VENUS_HEALTH_POLICY_V1.warnThresholdUtilizationBps;

const passed = state.snapshot.blockTag === "finalized"
  && currentDebtObserved
  && noema.economicObject.verification.status === "PASS"
  && noema.economicObject.status === "RESOLVED"
  && noema.evaluation.decision === "ALLOW"
  && economics.nativeLiquidityExactMatch === true
  && economics.positionState === "BORROWING_SOLVENT"
  && economics.liquidationBufferState === "SOLVENT_WITH_BUFFER"
  && belowWarnBand
  && strategy.decision === "MONITOR"
  && strategy.phase === "WATCH"
  && strategy.rescueExecutionEligible === false
  && strategy.requiresRefreshBeforeExecution === false
  && strategy.inferenceUsed === false;

const output = {
  schemaVersion: "kumo-venus-health-borrower-shadow-probe-v1",
  generatedAt: new Date(evaluatedAt).toISOString(),
  classification: "LIVE_READ_ONLY_CURRENT_BORROWER_HEALTH_GUARD_SHADOW_DECISION",
  ownershipClaim: "NONE_PUBLIC_CHAIN_ACCOUNT_ONLY",
  executionClaim: "NONE_NO_TRANSACTION_OR_AUTHORITY_CREATED",
  account,
  rpcProviderId,
  source: {
    finalizedBlockNumber: state.snapshot.blockNumber,
    finalizedBlockHash: state.snapshot.blockHash,
    positionState: economics.positionState,
    debtMarketCount: economics.debtMarketCount,
    accountLiquidityMantissa: economics.accountLiquidityMantissa,
    accountShortfallMantissa: economics.accountShortfallMantissa,
    nativeLiquidityExactMatch: economics.nativeLiquidityExactMatch,
    protocolCollateralContributionMantissa: economics.protocolCollateralContributionMantissa,
    protocolBorrowContributionMantissa: economics.protocolBorrowContributionMantissa,
    liquidationBufferState: economics.liquidationBufferState,
    thresholdUtilizationBps: economics.thresholdUtilizationBps,
    liquidationBufferBpsOfBorrow: economics.liquidationBufferBpsOfBorrow
  },
  noema: {
    objectVersion: noema.economicObject.version,
    verifierVersion: noema.economicObject.verification.verifierVersion,
    verification: noema.economicObject.verification.status,
    status: noema.economicObject.status,
    mandateDecision: noema.evaluation.decision,
    inferenceProposalCount: noema.inferenceProposals.length
  },
  policy: {
    id: KUMO_VENUS_HEALTH_POLICY_V1.id,
    warnThresholdUtilizationBps: KUMO_VENUS_HEALTH_POLICY_V1.warnThresholdUtilizationBps.toString(),
    prepareThresholdUtilizationBps: KUMO_VENUS_HEALTH_POLICY_V1.prepareThresholdUtilizationBps.toString(),
    semantics: KUMO_VENUS_HEALTH_POLICY_V1.semantics
  },
  strategy,
  invariants: {
    finalized: state.snapshot.blockTag === "finalized",
    currentDebtObserved,
    noemaVerified: noema.economicObject.verification.status === "PASS",
    noemaResolved: noema.economicObject.status === "RESOLVED",
    mandateAllowed: noema.evaluation.decision === "ALLOW",
    exactNativeLiquidityReconstruction: economics.nativeLiquidityExactMatch === true,
    currentBorrowerSolvent: economics.positionState === "BORROWING_SOLVENT",
    solventBufferObserved: economics.liquidationBufferState === "SOLVENT_WITH_BUFFER",
    belowWarnBand,
    expectedWatchDecision: strategy.decision === "MONITOR" && strategy.phase === "WATCH",
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
