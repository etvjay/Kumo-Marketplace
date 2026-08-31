import type { VenusCoreAccountState } from "./types.js";
import type { VenusHealthStrategyProposal } from "./strategy.js";
import {
  mulVenusExpScalarTruncate,
  reconstructVenusAccountLiquidity
} from "./valuation.js";

const EXP_SCALE = 1_000_000_000_000_000_000n;
const BPS_SCALE = 10_000n;

export interface VenusRepayPreparationLeg {
  vToken: string;
  underlyingKind: "NATIVE" | "ERC20";
  underlyingAddress: string | null;
  underlyingSymbol: string;
  underlyingDecimals: number;
  oraclePriceMantissa: bigint;
  currentBorrowBalanceRaw: bigint;
  preparedRepayAmountRaw: bigint;
  projectedBorrowBalanceRaw: bigint;
  currentBorrowContributionMantissa: bigint;
  projectedBorrowContributionMantissa: bigint;
  contributionReductionMantissa: bigint;
}

export interface VenusRepayPreparation {
  schemaVersion: "kumo-venus-repay-preparation-v1";
  classification: "READ_ONLY_PREPARATION_NO_EXECUTION_AUTHORITY";
  account: string;
  sourceFinalizedBlockNumber: string;
  sourceFinalizedBlockHash: string;
  sourceStrategyDecision: "PREPARE" | "RESCUE";
  sourceStrategyPhase: string;
  sourceObjectId: string;
  sourceObjectVersion: number;
  riskPolicyId: string;
  targetThresholdUtilizationBps: bigint;
  currentCollateralContributionMantissa: bigint;
  currentBorrowContributionMantissa: bigint;
  targetMaximumBorrowContributionMantissa: bigint;
  requiredBorrowContributionReductionMantissa: bigint;
  projectedBorrowContributionMantissa: bigint;
  projectedThresholdUtilizationBps: bigint | null;
  legs: VenusRepayPreparationLeg[];
  requiresRefreshBeforeExecution: true;
  requiresExecutableQuoteBeforeExecution: true;
  executionAuthorityCreated: false;
  transactionRequest: null;
  limitations: string[];
}

