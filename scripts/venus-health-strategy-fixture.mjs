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
    accountEffectivePolicyObserved: true,
    differentiatedRiskPolicyMarketCount: 0,
    marketRisk: [],
    nativeLiquidityReconstructionRule: "VENUS_CORE_EFFECTIVE_LIQUIDATION_THRESHOLD_EXP_V1",
    nativeLiquidityExactMatch: true,
    protocolCollateralContributionMantissa: "0",
    protocolBorrowContributionMantissa: "0",
    liquidationBufferState: "NO_DEBT",
    thresholdUtilizationBps: "0",
    liquidationBufferBpsOfBorrow: null,
    finalizedBlockNumber: "1",
    finalizedBlockHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ...(overrides.economics || {})
  };
  return {
    profileVersion: "0.1.0",
    upstreamRef: "etvjay/Noema@d8a2cc388f1d4b82d1bb71328aa366d8628c3913",
    economicObject: {
      id: "noema:venus-lending-position:56:fixture",
      version: 2,
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
      version: 2,
      principal: "fixture",
      objective: "fixture",
      economicObjectType: "VENUS_CORE_LENDING_POSITION",
      requiredClaims: [],
      constraints: {}
    },
    evaluation: {
      id: "evaluation:fixture",
      objectId: "noema:venus-lending-position:56:fixture",
      objectVersion: 2,
      mandateId: "mandate:fixture",
      mandateVersion: 2,
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

function solvent(utilizationBps, overrides = {}) {
  return assessment({
    ...overrides,
    economics: {
      positionState: "BORROWING_SOLVENT",
      accountLiquidityMantissa: "10",
      liveCollateralMarketCount: 1,
      debtMarketCount: 1,
      nativeLiquidityExactMatch: true,
      protocolCollateralContributionMantissa: "100",
      protocolBorrowContributionMantissa: "50",
      liquidationBufferState: "SOLVENT_WITH_BUFFER",
      thresholdUtilizationBps: String(utilizationBps),
      liquidationBufferBpsOfBorrow: "10000",
      ...(overrides.economics || {})
    }
  });
}

const cases = [
  { name: "no position", input: assessment(), decision: "IGNORE", phase: "HEALTHY", rescue: false },
  { name: "collateral only", input: assessment({ economics: { positionState: "COLLATERAL_ONLY", accountLiquidityMantissa: "10", liveCollateralMarketCount: 1, protocolCollateralContributionMantissa: "10" } }), decision: "MONITOR", phase: "WATCH", rescue: false },
  { name: "debt only", input: assessment({ economics: { positionState: "DEBT_ONLY", debtMarketCount: 1, protocolBorrowContributionMantissa: "5", liquidationBufferState: "SOLVENT_WITH_BUFFER", thresholdUtilizationBps: null } }), decision: "PREPARE", phase: "WARN", rescue: false },

  { name: "borrowing solvent comfortable", input: solvent(5244), decision: "MONITOR", phase: "WATCH", rescue: false },
  { name: "warn boundary minus one", input: solvent(7999), decision: "MONITOR", phase: "WATCH", rescue: false },
  { name: "warn boundary", input: solvent(8000), decision: "MONITOR", phase: "WARN", rescue: false },
  { name: "prepare boundary minus one", input: solvent(9090), decision: "MONITOR", phase: "WARN", rescue: false },
  { name: "prepare boundary", input: solvent(9091), decision: "PREPARE", phase: "PREPARE", rescue: false },
  { name: "high solvent utilization", input: solvent(9999), decision: "PREPARE", phase: "PREPARE", rescue: false },

  { name: "at liquidation threshold", input: assessment({ economics: { positionState: "BORROWING_AT_LIQUIDATION_THRESHOLD", liveCollateralMarketCount: 1, debtMarketCount: 1, protocolCollateralContributionMantissa: "100", protocolBorrowContributionMantissa: "100", liquidationBufferState: "AT_LIQUIDATION_THRESHOLD", thresholdUtilizationBps: "10000" } }), decision: "PREPARE", phase: "PREPARE", rescue: false },
  { name: "liquidation eligible", input: assessment({ economics: { positionState: "LIQUIDATION_ELIGIBLE", accountShortfallMantissa: "5", liveCollateralMarketCount: 1, debtMarketCount: 1, protocolCollateralContributionMantissa: "100", protocolBorrowContributionMantissa: "105", liquidationBufferState: "LIQUIDATION_ELIGIBLE", thresholdUtilizationBps: "10500" } }), decision: "RESCUE", phase: "RESCUE", rescue: true },
  { name: "debt-only liquidation eligible", input: assessment({ economics: { positionState: "LIQUIDATION_ELIGIBLE", accountShortfallMantissa: "5", debtMarketCount: 1, protocolBorrowContributionMantissa: "5", liquidationBufferState: "LIQUIDATION_ELIGIBLE", thresholdUtilizationBps: null } }), decision: "RESCUE", phase: "RESCUE", rescue: true },

  { name: "unverified object", input: assessment({ verificationStatus: "FAIL" }), decision: "REFUSE", phase: "UNVERIFIED", rescue: false },
  { name: "stale object", input: assessment({ objectStatus: "STALE" }), decision: "REFUSE", phase: "UNVERIFIED", rescue: false },
  { name: "blocked mandate", input: assessment({ mandateDecision: "BLOCK", reasonCodes: ["TEST_BLOCK"] }), decision: "REFUSE", phase: "UNVERIFIED", rescue: false },
  { name: "unexpected inference", input: assessment({ inferenceProposals: [{ id: "inference:1" }] }), decision: "REFUSE", phase: "UNVERIFIED", rescue: false },
  { name: "non-equivalent native reconstruction", input: solvent(8000, { economics: { nativeLiquidityExactMatch: false, liquidationBufferState: null, thresholdUtilizationBps: null } }), decision: "REFUSE", phase: "UNVERIFIED", rescue: false },
  { name: "missing liquidation buffer", input: solvent(8000, { economics: { liquidationBufferState: null, thresholdUtilizationBps: null } }), decision: "REFUSE", phase: "UNVERIFIED", rescue: false },
  { name: "solvent label with no-debt buffer", input: solvent(8000, { economics: { liquidationBufferState: "NO_DEBT", liquidationBufferBpsOfBorrow: null } }), decision: "REFUSE", phase: "UNVERIFIED", rescue: false },
  { name: "threshold label with solvent buffer", input: assessment({ economics: { positionState: "BORROWING_AT_LIQUIDATION_THRESHOLD", liveCollateralMarketCount: 1, debtMarketCount: 1, liquidationBufferState: "SOLVENT_WITH_BUFFER", thresholdUtilizationBps: "10000" } }), decision: "REFUSE", phase: "UNVERIFIED", rescue: false },
  { name: "fake liquidation label with zero shortfall", input: assessment({ economics: { positionState: "LIQUIDATION_ELIGIBLE", liveCollateralMarketCount: 1, debtMarketCount: 1, liquidationBufferState: "LIQUIDATION_ELIGIBLE", thresholdUtilizationBps: "10100" } }), decision: "REFUSE", phase: "UNVERIFIED", rescue: false },
  { name: "fake solvent label with zero liquidity", input: assessment({ economics: { positionState: "BORROWING_SOLVENT", liveCollateralMarketCount: 1, debtMarketCount: 1, liquidationBufferState: "SOLVENT_WITH_BUFFER", thresholdUtilizationBps: "8000" } }), decision: "REFUSE", phase: "UNVERIFIED", rescue: false },
  { name: "fake collateral-only label with debt", input: assessment({ economics: { positionState: "COLLATERAL_ONLY", liveCollateralMarketCount: 1, debtMarketCount: 1, liquidationBufferState: "SOLVENT_WITH_BUFFER", thresholdUtilizationBps: "5000", liquidationBufferBpsOfBorrow: "10000" } }), decision: "REFUSE", phase: "UNVERIFIED", rescue: false }
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
    actual: {
      decision: result.decision,
      phase: result.phase,
      rescueExecutionEligible: result.rescueExecutionEligible,
      thresholdUtilizationBps: result.thresholdUtilizationBps,
      liquidationBufferState: result.liquidationBufferState,
      riskPolicyId: result.riskPolicyId
    },
    reasonCodes: result.reasonCodes,
    casePassed
  };
});

console.log(JSON.stringify({
  schemaVersion: "kumo-venus-health-strategy-fixture-v2",
  classification: "TEST_FIXTURE_NOT_LIVE_EVIDENCE",
  policy: {
    warnThresholdUtilizationBps: "8000",
    prepareThresholdUtilizationBps: "9091"
  },
  passed,
  results
}, null, 2));
if (!passed) process.exitCode = 1;
