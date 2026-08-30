import type { NoemaAgentAssessment } from "@kumo/noema-agent-profile";
import type { VenusLendingPositionEconomicState } from "./noema.js";

export type HealthGuardDecision = "REFUSE" | "IGNORE" | "MONITOR" | "PREPARE" | "RESCUE";
export type HealthGuardPhase = "UNVERIFIED" | "HEALTHY" | "WATCH" | "WARN" | "PREPARE" | "RESCUE";

export interface VenusHealthStrategyProposal {
  decision: HealthGuardDecision;
  phase: HealthGuardPhase;
  sourceObjectId: string;
  sourceObjectVersion: number;
  sourcePositionState: VenusLendingPositionEconomicState["positionState"];
  account: string;
  accountLiquidityMantissa: string;
  accountShortfallMantissa: string;
  liveCollateralMarketCount: number;
  debtMarketCount: number;
  requiresRefreshBeforeExecution: boolean;
  rescueExecutionEligible: boolean;
  inferenceUsed: false;
  reasonCodes: string[];
}

function refused(
  assessment: NoemaAgentAssessment<VenusLendingPositionEconomicState>,
  reasonCodes: string[]
): VenusHealthStrategyProposal {
  const economics = assessment.economicObject.economics;
  return {
    decision: "REFUSE",
    phase: "UNVERIFIED",
    sourceObjectId: assessment.economicObject.id,
    sourceObjectVersion: assessment.economicObject.version,
    sourcePositionState: economics.positionState,
    account: economics.account,
    accountLiquidityMantissa: economics.accountLiquidityMantissa,
    accountShortfallMantissa: economics.accountShortfallMantissa,
    liveCollateralMarketCount: economics.liveCollateralMarketCount,
    debtMarketCount: economics.debtMarketCount,
    requiresRefreshBeforeExecution: false,
    rescueExecutionEligible: false,
    inferenceUsed: false,
    reasonCodes
  };
}

/**
 * Deterministic Health Guard strategy over a Noema-verified Venus lending object.
 *
 * v0.1 deliberately makes no forecast and derives no generic health score.
 * The strategy only maps current verified protocol state into categorical action
 * posture. Any later deterioration forecast must enter as an explicit Noema
 * inference proposal and cannot silently change these current-state facts.
 */
