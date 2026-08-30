import type { ChainSnapshot } from "@kumo/chain-state";

export type VenusNativeSolvencyStatus = "SOLVENT" | "AT_LIQUIDATION_THRESHOLD" | "LIQUIDATION_ELIGIBLE";
export type VenusUnderlyingKind = "ERC20" | "NATIVE";

export interface VenusCoreMarketAccountSnapshot {
  vToken: string;
  vTokenSymbol: string;
  vTokenDecimals: number;
  underlyingKind: VenusUnderlyingKind;
  underlyingAddress: string | null;
  underlyingSymbol: string;
  underlyingDecimals: number;
  enteredAsCollateralMarket: boolean;
  isListed: boolean;
  snapshotError: bigint;
  vTokenBalance: bigint;
  borrowBalance: bigint;
  exchangeRateMantissa: bigint;
  underlyingPriceMantissa: bigint;
  baseCollateralFactorMantissa: bigint;
  baseLiquidationThresholdMantissa: bigint;
  baseLiquidationIncentiveMantissa: bigint;
  effectiveCollateralFactorMantissa: bigint;
  effectiveLiquidationThresholdMantissa: bigint;
  effectiveLiquidationIncentiveMantissa: bigint;
}

export interface VenusCoreAccountState {
  chainId: 56;
  account: string;
  comptroller: string;
  resilientOracle: string;
  liquidityError: bigint;
  accountLiquidity: bigint;
  accountShortfall: bigint;
  nativeSolvencyStatus: VenusNativeSolvencyStatus;
  enteredMarkets: string[];
  listedMarketCount: number;
  activeMarkets: VenusCoreMarketAccountSnapshot[];
  snapshot: ChainSnapshot;
  evidenceRefs: string[];
  limitations: string[];
}
