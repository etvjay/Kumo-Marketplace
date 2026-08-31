import { prepareVenusRepayPlan } from "../packages/reference-agents/dist/health/index.js";

const E = 1_000_000_000_000_000_000n;
const HASH = `0x${"ab".repeat(32)}`;
const ACCOUNT = "0x00000000000000000000000000000000000000aa";
const address = (n) => `0x${n.toString(16).padStart(40, "0")}`;

function market({ id, entered = false, supply = 0n, borrow = 0n, price = E }) {
  return {
    vToken: address(id),
    vTokenSymbol: `vT${id}`,
    vTokenDecimals: 8,
    underlyingKind: "ERC20",
    underlyingAddress: address(id + 100),
    underlyingSymbol: `T${id}`,
    underlyingDecimals: 18,
    enteredAsCollateralMarket: entered,
    isListed: true,
    snapshotError: 0n,
    vTokenBalance: supply,
    borrowBalance: borrow,
    exchangeRateMantissa: E,
    underlyingPriceMantissa: price,
    baseCollateralFactorMantissa: E,
    baseLiquidationThresholdMantissa: E,
    baseLiquidationIncentiveMantissa: 1_100_000_000_000_000_000n,
    effectiveCollateralFactorMantissa: E,
    effectiveLiquidationThresholdMantissa: E,
    effectiveLiquidationIncentiveMantissa: 1_100_000_000_000_000_000n
  };
}

function state(activeMarkets, liquidity, shortfall) {
  return {
    chainId: 56,
    account: ACCOUNT,
    comptroller: "0xfD36E2c2a6789Db23113685031d7F16329158384",
    resilientOracle: "0x6592b5DE802159F3E74B2486b091D11a8256ab8A",
    liquidityError: 0n,
    accountLiquidity: liquidity,
    accountShortfall: shortfall,
    nativeSolvencyStatus: shortfall > 0n ? "LIQUIDATION_ELIGIBLE" : liquidity > 0n ? "SOLVENT" : "AT_LIQUIDATION_THRESHOLD",
    enteredMarkets: activeMarkets.filter((item) => item.enteredAsCollateralMarket).map((item) => item.vToken),
    listedMarketCount: activeMarkets.length,
    activeMarkets,
    snapshot: {
      chainId: 56,
      purpose: "evidence",
      blockTag: "finalized",
      blockNumber: "123",
      blockHash: HASH,
      blockTimestamp: 1,
      observedAt: "2026-08-31T00:00:00.000Z",
      rpcProviderId: "fixture"
    },
    evidenceRefs: [],
    limitations: []
  };
}

function strategy(sourceState, decision = "PREPARE", overrides = {}) {
  const phase = decision === "RESCUE" ? "RESCUE" : decision === "PREPARE" ? "PREPARE" : "WATCH";
  return {
    decision,
    phase,
    sourceObjectId: "noema:fixture",
    sourceObjectVersion: 2,
    sourcePositionState: decision === "RESCUE" ? "LIQUIDATION_ELIGIBLE" : "BORROWING_SOLVENT",
    sourceFinalizedBlockNumber: sourceState.snapshot.blockNumber,
    sourceFinalizedBlockHash: sourceState.snapshot.blockHash,
    account: sourceState.account,
    accountLiquidityMantissa: sourceState.accountLiquidity.toString(),
    accountShortfallMantissa: sourceState.accountShortfall.toString(),
    liveCollateralMarketCount: sourceState.activeMarkets.filter((item) => item.enteredAsCollateralMarket && item.vTokenBalance > 0n).length,
    debtMarketCount: sourceState.activeMarkets.filter((item) => item.borrowBalance > 0n).length,
    nativeLiquidityExactMatch: true,
    liquidationBufferState: decision === "RESCUE" ? "LIQUIDATION_ELIGIBLE" : "SOLVENT_WITH_BUFFER",
    thresholdUtilizationBps: null,
    liquidationBufferBpsOfBorrow: null,
    riskPolicyId: "kumo-venus-health-policy-v1",
    requiresRefreshBeforeExecution: decision === "PREPARE" || decision === "RESCUE",
    rescueExecutionEligible: decision === "RESCUE",
    inferenceUsed: false,
    reasonCodes: [],
    ...overrides
  };
}

const results = [];
function check(name, condition, detail = {}) {
  results.push({ name, passed: Boolean(condition), ...detail });
}
function rejects(name, fn, prefix) {
  let error = null;
  try { fn(); } catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
  check(name, typeof error === "string" && error.startsWith(prefix), { error });
}

