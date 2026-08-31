import type { NoemaAgentAssessment } from "@kumo/noema-agent-profile";
import type { VenusLendingPositionEconomicState } from "./noema.js";

export type HealthGuardDecision = "REFUSE" | "IGNORE" | "MONITOR" | "PREPARE" | "RESCUE";
export type HealthGuardPhase = "UNVERIFIED" | "HEALTHY" | "WATCH" | "WARN" | "PREPARE" | "RESCUE";

export const KUMO_VENUS_HEALTH_POLICY_V1 = {
  id: "kumo-venus-health-policy-v1",
  warnThresholdUtilizationBps: 8_000n,
  prepareThresholdUtilizationBps: 9_091n,
  rationaleSource: "venus-community:monthly-report:2026-07:risk-and-liquidations",
  semantics: "KUMO_POLICY_OVER_EXACT_VENUS_NATIVE_LIQUIDATION_BUFFER_NOT_PROTOCOL_PARAMETER"
} as const;

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
  nativeLiquidityExactMatch: boolean;
  liquidationBufferState: VenusLendingPositionEconomicState["liquidationBufferState"];
  thresholdUtilizationBps: string | null;
  liquidationBufferBpsOfBorrow: string | null;
  riskPolicyId: typeof KUMO_VENUS_HEALTH_POLICY_V1.id;
  requiresRefreshBeforeExecution: boolean;
  rescueExecutionEligible: boolean;
  inferenceUsed: false;
  reasonCodes: string[];
}

function proposal(
  assessment: NoemaAgentAssessment<VenusLendingPositionEconomicState>,
  input: Pick<VenusHealthStrategyProposal,
    "decision" | "phase" | "requiresRefreshBeforeExecution" | "rescueExecutionEligible" | "reasonCodes">
): VenusHealthStrategyProposal {
  const economics = assessment.economicObject.economics;
  return {
    ...input,
    sourceObjectId: assessment.economicObject.id,
    sourceObjectVersion: assessment.economicObject.version,
    sourcePositionState: economics.positionState,
    account: economics.account,
    accountLiquidityMantissa: economics.accountLiquidityMantissa,
    accountShortfallMantissa: economics.accountShortfallMantissa,
    liveCollateralMarketCount: economics.liveCollateralMarketCount,
    debtMarketCount: economics.debtMarketCount,
    nativeLiquidityExactMatch: economics.nativeLiquidityExactMatch,
    liquidationBufferState: economics.liquidationBufferState,
    thresholdUtilizationBps: economics.thresholdUtilizationBps,
    liquidationBufferBpsOfBorrow: economics.liquidationBufferBpsOfBorrow,
    riskPolicyId: KUMO_VENUS_HEALTH_POLICY_V1.id,
    inferenceUsed: false
  };
}

function refused(
  assessment: NoemaAgentAssessment<VenusLendingPositionEconomicState>,
  reasonCodes: string[]
): VenusHealthStrategyProposal {
  return proposal(assessment, {
    decision: "REFUSE",
    phase: "UNVERIFIED",
    requiresRefreshBeforeExecution: false,
    rescueExecutionEligible: false,
    reasonCodes
  });
}

