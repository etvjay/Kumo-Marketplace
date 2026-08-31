import {
  assertVenusNativeLiquidityEquivalent,
  deriveVenusNativeLiquidationBuffer,
  mulVenusExpMantissas,
  mulVenusExpScalarTruncate,
  reconstructVenusAccountLiquidity
} from "../packages/reference-agents/dist/health/index.js";

const E = 1_000_000_000_000_000_000n;
const address = (suffix) => `0x${suffix.toString(16).padStart(40, "0")}`;

function market(overrides = {}) {
  return {
    vToken: address(0x11),
    vTokenSymbol: "vTEST",
    vTokenDecimals: 8,
    underlyingKind: "ERC20",
    underlyingAddress: address(0x12),
    underlyingSymbol: "TEST",
    underlyingDecimals: 18,
    enteredAsCollateralMarket: true,
    isListed: true,
    snapshotError: 0n,
    vTokenBalance: 100n,
    borrowBalance: 0n,
    exchangeRateMantissa: E,
    underlyingPriceMantissa: E,
    baseCollateralFactorMantissa: 750_000_000_000_000_000n,
    baseLiquidationThresholdMantissa: 800_000_000_000_000_000n,
    baseLiquidationIncentiveMantissa: 1_100_000_000_000_000_000n,
    effectiveCollateralFactorMantissa: 750_000_000_000_000_000n,
    effectiveLiquidationThresholdMantissa: 800_000_000_000_000_000n,
    effectiveLiquidationIncentiveMantissa: 1_100_000_000_000_000_000n,
    ...overrides
  };
}

function state({ activeMarkets, accountLiquidity, accountShortfall }) {
  return {
    chainId: 56,
    account: address(0xaa),
    comptroller: "0xfD36E2c2a6789Db23113685031d7F16329158384",
    resilientOracle: "0x6592b5DE802159F3E74B2486b091D11a8256ab8A",
    liquidityError: 0n,
    accountLiquidity,
    accountShortfall,
    nativeSolvencyStatus: accountShortfall > 0n ? "LIQUIDATION_ELIGIBLE" : accountLiquidity > 0n ? "SOLVENT" : "AT_LIQUIDATION_THRESHOLD",
    enteredMarkets: activeMarkets.filter((item) => item.enteredAsCollateralMarket).map((item) => item.vToken),
    listedMarketCount: activeMarkets.length,
    activeMarkets,
    snapshot: {
      chainId: 56,
      purpose: "evidence",
      blockTag: "finalized",
      blockNumber: "1",
      blockHash: `0x${"aa".repeat(32)}`,
      blockTimestamp: 1,
      observedAt: "2026-08-31T00:00:00.000Z",
      rpcProviderId: "fixture"
    },
    evidenceRefs: [],
    limitations: []
  };
}

const results = [];
function check(name, condition, detail = {}) {
  results.push({ name, passed: Boolean(condition), ...detail });
}

check(
  "Exp multiplication rounds half-scale upward",
  mulVenusExpMantissas(1n, E / 2n) === 1n,
  { actual: mulVenusExpMantissas(1n, E / 2n).toString(), expected: "1" }
);
check(
  "Exp scalar multiplication truncates",
  mulVenusExpScalarTruncate(1_500_000_000_000_000_000n, 1n) === 1n,
  { actual: mulVenusExpScalarTruncate(1_500_000_000_000_000n, 1n).toString(), expected: "1" }
);

const collateralOnly = reconstructVenusAccountLiquidity(state({
  activeMarkets: [market()],
  accountLiquidity: 80n,
  accountShortfall: 0n
}));
check("collateral-only reconstruction matches native liquidity", collateralOnly.exactNativeMatch, {
  derivedLiquidity: collateralOnly.derivedLiquidity.toString(),
  nativeLiquidity: collateralOnly.nativeLiquidity.toString()
});
const collateralOnlyBuffer = deriveVenusNativeLiquidationBuffer(collateralOnly);
check("collateral-only state asserts no liquidation-distance ratio", collateralOnlyBuffer.state === "NO_DEBT"
  && collateralOnlyBuffer.thresholdUtilizationBps === 0n
  && collateralOnlyBuffer.liquidationBufferBpsOfBorrow === null,
{
  state: collateralOnlyBuffer.state,
  thresholdUtilizationBps: collateralOnlyBuffer.thresholdUtilizationBps?.toString() ?? null,
  liquidationBufferBpsOfBorrow: collateralOnlyBuffer.liquidationBufferBpsOfBorrow?.toString() ?? null
});

