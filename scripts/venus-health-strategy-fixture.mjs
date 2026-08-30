import { decideVenusHealthStrategy } from "../packages/reference-agents/dist/health/index.js";

function assessment(overrides = {}) {
  const economics = {
    chainId: 56,
    protocol: "venus-core",
    account: "0x00000000000000000000000000000000000000aa",
    positionState: "NO_POSITION",
    accountLiquidityMantissa: "0",
    accountShortfallMantissa: "0",
    liveCollateralMarketCount: 0,
    debtMarketCount: 0,
    enteredMarketCount: 0,
    listedMarketCount: 52,
    finalizedBlockNumber: "1",
    finalizedBlockHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ...(overrides.economics || {})
  };
  return {
    profileVersion: "0.1.0",
    upstreamRef: "etvjay/Noema@d8a2cc388f1d4b82d1bb71328aa366d8628c3913",
    economicObject: {
      id: "noema:venus-lending-position:56:fixture",
      version: 1,
      objectType: "VENUS_CORE_LENDING_POSITION",
      classification: { primary: "LENDING_POSITION", secondary: ["VENUS_CORE", economics.positionState], confidence: 1, claimRef: "claim:classification" },
      economics,
      claims: [],
      evidence: [],
      verification: { status: overrides.verificationStatus || "PASS", verifierVersion: "fixture", checks: [] },
      status: overrides.objectStatus || "RESOLVED",
      createdAt: 1,
      updatedAt: 1
    },
    mandate: {
      id: "mandate:fixture",
      version: 1,
      principal: "fixture",
      objective: "fixture",
      economicObjectType: "VENUS_CORE_LENDING_POSITION",
      requiredClaims: [],
      constraints: {}
    },
    evaluation: {
      id: "evaluation:fixture",
      objectId: "noema:venus-lending-position:56:fixture",
      objectVersion: 1,
      mandateId: "mandate:fixture",
      mandateVersion: 1,
      decision: overrides.mandateDecision || "ALLOW",
      reasonCodes: overrides.reasonCodes || [],
      supportingClaims: [],
      evidenceRefs: [],
      verificationStatus: overrides.verificationStatus || "PASS",
      evaluatedAt: 1
    },
    inferenceProposals: overrides.inferenceProposals || []
  };
}

const cases = [
  { name: "no position", input: assessment(), decision: "IGNORE", phase: "HEALTHY", rescue: false },
  { name: "collateral only", input: assessment({ economics: { positionState: "COLLATERAL_ONLY", accountLiquidityMantissa: "10", liveCollateralMarketCount: 1 } }), decision: "MONITOR", phase: "WATCH", rescue: false },
  { name: "debt only", input: assessment({ economics: { positionState: "DEBT_ONLY", debtMarketCount: 1 } }), decision: "PREPARE", phase: "WARN", rescue: false },
  { name: "borrowing solvent", input: assessment({ economics: { positionState: "BORROWING_SOLVENT", accountLiquidityMantissa: "10", liveCollateralMarketCount: 1, debtMarketCount: 1 } }), decision: "MONITOR", phase: "WATCH", rescue: false },
  { name: "at liquidation threshold", input: assessment({ economics: { positionState: "BORROWING_AT_LIQUIDATION_THRESHOLD", liveCollateralMarketCount: 1, debtMarketCount: 1 } }), decision: "PREPARE", phase: "PREPARE", rescue: false },
  { name: "liquidation eligible", input: assessment({ economics: { positionState: "LIQUIDATION_ELIGIBLE", accountShortfallMantissa: "5", liveCollateralMarketCount: 1, debtMarketCount: 1 } }), decision: "RESCUE", phase: "RESCUE", rescue: true },
  { name: "debt-only liquidation eligible", input: assessment({ economics: { positionState: "LIQUIDATION_ELIGIBLE", accountShortfallMantissa: "5", debtMarketCount: 1 } }), decision: "RESCUE", phase: "RESCUE", rescue: true },
  { name: "unverified object", input: assessment({ verificationStatus: "FAIL" }), decision: "REFUSE", phase: "UNVERIFIED", rescue: false },
  { name: "stale object", input: assessment({ objectStatus: "STALE" }), decision: "REFUSE", phase: "UNVERIFIED", rescue: false },
  { name: "blocked mandate", input: assessment({ mandateDecision: "BLOCK", reasonCodes: ["TEST_BLOCK"] }), decision: "REFUSE", phase: "UNVERIFIED", rescue: false },
  { name: "unexpected inference", input: assessment({ inferenceProposals: [{ id: "inference:1" }] }), decision: "REFUSE", phase: "UNVERIFIED", rescue: false },
  { name: "fake liquidation label with zero shortfall", input: assessment({ economics: { positionState: "LIQUIDATION_ELIGIBLE", liveCollateralMarketCount: 1, debtMarketCount: 1 } }), decision: "REFUSE", phase: "UNVERIFIED", rescue: false },
  { name: "fake solvent label with zero liquidity", input: assessment({ economics: { positionState: "BORROWING_SOLVENT", liveCollateralMarketCount: 1, debtMarketCount: 1 } }), decision: "REFUSE", phase: "UNVERIFIED", rescue: false },
  { name: "fake collateral-only label with debt", input: assessment({ economics: { positionState: "COLLATERAL_ONLY", liveCollateralMarketCount: 1, debtMarketCount: 1 } }), decision: "REFUSE", phase: "UNVERIFIED", rescue: false }
];

let passed = true;
const results = cases.map((testCase) => {
  const result = decideVenusHealthStrategy(testCase.input);
  const casePassed = result.decision === testCase.decision
    && result.phase === testCase.phase
    && result.rescueExecutionEligible === testCase.rescue
    && result.inferenceUsed === false;
  if (!casePassed) passed = false;
  return {
    name: testCase.name,
    expected: { decision: testCase.decision, phase: testCase.phase, rescueExecutionEligible: testCase.rescue },
    actual: { decision: result.decision, phase: result.phase, rescueExecutionEligible: result.rescueExecutionEligible },
    reasonCodes: result.reasonCodes,
    casePassed
  };
});

console.log(JSON.stringify({
  schemaVersion: "kumo-venus-health-strategy-fixture-v1",
  classification: "TEST_FIXTURE_NOT_LIVE_EVIDENCE",
  passed,
  results
}, null, 2));
if (!passed) process.exitCode = 1;
