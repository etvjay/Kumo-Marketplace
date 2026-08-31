import type { VenusCoreAccountState, VenusCoreMarketAccountSnapshot } from "./types.js";

const EXP_SCALE = 1_000_000_000_000_000_000n;
const HALF_EXP_SCALE = EXP_SCALE / 2n;

export const VENUS_LIQUIDITY_RECONSTRUCTION_RULE =
  "VENUS_CORE_EFFECTIVE_LIQUIDATION_THRESHOLD_EXP_V1" as const;

export interface VenusMarketLiquidityContribution {
  vToken: string;
  underlyingSymbol: string;
  enteredAsCollateralMarket: boolean;
  vTokenBalance: bigint;
  borrowBalance: bigint;
  exchangeRateMantissa: bigint;
  oraclePriceMantissa: bigint;
  effectiveLiquidationThresholdMantissa: bigint;
  tokensToDenomMantissa: bigint;
  collateralContributionMantissa: bigint;
  borrowContributionMantissa: bigint;
}

export interface VenusLiquidityReconstruction {
  rule: typeof VENUS_LIQUIDITY_RECONSTRUCTION_RULE;
  sumCollateralMantissa: bigint;
  sumBorrowPlusEffectsMantissa: bigint;
  derivedLiquidity: bigint;
  derivedShortfall: bigint;
  nativeLiquidity: bigint;
  nativeShortfall: bigint;
  liquidityDelta: bigint;
  shortfallDelta: bigint;
  exactNativeMatch: boolean;
  markets: VenusMarketLiquidityContribution[];
  limitations: string[];
}

/**
 * Venus/Compound Exp multiplication: multiply two 1e18-scaled mantissas,
 * add half the scale for nearest-integer rounding, then divide by 1e18.
 */
export function mulVenusExpMantissas(a: bigint, b: bigint): bigint {
  if (a < 0n || b < 0n) throw new Error("VENUS_EXP_NEGATIVE");
  return (a * b + HALF_EXP_SCALE) / EXP_SCALE;
}

/** Multiply a 1e18-scaled Exp by an integer scalar and truncate. */
export function mulVenusExpScalarTruncate(expMantissa: bigint, scalar: bigint): bigint {
  if (expMantissa < 0n || scalar < 0n) throw new Error("VENUS_EXP_SCALAR_NEGATIVE");
  return (expMantissa * scalar) / EXP_SCALE;
}

export function reconstructVenusMarketLiquidity(
  market: VenusCoreMarketAccountSnapshot
): VenusMarketLiquidityContribution {
  if (market.snapshotError !== 0n) {
    throw new Error(`VENUS_MARKET_SNAPSHOT_ERROR:${market.vToken}:${market.snapshotError.toString()}`);
  }
  if (market.underlyingPriceMantissa <= 0n) {
    throw new Error(`VENUS_MARKET_PRICE_INVALID:${market.vToken}`);
  }
  if (market.effectiveLiquidationThresholdMantissa < 0n) {
    throw new Error(`VENUS_EFFECTIVE_LT_NEGATIVE:${market.vToken}`);
  }

  const weightedExchangeRate = mulVenusExpMantissas(
    market.effectiveLiquidationThresholdMantissa,
    market.exchangeRateMantissa
  );
  const tokensToDenomMantissa = mulVenusExpMantissas(
    weightedExchangeRate,
    market.underlyingPriceMantissa
  );

  const collateralContributionMantissa = market.enteredAsCollateralMarket
    ? mulVenusExpScalarTruncate(tokensToDenomMantissa, market.vTokenBalance)
    : 0n;
  const borrowContributionMantissa = mulVenusExpScalarTruncate(
    market.underlyingPriceMantissa,
    market.borrowBalance
  );

  return {
    vToken: market.vToken,
    underlyingSymbol: market.underlyingSymbol,
    enteredAsCollateralMarket: market.enteredAsCollateralMarket,
    vTokenBalance: market.vTokenBalance,
    borrowBalance: market.borrowBalance,
    exchangeRateMantissa: market.exchangeRateMantissa,
    oraclePriceMantissa: market.underlyingPriceMantissa,
    effectiveLiquidationThresholdMantissa: market.effectiveLiquidationThresholdMantissa,
    tokensToDenomMantissa,
    collateralContributionMantissa,
    borrowContributionMantissa
  };
}

export function reconstructVenusAccountLiquidity(
  state: VenusCoreAccountState
): VenusLiquidityReconstruction {
  const markets = state.activeMarkets.map(reconstructVenusMarketLiquidity);
  const sumCollateralMantissa = markets.reduce(
    (sum, market) => sum + market.collateralContributionMantissa,
    0n
  );
  const sumBorrowPlusEffectsMantissa = markets.reduce(
    (sum, market) => sum + market.borrowContributionMantissa,
    0n
  );

  const derivedLiquidity = sumCollateralMantissa > sumBorrowPlusEffectsMantissa
    ? sumCollateralMantissa - sumBorrowPlusEffectsMantissa
    : 0n;
  const derivedShortfall = sumBorrowPlusEffectsMantissa > sumCollateralMantissa
    ? sumBorrowPlusEffectsMantissa - sumCollateralMantissa
    : 0n;

  const liquidityDelta = derivedLiquidity >= state.accountLiquidity
    ? derivedLiquidity - state.accountLiquidity
    : state.accountLiquidity - derivedLiquidity;
  const shortfallDelta = derivedShortfall >= state.accountShortfall
    ? derivedShortfall - state.accountShortfall
    : state.accountShortfall - derivedShortfall;

  return {
    rule: VENUS_LIQUIDITY_RECONSTRUCTION_RULE,
    sumCollateralMantissa,
    sumBorrowPlusEffectsMantissa,
    derivedLiquidity,
    derivedShortfall,
    nativeLiquidity: state.accountLiquidity,
    nativeShortfall: state.accountShortfall,
    liquidityDelta,
    shortfallDelta,
    exactNativeMatch: liquidityDelta === 0n && shortfallDelta === 0n,
    markets,
    limitations: [
      "This reconstruction uses account-effective liquidation-threshold weighting and Venus fixed-point rounding/truncation semantics.",
      "Native Venus getAccountLiquidity/accountShortfall remain authoritative; a mismatch fails equivalence and must not be hidden by tolerance.",
      "The current reconstruction includes vToken collateral and borrow contributions only. Any additional Comptroller effects must be modeled explicitly before equivalence may be claimed for an affected account.",
      "Human-readable token decimals are not used in protocol-denominated liquidity arithmetic because Venus oracle/exchange-rate mantissas already encode the required scaling."
    ]
  };
}

export function assertVenusNativeLiquidityEquivalent(state: VenusCoreAccountState): VenusLiquidityReconstruction {
  const reconstruction = reconstructVenusAccountLiquidity(state);
  if (!reconstruction.exactNativeMatch) {
    throw new Error(
      `VENUS_NATIVE_LIQUIDITY_MISMATCH:derivedLiquidity=${reconstruction.derivedLiquidity.toString()}:nativeLiquidity=${reconstruction.nativeLiquidity.toString()}:derivedShortfall=${reconstruction.derivedShortfall.toString()}:nativeShortfall=${reconstruction.nativeShortfall.toString()}`
    );
  }
  return reconstruction;
}