const prepareState = state([
  market({ id: 1, entered: true, supply: 100n, borrow: 95n })
], 5n, 0n);
const single = prepareVenusRepayPlan({
  state: prepareState,
  strategy: strategy(prepareState, "PREPARE"),
  targetThresholdUtilizationBps: 7_500n
});
check("single-market PREPARE reduces utilization to explicit target", single.legs.length === 1
  && single.legs[0].preparedRepayAmountRaw === 20n
  && single.projectedBorrowContributionMantissa === 75n
  && single.projectedThresholdUtilizationBps === 7_500n,
{
  repayRaw: single.legs[0].preparedRepayAmountRaw.toString(),
  projectedBorrow: single.projectedBorrowContributionMantissa.toString(),
  projectedUtilizationBps: single.projectedThresholdUtilizationBps?.toString() ?? null
});
check("repay preparation creates no execution authority", single.executionAuthorityCreated === false
  && single.transactionRequest === null
  && single.requiresRefreshBeforeExecution === true
  && single.requiresExecutableQuoteBeforeExecution === true);

const multiState = state([
  market({ id: 1, entered: true, supply: 100n }),
  market({ id: 2, borrow: 60n }),
  market({ id: 3, borrow: 35n })
], 5n, 0n);
const multi = prepareVenusRepayPlan({
  state: multiState,
  strategy: strategy(multiState, "PREPARE"),
  targetThresholdUtilizationBps: 3_000n
});
check("multi-market allocation spills deterministically into second debt market", multi.legs.length === 2
  && multi.legs[0].currentBorrowContributionMantissa === 60n
  && multi.legs[0].preparedRepayAmountRaw === 60n
  && multi.legs[1].preparedRepayAmountRaw === 5n
  && multi.projectedBorrowContributionMantissa === 30n,
{
  legs: multi.legs.map((leg) => ({ vToken: leg.vToken, repay: leg.preparedRepayAmountRaw.toString() })),
  projectedBorrow: multi.projectedBorrowContributionMantissa.toString()
});

const rescueState = state([
  market({ id: 1, entered: true, supply: 100n, borrow: 110n })
], 0n, 10n);
const rescue = prepareVenusRepayPlan({
  state: rescueState,
  strategy: strategy(rescueState, "RESCUE"),
  targetThresholdUtilizationBps: 7_500n
});
check("liquidation-eligible rescue preparation can size a repay without executing", rescue.sourceStrategyDecision === "RESCUE"
  && rescue.legs[0].preparedRepayAmountRaw === 35n
  && rescue.projectedThresholdUtilizationBps === 7_500n
  && rescue.executionAuthorityCreated === false,
{
  repayRaw: rescue.legs[0].preparedRepayAmountRaw.toString(),
  projectedUtilizationBps: rescue.projectedThresholdUtilizationBps?.toString() ?? null
});

rejects("WATCH decision cannot create repay preparation", () => prepareVenusRepayPlan({
  state: prepareState,
  strategy: strategy(prepareState, "MONITOR"),
  targetThresholdUtilizationBps: 7_500n
}), "VENUS_REPAY_PREPARATION_STRATEGY_NOT_ELIGIBLE:");

rejects("non-equivalent strategy cannot create repay preparation", () => prepareVenusRepayPlan({
  state: prepareState,
  strategy: strategy(prepareState, "PREPARE", { nativeLiquidityExactMatch: false }),
  targetThresholdUtilizationBps: 7_500n
}), "VENUS_REPAY_PREPARATION_REQUIRES_EXACT_NATIVE_MATCH");

rejects("strategy/state block mismatch fails closed", () => prepareVenusRepayPlan({
  state: prepareState,
  strategy: strategy(prepareState, "PREPARE", { sourceFinalizedBlockNumber: "122" }),
  targetThresholdUtilizationBps: 7_500n
}), "VENUS_REPAY_PREPARATION_BLOCK_MISMATCH");

rejects("already-safe target is rejected instead of creating zero-action plan", () => prepareVenusRepayPlan({
  state: prepareState,
  strategy: strategy(prepareState, "PREPARE"),
  targetThresholdUtilizationBps: 9_600n
}), "VENUS_REPAY_TARGET_NOT_BELOW_CURRENT_EXPOSURE");

rejects("invalid target at 100 percent is rejected", () => prepareVenusRepayPlan({
  state: prepareState,
  strategy: strategy(prepareState, "PREPARE"),
  targetThresholdUtilizationBps: 10_000n
}), "VENUS_REPAY_TARGET_UTILIZATION_INVALID:");

const passed = results.every((result) => result.passed);
console.log(JSON.stringify({
  schemaVersion: "kumo-venus-repay-preparation-fixture-v1",
  classification: "TEST_FIXTURE_NOT_LIVE_EVIDENCE",
  passed,
  results
}, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2));
if (!passed) process.exitCode = 1;
