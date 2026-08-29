import { assessVenusHealthState } from "../packages/reference-agents/dist/health/index.js";

const baseMarket = {
  vToken: "0x0000000000000000000000000000000000000011",
  enteredAsCollateralMarket: false,
  isListed: true,
  snapshotError: 0n,
  vTokenBalance: 0n,
  borrowBalance: 0n,
  exchangeRateMantissa: 1n,
  underlyingPriceMantissa: 1n,
  baseCollateralFactorMantissa: 800000000000000000n,
  baseLiquidationThresholdMantissa: 800000000000000000n,
  baseLiquidationIncentiveMantissa: 1100000000000000000n
};

function state(overrides = {}) {
  return {
    chainId: 56,
    account: "0x00000000000000000000000000000000000000aa",
    comptroller: "0xfD36E2c2a6789Db23113685031d7F16329158384",
    resilientOracle: "0x6592b5DE802159F3E74B2486b091D11a8256ab8A",
    liquidityError: 0n,
    accountLiquidity: 0n,
    accountShortfall: 0n,
    nativeSolvencyStatus: "AT_LIQUIDATION_THRESHOLD",
    enteredMarkets: [],
    listedMarketCount: 52,
    activeMarkets: [],
    snapshot: {
      chainId: 56,
      purpose: "evidence",
      blockTag: "finalized",
      blockNumber: "1",
      blockHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      blockTimestamp: 1,
      observedAt: "2026-08-29T16:00:00.000Z",
      rpcProviderId: "fixture"
    },
    evidenceRefs: [],
    limitations: [],
    ...overrides
  };
}

const collateral = { ...baseMarket, enteredAsCollateralMarket: true, vTokenBalance: 100n };
const debt = { ...baseMarket, vToken: "0x0000000000000000000000000000000000000022", borrowBalance: 50n };

const cases = [
  { name: "empty/repaid account", input: state(), expected: "NO_POSITION" },
  { name: "collateral only", input: state({ accountLiquidity: 10n, nativeSolvencyStatus: "SOLVENT", activeMarkets: [collateral] }), expected: "COLLATERAL_ONLY" },
  { name: "debt only", input: state({ activeMarkets: [debt] }), expected: "DEBT_ONLY" },
  { name: "borrowing solvent", input: state({ accountLiquidity: 10n, nativeSolvencyStatus: "SOLVENT", activeMarkets: [collateral, debt] }), expected: "BORROWING_SOLVENT" },
  { name: "borrowing at threshold", input: state({ activeMarkets: [collateral, debt] }), expected: "BORROWING_AT_LIQUIDATION_THRESHOLD" },
  { name: "liquidation eligible", input: state({ accountShortfall: 5n, nativeSolvencyStatus: "LIQUIDATION_ELIGIBLE", activeMarkets: [collateral, debt] }), expected: "LIQUIDATION_ELIGIBLE" },
  { name: "debt only with shortfall", input: state({ accountShortfall: 5n, nativeSolvencyStatus: "LIQUIDATION_ELIGIBLE", activeMarkets: [debt] }), expected: "LIQUIDATION_ELIGIBLE" }
];

let passed = true;
const results = cases.map((testCase) => {
  const assessment = assessVenusHealthState(testCase.input);
  const casePassed = assessment.state === testCase.expected;
  if (!casePassed) passed = false;
  return { name: testCase.name, expected: testCase.expected, actual: assessment.state, reasons: assessment.reasons, casePassed };
});

console.log(JSON.stringify({
  schemaVersion: "kumo-venus-health-cognition-fixture-v1",
  classification: "TEST_FIXTURE_NOT_LIVE_EVIDENCE",
  passed,
  results
}, null, 2));
if (!passed) process.exitCode = 1;
