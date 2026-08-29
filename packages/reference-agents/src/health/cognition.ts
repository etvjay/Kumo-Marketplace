import type { VenusCoreAccountState } from "./types.js";

export type VenusHealthPositionState =
  | "NO_POSITION"
  | "COLLATERAL_ONLY"
  | "DEBT_ONLY"
  | "BORROWING_SOLVENT"
  | "BORROWING_AT_LIQUIDATION_THRESHOLD"
  | "LIQUIDATION_ELIGIBLE";

export interface VenusHealthAssessment {
  state: VenusHealthPositionState;
  hasLiveCollateral: boolean;
  hasCurrentDebt: boolean;
  liveCollateralMarketCount: number;
  debtMarketCount: number;
  accountLiquidity: bigint;
  accountShortfall: bigint;
  reasons: string[];
}

/**
 * Domain cognition over already-verified Venus Core state.
 *
 * This deliberately does not manufacture a generic health factor. Venus's
 * native aggregate liquidity/shortfall tuple remains the solvency authority;
 * market balances establish whether there is actually a live position to
 * interpret. In particular, (liquidity=0, shortfall=0) is NOT a threshold
 * condition for an empty/repaid account.
 */
export function assessVenusHealthState(state: VenusCoreAccountState): VenusHealthAssessment {
  const liveCollateralMarkets = state.activeMarkets.filter((market) =>
    market.enteredAsCollateralMarket && market.vTokenBalance > 0n
  );
  const debtMarkets = state.activeMarkets.filter((market) => market.borrowBalance > 0n);
  const hasLiveCollateral = liveCollateralMarkets.length > 0;
  const hasCurrentDebt = debtMarkets.length > 0;
  const reasons: string[] = [];

  if (!hasLiveCollateral && !hasCurrentDebt) {
    reasons.push("NO_LIVE_COLLATERAL_OR_DEBT");
    return {
      state: "NO_POSITION",
      hasLiveCollateral,
      hasCurrentDebt,
      liveCollateralMarketCount: 0,
      debtMarketCount: 0,
      accountLiquidity: state.accountLiquidity,
      accountShortfall: state.accountShortfall,
      reasons
    };
  }

  if (hasLiveCollateral && !hasCurrentDebt) {
    reasons.push("LIVE_COLLATERAL_WITHOUT_CURRENT_DEBT");
    return {
      state: "COLLATERAL_ONLY",
      hasLiveCollateral,
      hasCurrentDebt,
      liveCollateralMarketCount: liveCollateralMarkets.length,
      debtMarketCount: 0,
      accountLiquidity: state.accountLiquidity,
      accountShortfall: state.accountShortfall,
      reasons
    };
  }

  if (!hasLiveCollateral && hasCurrentDebt) {
    reasons.push("CURRENT_DEBT_WITHOUT_LIVE_ENTERED_COLLATERAL");
    if (state.accountShortfall > 0n) reasons.push("VENUS_NATIVE_SHORTFALL_POSITIVE");
    return {
      state: state.accountShortfall > 0n ? "LIQUIDATION_ELIGIBLE" : "DEBT_ONLY",
      hasLiveCollateral,
      hasCurrentDebt,
      liveCollateralMarketCount: 0,
      debtMarketCount: debtMarkets.length,
      accountLiquidity: state.accountLiquidity,
      accountShortfall: state.accountShortfall,
      reasons
    };
  }

  if (state.accountShortfall > 0n) {
    reasons.push("VENUS_NATIVE_SHORTFALL_POSITIVE");
    return {
      state: "LIQUIDATION_ELIGIBLE",
      hasLiveCollateral,
      hasCurrentDebt,
      liveCollateralMarketCount: liveCollateralMarkets.length,
      debtMarketCount: debtMarkets.length,
      accountLiquidity: state.accountLiquidity,
      accountShortfall: state.accountShortfall,
      reasons
    };
  }

  if (state.accountLiquidity > 0n) {
    reasons.push("VENUS_NATIVE_LIQUIDITY_POSITIVE");
    return {
      state: "BORROWING_SOLVENT",
      hasLiveCollateral,
      hasCurrentDebt,
      liveCollateralMarketCount: liveCollateralMarkets.length,
      debtMarketCount: debtMarkets.length,
      accountLiquidity: state.accountLiquidity,
      accountShortfall: state.accountShortfall,
      reasons
    };
  }

  reasons.push("LIVE_BORROWING_POSITION_AT_NATIVE_ZERO_LIQUIDITY_ZERO_SHORTFALL");
  return {
    state: "BORROWING_AT_LIQUIDATION_THRESHOLD",
    hasLiveCollateral,
    hasCurrentDebt,
    liveCollateralMarketCount: liveCollateralMarkets.length,
    debtMarketCount: debtMarkets.length,
    accountLiquidity: state.accountLiquidity,
    accountShortfall: state.accountShortfall,
    reasons
  };
}