/**
 * Deterministic Health Guard strategy over a Noema-verified Venus lending object.
 *
 * Venus-native liquidity/shortfall remain protocol truth. Threshold utilization
 * is admitted only after exact deterministic reconstruction equivalence, and the
 * WARN/PREPARE boundaries below are Kumo policy rather than Venus parameters.
 * No forward forecast or generic health-factor claim is used here.
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
  if (economics.nativeLiquidityExactMatch !== true) {
    return refused(assessment, ["VENUS_NATIVE_LIQUIDITY_RECONSTRUCTION_NOT_EXACT"]);
  }
  if (economics.liquidationBufferState === null) {
    return refused(assessment, ["VENUS_LIQUIDATION_BUFFER_UNAVAILABLE"]);
  }

  const liquidity = BigInt(economics.accountLiquidityMantissa);
  const shortfall = BigInt(economics.accountShortfallMantissa);
  const thresholdUtilization = economics.thresholdUtilizationBps === null
    ? null
    : BigInt(economics.thresholdUtilizationBps);

  switch (economics.positionState) {
    case "NO_POSITION":
      if (economics.liveCollateralMarketCount !== 0 || economics.debtMarketCount !== 0) {
        return refused(assessment, ["NO_POSITION_COUNTS_CONTRADICT_STATE"]);
      }
      if (economics.liquidationBufferState !== "NO_DEBT") {
        return refused(assessment, ["NO_POSITION_BUFFER_CONTRADICTS_STATE"]);
      }
      return proposal(assessment, {
        decision: "IGNORE",
        phase: "HEALTHY",
        requiresRefreshBeforeExecution: false,
        rescueExecutionEligible: false,
        reasonCodes: ["NO_LIVE_VENUS_POSITION"]
      });

    case "COLLATERAL_ONLY":
      if (economics.liveCollateralMarketCount <= 0 || economics.debtMarketCount !== 0 || shortfall > 0n) {
        return refused(assessment, ["COLLATERAL_ONLY_FACTS_CONTRADICT_STATE"]);
      }
      if (economics.liquidationBufferState !== "NO_DEBT" || economics.liquidationBufferBpsOfBorrow !== null) {
        return refused(assessment, ["COLLATERAL_ONLY_BUFFER_CONTRADICTS_STATE"]);
      }
      return proposal(assessment, {
        decision: "MONITOR",
        phase: "WATCH",
        requiresRefreshBeforeExecution: false,
        rescueExecutionEligible: false,
        reasonCodes: ["LIVE_COLLATERAL_NO_CURRENT_DEBT"]
      });

    case "DEBT_ONLY":
      if (economics.debtMarketCount <= 0 || economics.liveCollateralMarketCount !== 0 || shortfall > 0n) {
        return refused(assessment, ["DEBT_ONLY_FACTS_CONTRADICT_STATE"]);
      }
      return proposal(assessment, {
        decision: "PREPARE",
        phase: "WARN",
        requiresRefreshBeforeExecution: true,
        rescueExecutionEligible: false,
        reasonCodes: ["CURRENT_DEBT_WITHOUT_LIVE_ENTERED_COLLATERAL"]
      });

    case "BORROWING_SOLVENT": {
      if (economics.debtMarketCount <= 0 || economics.liveCollateralMarketCount <= 0 || liquidity <= 0n || shortfall !== 0n) {
        return refused(assessment, ["BORROWING_SOLVENT_FACTS_CONTRADICT_STATE"]);
      }
      if (economics.liquidationBufferState !== "SOLVENT_WITH_BUFFER" || thresholdUtilization === null) {
        return refused(assessment, ["BORROWING_SOLVENT_BUFFER_CONTRADICTS_STATE"]);
      }
      if (thresholdUtilization >= KUMO_VENUS_HEALTH_POLICY_V1.prepareThresholdUtilizationBps) {
        return proposal(assessment, {
          decision: "PREPARE",
          phase: "PREPARE",
          requiresRefreshBeforeExecution: true,
          rescueExecutionEligible: false,
          reasonCodes: [
            "VENUS_NATIVE_LIQUIDITY_POSITIVE",
            "KUMO_THRESHOLD_UTILIZATION_PREPARE_BAND",
            "RESCUE_NOT_AUTHORIZED_WITHOUT_NATIVE_SHORTFALL"
          ]
        });
      }
      if (thresholdUtilization >= KUMO_VENUS_HEALTH_POLICY_V1.warnThresholdUtilizationBps) {
        return proposal(assessment, {
          decision: "MONITOR",
          phase: "WARN",
          requiresRefreshBeforeExecution: false,
          rescueExecutionEligible: false,
          reasonCodes: ["VENUS_NATIVE_LIQUIDITY_POSITIVE", "KUMO_THRESHOLD_UTILIZATION_WARN_BAND"]
        });
      }
      return proposal(assessment, {
        decision: "MONITOR",
        phase: "WATCH",
        requiresRefreshBeforeExecution: false,
        rescueExecutionEligible: false,
        reasonCodes: ["VENUS_NATIVE_LIQUIDITY_POSITIVE", "KUMO_THRESHOLD_UTILIZATION_BELOW_WARN"]
      });
    }

    case "BORROWING_AT_LIQUIDATION_THRESHOLD":
      if (economics.debtMarketCount <= 0 || economics.liveCollateralMarketCount <= 0 || liquidity !== 0n || shortfall !== 0n) {
        return refused(assessment, ["THRESHOLD_FACTS_CONTRADICT_STATE"]);
      }
      if (economics.liquidationBufferState !== "AT_LIQUIDATION_THRESHOLD") {
        return refused(assessment, ["THRESHOLD_BUFFER_CONTRADICTS_STATE"]);
      }
      return proposal(assessment, {
        decision: "PREPARE",
        phase: "PREPARE",
        requiresRefreshBeforeExecution: true,
        rescueExecutionEligible: false,
        reasonCodes: ["VENUS_NATIVE_ZERO_LIQUIDITY_ZERO_SHORTFALL", "RESCUE_NOT_AUTHORIZED_WITHOUT_NATIVE_SHORTFALL"]
      });

    case "LIQUIDATION_ELIGIBLE":
      if (economics.debtMarketCount <= 0 || shortfall <= 0n) {
        return refused(assessment, ["LIQUIDATION_ELIGIBLE_FACTS_CONTRADICT_STATE"]);
      }
      if (economics.liquidationBufferState !== "LIQUIDATION_ELIGIBLE") {
        return refused(assessment, ["LIQUIDATION_ELIGIBLE_BUFFER_CONTRADICTS_STATE"]);
      }
      reasons.push("VENUS_NATIVE_SHORTFALL_POSITIVE");
      if (economics.liveCollateralMarketCount === 0) reasons.push("NO_LIVE_ENTERED_COLLATERAL_OBSERVED");
      return proposal(assessment, {
        decision: "RESCUE",
        phase: "RESCUE",
        requiresRefreshBeforeExecution: true,
        rescueExecutionEligible: true,
        reasonCodes: reasons
      });
  }
}
