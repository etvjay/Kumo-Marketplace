import { buildVenusHealthNoemaAssessment } from "../packages/reference-agents/dist/health/index.js";

const NOW = 1_788_100_000_000;
const ACCOUNT = "0x00000000000000000000000000000000000000aa";
const VTOKEN = "0x00000000000000000000000000000000000000bb";
const BLOCK_HASH = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function state(overrides = {}) {
  const marketOverrides = overrides.market || {};
  const observedAt = overrides.observedAt || new Date(NOW - 1_000).toISOString();
  return {
    chainId: 56,
    account: ACCOUNT,
    comptroller: "0xfD36E2c2a6789Db23113685031d7F16329158384",
    resilientOracle: "0x6592b5DE802159F3E74B2486b091D11a8256ab8A",
    liquidityError: 0n,
    accountLiquidity: 100n,
    accountShortfall: 0n,
    nativeSolvencyStatus: "SOLVENT",
    enteredMarkets: [VTOKEN],
    listedMarketCount: 52,
    activeMarkets: [{
      vToken: VTOKEN,
      enteredAsCollateralMarket: true,
      isListed: true,
      snapshotError: 0n,
      vTokenBalance: 10n,
      borrowBalance: 5n,
      exchangeRateMantissa: 1_000_000_000_000_000_000n,
      underlyingPriceMantissa: 1_000_000_000_000_000_000n,
      baseCollateralFactorMantissa: 800_000_000_000_000_000n,
      baseLiquidationThresholdMantissa: 850_000_000_000_000_000n,
      baseLiquidationIncentiveMantissa: 1_100_000_000_000_000_000n,
      effectiveCollateralFactorMantissa: 800_000_000_000_000_000n,
      effectiveLiquidationThresholdMantissa: 850_000_000_000_000_000n,
      effectiveLiquidationIncentiveMantissa: 1_100_000_000_000_000_000n,
      ...marketOverrides
    }],
    snapshot: {
      chainId: 56,
      purpose: "evidence",
      blockTag: "finalized",
      blockNumber: "123",
      blockHash: BLOCK_HASH,
      blockTimestamp: Math.floor((NOW - 1_000) / 1000),
      observedAt,
      rpcProviderId: "fixture"
    },
    evidenceRefs: ["fixture"],
    limitations: []
  };
}

function run(name, sourceState) {
  const assessment = buildVenusHealthNoemaAssessment({
    state: sourceState,
    principal: `fixture:${name}`,
    evaluatedAt: NOW,
    maxEvidenceAgeMs: 60_000
  });
  return {
    name,
    assessment,
    summary: {
      verification: assessment.economicObject.verification.status,
      objectStatus: assessment.economicObject.status,
      mandateDecision: assessment.evaluation.decision,
      differentiatedRiskPolicyMarketCount: assessment.economicObject.economics.differentiatedRiskPolicyMarketCount,
      marketRisk: assessment.economicObject.economics.marketRisk
    }
  };
}

const defaultPolicy = run("default-policy", state());
const differentiatedPolicy = run("differentiated-policy", state({
  market: {
    effectiveCollateralFactorMantissa: 900_000_000_000_000_000n,
    effectiveLiquidationThresholdMantissa: 925_000_000_000_000_000n,
    effectiveLiquidationIncentiveMantissa: 1_050_000_000_000_000_000n
  }
}));
const invalidEffectivePolicy = run("invalid-effective-policy", state({
  market: {
    effectiveCollateralFactorMantissa: 900_000_000_000_000_000n,
    effectiveLiquidationThresholdMantissa: 850_000_000_000_000_000n
  }
}));
const staleEvidence = run("stale-evidence", state({ observedAt: new Date(NOW - 120_000).toISOString() }));

const invariants = {
  defaultPolicyPasses: defaultPolicy.summary.verification === "PASS"
    && defaultPolicy.summary.objectStatus === "RESOLVED"
    && defaultPolicy.summary.mandateDecision === "ALLOW"
    && defaultPolicy.summary.differentiatedRiskPolicyMarketCount === 0,
  differentiatedPolicyPreserved: differentiatedPolicy.summary.verification === "PASS"
    && differentiatedPolicy.summary.objectStatus === "RESOLVED"
    && differentiatedPolicy.summary.mandateDecision === "ALLOW"
    && differentiatedPolicy.summary.differentiatedRiskPolicyMarketCount === 1
    && differentiatedPolicy.summary.marketRisk[0].effectiveCollateralFactorMantissa === "900000000000000000"
    && differentiatedPolicy.summary.marketRisk[0].effectiveLiquidationThresholdMantissa === "925000000000000000"
    && differentiatedPolicy.summary.marketRisk[0].differsFromBasePolicy === true,
  invalidPolicyFailsClosed: invalidEffectivePolicy.summary.verification === "FAIL"
    && invalidEffectivePolicy.summary.objectStatus === "INSUFFICIENT_EVIDENCE"
    && invalidEffectivePolicy.summary.mandateDecision !== "ALLOW",
  staleEvidenceNotResolved: staleEvidence.summary.objectStatus === "STALE"
    && staleEvidence.summary.mandateDecision !== "ALLOW"
};
const passed = Object.values(invariants).every(Boolean);

console.log(JSON.stringify({
  schemaVersion: "kumo-venus-health-noema-risk-fixture-v1",
  classification: "TEST_FIXTURE_NOT_LIVE_EVIDENCE",
  passed,
  invariants,
  cases: [defaultPolicy.summary, differentiatedPolicy.summary, invalidEffectivePolicy.summary, staleEvidence.summary]
}, null, 2));
if (!passed) process.exitCode = 1;
