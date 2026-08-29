import type { ChainSnapshot } from "@kumo/chain-state";

export type VenusNativeSolvencyStatus = "SOLVENT" | "AT_LIQUIDATION_THRESHOLD" | "LIQUIDATION_ELIGIBLE";

export interface VenusCoreMarketAccountSnapshot {
  vToken: string;
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