function minBigInt(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function maxRawBalanceForContribution(maxContribution: bigint, oraclePriceMantissa: bigint): bigint {
  if (maxContribution < 0n) throw new Error("VENUS_REPAY_TARGET_CONTRIBUTION_NEGATIVE");
  if (oraclePriceMantissa <= 0n) throw new Error("VENUS_REPAY_ORACLE_PRICE_INVALID");
  return (((maxContribution + 1n) * EXP_SCALE) - 1n) / oraclePriceMantissa;
}

/**
 * Prepare a repay allocation from a finalized Health Guard PREPARE/RESCUE state.
 *
 * This creates no calldata, allowance, signature, wallet authority, or execution
 * permission. It answers only: if collateral and oracle state stayed frozen,
 * what raw debt reduction would be sufficient to move protocol-denominated
 * threshold utilization at or below the caller's explicit target?
 */
export function prepareVenusRepayPlan(input: {
  state: VenusCoreAccountState;
  strategy: VenusHealthStrategyProposal;
  targetThresholdUtilizationBps: bigint;
}): VenusRepayPreparation {
  const { state, strategy, targetThresholdUtilizationBps } = input;

  if (strategy.decision !== "PREPARE" && strategy.decision !== "RESCUE") {
    throw new Error(`VENUS_REPAY_PREPARATION_STRATEGY_NOT_ELIGIBLE:${strategy.decision}`);
  }
  if (strategy.requiresRefreshBeforeExecution !== true) {
    throw new Error("VENUS_REPAY_PREPARATION_REQUIRES_REFRESH_GATE");
  }
  if (strategy.nativeLiquidityExactMatch !== true) {
    throw new Error("VENUS_REPAY_PREPARATION_REQUIRES_EXACT_NATIVE_MATCH");
  }
  if (strategy.account.toLowerCase() !== state.account.toLowerCase()) {
    throw new Error("VENUS_REPAY_PREPARATION_ACCOUNT_MISMATCH");
  }
  if (strategy.sourceFinalizedBlockNumber !== state.snapshot.blockNumber
    || strategy.sourceFinalizedBlockHash.toLowerCase() !== state.snapshot.blockHash.toLowerCase()) {
    throw new Error("VENUS_REPAY_PREPARATION_BLOCK_MISMATCH");
  }
  if (state.snapshot.blockTag !== "finalized") {
    throw new Error(`VENUS_REPAY_PREPARATION_REQUIRES_FINALIZED_STATE:${state.snapshot.blockTag}`);
  }
  if (targetThresholdUtilizationBps < 0n || targetThresholdUtilizationBps >= BPS_SCALE) {
    throw new Error(`VENUS_REPAY_TARGET_UTILIZATION_INVALID:${targetThresholdUtilizationBps.toString()}`);
  }

  const reconstruction = reconstructVenusAccountLiquidity(state);
  if (!reconstruction.exactNativeMatch) {
    throw new Error("VENUS_REPAY_PREPARATION_RECONSTRUCTION_MISMATCH");
  }

  const collateral = reconstruction.sumCollateralMantissa;
  const borrow = reconstruction.sumBorrowPlusEffectsMantissa;
  if (borrow <= 0n) throw new Error("VENUS_REPAY_PREPARATION_NO_CURRENT_DEBT");
  if (collateral === 0n && targetThresholdUtilizationBps !== 0n) {
    throw new Error("VENUS_REPAY_ZERO_COLLATERAL_REQUIRES_ZERO_TARGET");
  }

  const targetMaximumBorrow = collateral === 0n
    ? 0n
    : (collateral * targetThresholdUtilizationBps) / BPS_SCALE;
  if (borrow <= targetMaximumBorrow) {
    throw new Error("VENUS_REPAY_TARGET_NOT_BELOW_CURRENT_EXPOSURE");
  }
  const requiredReduction = borrow - targetMaximumBorrow;

  const marketByVToken = new Map(state.activeMarkets.map((market) => [market.vToken.toLowerCase(), market]));
  const debtContributions = reconstruction.markets
    .filter((market) => market.borrowContributionMantissa > 0n && market.borrowBalance > 0n)
    .sort((a, b) => a.borrowContributionMantissa === b.borrowContributionMantissa
      ? a.vToken.localeCompare(b.vToken)
      : a.borrowContributionMantissa > b.borrowContributionMantissa ? -1 : 1);

  let remainingReduction = requiredReduction;
  let totalActualReduction = 0n;
  const legs: VenusRepayPreparationLeg[] = [];

  for (const contribution of debtContributions) {
    if (remainingReduction === 0n) break;
    const market = marketByVToken.get(contribution.vToken.toLowerCase());
    if (!market) throw new Error(`VENUS_REPAY_MARKET_MISSING:${contribution.vToken}`);

    const desiredReduction = minBigInt(remainingReduction, contribution.borrowContributionMantissa);
    const targetContribution = contribution.borrowContributionMantissa - desiredReduction;
    const maxTargetRaw = maxRawBalanceForContribution(targetContribution, contribution.oraclePriceMantissa);
    const projectedBorrowBalanceRaw = minBigInt(contribution.borrowBalance, maxTargetRaw);
    const preparedRepayAmountRaw = contribution.borrowBalance - projectedBorrowBalanceRaw;
    if (preparedRepayAmountRaw <= 0n) {
      throw new Error(`VENUS_REPAY_ROUNDING_COULD_NOT_REDUCE:${contribution.vToken}`);
    }

    const projectedBorrowContributionMantissa = mulVenusExpScalarTruncate(
      contribution.oraclePriceMantissa,
      projectedBorrowBalanceRaw
    );
    const actualReduction = contribution.borrowContributionMantissa - projectedBorrowContributionMantissa;
    if (actualReduction < desiredReduction) {
      throw new Error(`VENUS_REPAY_ROUNDING_UNDERREDUCED:${contribution.vToken}`);
    }

    totalActualReduction += actualReduction;
    remainingReduction = actualReduction >= remainingReduction ? 0n : remainingReduction - actualReduction;
    legs.push({
      vToken: market.vToken,
      underlyingKind: market.underlyingKind,
      underlyingAddress: market.underlyingAddress,
      underlyingSymbol: market.underlyingSymbol,
      underlyingDecimals: market.underlyingDecimals,
      oraclePriceMantissa: contribution.oraclePriceMantissa,
      currentBorrowBalanceRaw: contribution.borrowBalance,
      preparedRepayAmountRaw,
      projectedBorrowBalanceRaw,
      currentBorrowContributionMantissa: contribution.borrowContributionMantissa,
      projectedBorrowContributionMantissa,
      contributionReductionMantissa: actualReduction
    });
  }

  if (remainingReduction !== 0n) {
    throw new Error(`VENUS_REPAY_INSUFFICIENT_DEBT_ALLOCATION:${remainingReduction.toString()}`);
  }

  const projectedBorrowContribution = borrow - totalActualReduction;
  if (projectedBorrowContribution > targetMaximumBorrow) {
    throw new Error("VENUS_REPAY_PROJECTED_BORROW_EXCEEDS_TARGET");
  }
  const projectedThresholdUtilizationBps = collateral > 0n
    ? (projectedBorrowContribution * BPS_SCALE) / collateral
    : projectedBorrowContribution === 0n ? 0n : null;

  return {
    schemaVersion: "kumo-venus-repay-preparation-v1",
    classification: "READ_ONLY_PREPARATION_NO_EXECUTION_AUTHORITY",
    account: state.account,
    sourceFinalizedBlockNumber: state.snapshot.blockNumber,
    sourceFinalizedBlockHash: state.snapshot.blockHash,
    sourceStrategyDecision: strategy.decision,
    sourceStrategyPhase: strategy.phase,
    sourceObjectId: strategy.sourceObjectId,
    sourceObjectVersion: strategy.sourceObjectVersion,
    riskPolicyId: strategy.riskPolicyId,
    targetThresholdUtilizationBps,
    currentCollateralContributionMantissa: collateral,
    currentBorrowContributionMantissa: borrow,
    targetMaximumBorrowContributionMantissa: targetMaximumBorrow,
    requiredBorrowContributionReductionMantissa: requiredReduction,
    projectedBorrowContributionMantissa: projectedBorrowContribution,
    projectedThresholdUtilizationBps,
    legs,
    requiresRefreshBeforeExecution: true,
    requiresExecutableQuoteBeforeExecution: true,
    executionAuthorityCreated: false,
    transactionRequest: null,
    limitations: [
      "This is a frozen-state repayment preparation, not an executable quote or transaction.",
      "Collateral, exchange rates, interest accrual, oracle prices, and debt may change after the source finalized block; all consequential values must be refreshed before execution.",
      "The target threshold utilization is caller-supplied policy intent, not a Venus protocol parameter.",
      "Repay legs are allocated deterministically from the largest protocol-denominated debt contribution first; route, funding source, gas, token approval, and wallet authority are intentionally absent.",
      "No execution authority, signature, allowance, calldata, or transaction request is created by this function."
    ]
  };
}