export function decideVenusHealthStrategy(
  assessment: NoemaAgentAssessment<VenusLendingPositionEconomicState>
): VenusHealthStrategyProposal {
  const object = assessment.economicObject;
  const economics = object.economics;
  const reasons: string[] = [];

  if (object.verification.status !== "PASS") {
    return refused(assessment, [`OBJECT_VERIFICATION_${object.verification.status}`]);
  }
  if (object.status !== "RESOLVED") {
    return refused(assessment, [`OBJECT_${object.status}`]);
  }
  if (assessment.evaluation.decision !== "ALLOW") {
    return refused(assessment, [`MANDATE_${assessment.evaluation.decision}`, ...assessment.evaluation.reasonCodes]);
  }
  if (assessment.inferenceProposals.length !== 0) {
    return refused(assessment, ["CURRENT_STATE_STRATEGY_REQUIRES_ZERO_PROMOTED_INFERENCE"]);
  }

  const liquidity = BigInt(economics.accountLiquidityMantissa);
  const shortfall = BigInt(economics.accountShortfallMantissa);

  switch (economics.positionState) {
    case "NO_POSITION":
      if (economics.liveCollateralMarketCount !== 0 || economics.debtMarketCount !== 0) {
        return refused(assessment, ["NO_POSITION_COUNTS_CONTRADICT_STATE"]);
      }
      return {
        decision: "IGNORE",
        phase: "HEALTHY",
        sourceObjectId: object.id,
        sourceObjectVersion: object.version,
        sourcePositionState: economics.positionState,
        account: economics.account,
        accountLiquidityMantissa: economics.accountLiquidityMantissa,
        accountShortfallMantissa: economics.accountShortfallMantissa,
        liveCollateralMarketCount: economics.liveCollateralMarketCount,
        debtMarketCount: economics.debtMarketCount,
        requiresRefreshBeforeExecution: false,
        rescueExecutionEligible: false,
        inferenceUsed: false,
        reasonCodes: ["NO_LIVE_VENUS_POSITION"]
      };

    case "COLLATERAL_ONLY":
      if (economics.liveCollateralMarketCount <= 0 || economics.debtMarketCount !== 0 || shortfall > 0n) {
        return refused(assessment, ["COLLATERAL_ONLY_FACTS_CONTRADICT_STATE"]);
      }
      return {
        decision: "MONITOR",
        phase: "WATCH",
        sourceObjectId: object.id,
        sourceObjectVersion: object.version,
        sourcePositionState: economics.positionState,
        account: economics.account,
        accountLiquidityMantissa: economics.accountLiquidityMantissa,
        accountShortfallMantissa: economics.accountShortfallMantissa,
        liveCollateralMarketCount: economics.liveCollateralMarketCount,
        debtMarketCount: economics.debtMarketCount,
        requiresRefreshBeforeExecution: false,
        rescueExecutionEligible: false,
        inferenceUsed: false,
        reasonCodes: ["LIVE_COLLATERAL_NO_CURRENT_DEBT"]
      };

    case "DEBT_ONLY":
      if (economics.debtMarketCount <= 0 || economics.liveCollateralMarketCount !== 0 || shortfall > 0n) {
        return refused(assessment, ["DEBT_ONLY_FACTS_CONTRADICT_STATE"]);
      }
      return {
        decision: "PREPARE",
        phase: "WARN",
        sourceObjectId: object.id,
        sourceObjectVersion: object.version,
        sourcePositionState: economics.positionState,
        account: economics.account,
        accountLiquidityMantissa: economics.accountLiquidityMantissa,
        accountShortfallMantissa: economics.accountShortfallMantissa,
        liveCollateralMarketCount: economics.liveCollateralMarketCount,
        debtMarketCount: economics.debtMarketCount,
        requiresRefreshBeforeExecution: true,
        rescueExecutionEligible: false,
        inferenceUsed: false,
        reasonCodes: ["CURRENT_DEBT_WITHOUT_LIVE_ENTERED_COLLATERAL"]
      };

    case "BORROWING_SOLVENT":
      if (economics.debtMarketCount <= 0 || economics.liveCollateralMarketCount <= 0 || liquidity <= 0n || shortfall !== 0n) {
        return refused(assessment, ["BORROWING_SOLVENT_FACTS_CONTRADICT_STATE"]);
      }
      return {
        decision: "MONITOR",
        phase: "WATCH",
        sourceObjectId: object.id,
        sourceObjectVersion: object.version,
        sourcePositionState: economics.positionState,
        account: economics.account,
        accountLiquidityMantissa: economics.accountLiquidityMantissa,
        accountShortfallMantissa: economics.accountShortfallMantissa,
        liveCollateralMarketCount: economics.liveCollateralMarketCount,
        debtMarketCount: economics.debtMarketCount,
        requiresRefreshBeforeExecution: false,
        rescueExecutionEligible: false,
        inferenceUsed: false,
        reasonCodes: ["VENUS_NATIVE_LIQUIDITY_POSITIVE", "NO_VALIDATED_DISTANCE_TO_LIQUIDATION_METRIC_YET"]
      };

    case "BORROWING_AT_LIQUIDATION_THRESHOLD":
      if (economics.debtMarketCount <= 0 || economics.liveCollateralMarketCount <= 0 || liquidity !== 0n || shortfall !== 0n) {
        return refused(assessment, ["THRESHOLD_FACTS_CONTRADICT_STATE"]);
      }
      return {
        decision: "PREPARE",
        phase: "PREPARE",
        sourceObjectId: object.id,
        sourceObjectVersion: object.version,
        sourcePositionState: economics.positionState,
        account: economics.account,
        accountLiquidityMantissa: economics.accountLiquidityMantissa,
        accountShortfallMantissa: economics.accountShortfallMantissa,
        liveCollateralMarketCount: economics.liveCollateralMarketCount,
        debtMarketCount: economics.debtMarketCount,
        requiresRefreshBeforeExecution: true,
        rescueExecutionEligible: false,
        inferenceUsed: false,
        reasonCodes: ["VENUS_NATIVE_ZERO_LIQUIDITY_ZERO_SHORTFALL", "RESCUE_NOT_AUTHORIZED_WITHOUT_REFRESH"]
      };

    case "LIQUIDATION_ELIGIBLE":
      if (economics.debtMarketCount <= 0 || shortfall <= 0n) {
        return refused(assessment, ["LIQUIDATION_ELIGIBLE_FACTS_CONTRADICT_STATE"]);
      }
      reasons.push("VENUS_NATIVE_SHORTFALL_POSITIVE");
      if (economics.liveCollateralMarketCount === 0) reasons.push("NO_LIVE_ENTERED_COLLATERAL_OBSERVED");
      return {
        decision: "RESCUE",
        phase: "RESCUE",
        sourceObjectId: object.id,
        sourceObjectVersion: object.version,
        sourcePositionState: economics.positionState,
        account: economics.account,
        accountLiquidityMantissa: economics.accountLiquidityMantissa,
        accountShortfallMantissa: economics.accountShortfallMantissa,
        liveCollateralMarketCount: economics.liveCollateralMarketCount,
        debtMarketCount: economics.debtMarketCount,
        requiresRefreshBeforeExecution: true,
        rescueExecutionEligible: true,
        inferenceUsed: false,
        reasonCodes: reasons
      };
  }
}