const solventBorrower = reconstructVenusAccountLiquidity(state({
  activeMarkets: [market({ borrowBalance: 50n })],
  accountLiquidity: 30n,
  accountShortfall: 0n
}));
check("solvent borrower reconstruction matches native liquidity", solventBorrower.exactNativeMatch, {
  derivedLiquidity: solventBorrower.derivedLiquidity.toString(),
  derivedShortfall: solventBorrower.derivedShortfall.toString()
});
const solventBuffer = deriveVenusNativeLiquidationBuffer(solventBorrower);
check("solvent borrower exposes protocol-native threshold utilization", solventBuffer.state === "SOLVENT_WITH_BUFFER"
  && solventBuffer.thresholdUtilizationBps === 6250n
  && solventBuffer.liquidationBufferBpsOfBorrow === 6000n,
{
  state: solventBuffer.state,
  thresholdUtilizationBps: solventBuffer.thresholdUtilizationBps?.toString() ?? null,
  liquidationBufferBpsOfBorrow: solventBuffer.liquidationBufferBpsOfBorrow?.toString() ?? null
});

const thresholdBorrower = reconstructVenusAccountLiquidity(state({
  activeMarkets: [market({ borrowBalance: 80n })],
  accountLiquidity: 0n,
  accountShortfall: 0n
}));
const thresholdBuffer = deriveVenusNativeLiquidationBuffer(thresholdBorrower);
check("threshold borrower is identified without generic health factor", thresholdBuffer.state === "AT_LIQUIDATION_THRESHOLD"
  && thresholdBuffer.thresholdUtilizationBps === 10000n,
{
  state: thresholdBuffer.state,
  thresholdUtilizationBps: thresholdBuffer.thresholdUtilizationBps?.toString() ?? null
});

const liquidatableBorrower = reconstructVenusAccountLiquidity(state({
  activeMarkets: [market({ borrowBalance: 90n })],
  accountLiquidity: 0n,
  accountShortfall: 10n
}));
check("liquidation-eligible reconstruction matches native shortfall", liquidatableBorrower.exactNativeMatch, {
  derivedLiquidity: liquidatableBorrower.derivedLiquidity.toString(),
  derivedShortfall: liquidatableBorrower.derivedShortfall.toString()
});
const liquidatableBuffer = deriveVenusNativeLiquidationBuffer(liquidatableBorrower);
check("liquidation-eligible buffer state follows native shortfall", liquidatableBuffer.state === "LIQUIDATION_ELIGIBLE"
  && liquidatableBuffer.thresholdUtilizationBps === 11250n,
{
  state: liquidatableBuffer.state,
  thresholdUtilizationBps: liquidatableBuffer.thresholdUtilizationBps?.toString() ?? null
});

const nonCollateralSupply = reconstructVenusAccountLiquidity(state({
  activeMarkets: [market({ enteredAsCollateralMarket: false, vTokenBalance: 100n, borrowBalance: 10n })],
  accountLiquidity: 0n,
  accountShortfall: 10n
}));
check("non-collateral supply is excluded from collateral contribution", nonCollateralSupply.exactNativeMatch, {
  collateral: nonCollateralSupply.sumCollateralMantissa.toString(),
  borrow: nonCollateralSupply.sumBorrowPlusEffectsMantissa.toString()
});

let mismatchRejected = false;
try {
  assertVenusNativeLiquidityEquivalent(state({
    activeMarkets: [market({ borrowBalance: 50n })],
    accountLiquidity: 31n,
    accountShortfall: 0n
  }));
} catch (error) {
  mismatchRejected = error instanceof Error && error.message.startsWith("VENUS_NATIVE_LIQUIDITY_MISMATCH:");
}
check("native mismatch fails closed", mismatchRejected);

let bufferMismatchRejected = false;
try {
  const mismatched = reconstructVenusAccountLiquidity(state({
    activeMarkets: [market({ borrowBalance: 50n })],
    accountLiquidity: 31n,
    accountShortfall: 0n
  }));
  deriveVenusNativeLiquidationBuffer(mismatched);
} catch (error) {
  bufferMismatchRejected = error instanceof Error && error.message === "VENUS_LIQUIDATION_BUFFER_REQUIRES_EXACT_NATIVE_MATCH";
}
check("liquidation buffer cannot be derived from non-equivalent reconstruction", bufferMismatchRejected);

const passed = results.every((result) => result.passed);
console.log(JSON.stringify({
  schemaVersion: "kumo-venus-liquidity-reconstruction-fixture-v2",
  classification: "TEST_FIXTURE_NOT_LIVE_EVIDENCE",
  passed,
  results
}, null, 2));
if (!passed) process.exitCode = 1;
