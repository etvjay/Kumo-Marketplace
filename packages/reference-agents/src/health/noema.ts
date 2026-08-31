import {
  NOEMA_AGENT_PROFILE_VERSION,
  NOEMA_UPSTREAM_REF,
  evaluateNoemaMandate,
  type NoemaAgentAssessment,
  type NoemaAgentClaim,
  type NoemaAgentEconomicObject,
  type NoemaAgentEvidenceRef,
  type NoemaAgentMandate
} from "@kumo/noema-agent-profile";
import { assessVenusHealthState, type VenusHealthPositionState } from "./cognition.js";
import {
  VENUS_LIQUIDITY_RECONSTRUCTION_RULE,
  deriveVenusNativeLiquidationBuffer,
  reconstructVenusAccountLiquidity,
  type VenusLiquidationBufferState
} from "./valuation.js";
import type { VenusCoreAccountState } from "./types.js";

export interface VenusLendingMarketRiskState {
  [key: string]: string | boolean;
  vToken: string;
  enteredAsCollateralMarket: boolean;
  hasLiveSupply: boolean;
  hasCurrentDebt: boolean;
  baseCollateralFactorMantissa: string;
  baseLiquidationThresholdMantissa: string;
  baseLiquidationIncentiveMantissa: string;
  effectiveCollateralFactorMantissa: string;
  effectiveLiquidationThresholdMantissa: string;
  effectiveLiquidationIncentiveMantissa: string;
  differsFromBasePolicy: boolean;
}

export interface VenusLendingPositionEconomicState {
  chainId: 56;
  protocol: "venus-core";
  account: string;
  positionState: VenusHealthPositionState;
  accountLiquidityMantissa: string;
  accountShortfallMantissa: string;
  liveCollateralMarketCount: number;
  debtMarketCount: number;
  enteredMarketCount: number;
  listedMarketCount: number;
  accountEffectivePolicyObserved: true;
  differentiatedRiskPolicyMarketCount: number;
  marketRisk: VenusLendingMarketRiskState[];
  nativeLiquidityReconstructionRule: typeof VENUS_LIQUIDITY_RECONSTRUCTION_RULE;
  nativeLiquidityExactMatch: boolean;
  protocolCollateralContributionMantissa: string;
  protocolBorrowContributionMantissa: string;
  liquidationBufferState: VenusLiquidationBufferState | null;
  thresholdUtilizationBps: string | null;
  liquidationBufferBpsOfBorrow: string | null;
  finalizedBlockNumber: string;
  finalizedBlockHash: string;
}

function claim(input: NoemaAgentClaim): NoemaAgentClaim {
  return input;
}

function toMarketRisk(state: VenusCoreAccountState): VenusLendingMarketRiskState[] {
  return state.activeMarkets.map((market) => ({
    vToken: market.vToken,
    enteredAsCollateralMarket: market.enteredAsCollateralMarket,
    hasLiveSupply: market.vTokenBalance > 0n,
    hasCurrentDebt: market.borrowBalance > 0n,
    baseCollateralFactorMantissa: market.baseCollateralFactorMantissa.toString(),
    baseLiquidationThresholdMantissa: market.baseLiquidationThresholdMantissa.toString(),
    baseLiquidationIncentiveMantissa: market.baseLiquidationIncentiveMantissa.toString(),
    effectiveCollateralFactorMantissa: market.effectiveCollateralFactorMantissa.toString(),
    effectiveLiquidationThresholdMantissa: market.effectiveLiquidationThresholdMantissa.toString(),
    effectiveLiquidationIncentiveMantissa: market.effectiveLiquidationIncentiveMantissa.toString(),
    differsFromBasePolicy:
      market.baseCollateralFactorMantissa !== market.effectiveCollateralFactorMantissa
      || market.baseLiquidationThresholdMantissa !== market.effectiveLiquidationThresholdMantissa
      || market.baseLiquidationIncentiveMantissa !== market.effectiveLiquidationIncentiveMantissa
  }));
}

export function buildVenusLendingPositionEconomicObject(input: {
  state: VenusCoreAccountState;
  evaluatedAt: number;
  maxEvidenceAgeMs?: number;
}): NoemaAgentEconomicObject<VenusLendingPositionEconomicState> {
  const { state, evaluatedAt } = input;
  const maxEvidenceAgeMs = input.maxEvidenceAgeMs ?? 60_000;
  const observedAt = Date.parse(state.snapshot.observedAt);
  if (!Number.isFinite(observedAt)) throw new Error(`VENUS_NOEMA_INVALID_OBSERVED_AT:${state.snapshot.observedAt}`);

  const assessment = assessVenusHealthState(state);
  const marketRisk = toMarketRisk(state);
  const differentiatedRiskPolicyMarketCount = marketRisk.filter((market) => market.differsFromBasePolicy).length;
  const reconstruction = reconstructVenusAccountLiquidity(state);
  const liquidationBuffer = reconstruction.exactNativeMatch
    ? deriveVenusNativeLiquidationBuffer(reconstruction)
    : null;

  const objectId = `noema:venus-lending-position:${state.chainId}:${state.account.toLowerCase()}`;
  const chainEvidenceId = `${objectId}:evidence:block:${state.snapshot.blockNumber}`;
  const accountEvidenceId = `${objectId}:evidence:account:${state.snapshot.blockNumber}`;
  const marketEvidenceId = `${objectId}:evidence:markets:${state.snapshot.blockNumber}`;
  const reconstructionEvidenceId = `${objectId}:evidence:liquidity-reconstruction:${state.snapshot.blockNumber}`;
  const freshness = evaluatedAt - observedAt <= maxEvidenceAgeMs ? "FRESH" : "STALE";

  const evidence: NoemaAgentEvidenceRef[] = [
    {
      id: chainEvidenceId,
      type: "ONCHAIN_STATE",
      source: `bsc:block:${state.snapshot.blockNumber}:${state.snapshot.blockHash}`,
      authority: "ONCHAIN_STATE",
      observedAt,
      fetchedAt: evaluatedAt,
      freshness,
      metadata: {
        chainId: state.chainId,
        blockNumber: state.snapshot.blockNumber,
        blockHash: state.snapshot.blockHash,
        blockTag: state.snapshot.blockTag
      }
    },
    {
      id: accountEvidenceId,
      type: "ONCHAIN_STATE",
      source: `venus-core:${state.comptroller}:account:${state.account}`,
      authority: "ONCHAIN_STATE",
      observedAt,
      fetchedAt: evaluatedAt,
      freshness,
      metadata: {
        account: state.account,
        accountLiquidityMantissa: state.accountLiquidity.toString(),
        accountShortfallMantissa: state.accountShortfall.toString(),
        liquidityError: state.liquidityError.toString()
      }
    },
    {
      id: marketEvidenceId,
      type: "ONCHAIN_STATE",
      source: `venus-core:${state.comptroller}:markets:${state.account}`,
      authority: "ONCHAIN_STATE",
      observedAt,
      fetchedAt: evaluatedAt,
      freshness,
      metadata: {
        enteredMarketCount: state.enteredMarkets.length,
        listedMarketCount: state.listedMarketCount,
        liveCollateralMarketCount: assessment.liveCollateralMarketCount,
        debtMarketCount: assessment.debtMarketCount,
        accountEffectivePolicyObserved: true,
        differentiatedRiskPolicyMarketCount,
        marketRisk
      }
    },
    {
      id: reconstructionEvidenceId,
      type: "PROOF",
      source: `rule:${VENUS_LIQUIDITY_RECONSTRUCTION_RULE}`,
      authority: "DERIVED",
      observedAt,
      fetchedAt: evaluatedAt,
      freshness,
      metadata: {
        rule: reconstruction.rule,
        exactNativeMatch: reconstruction.exactNativeMatch,
        sumCollateralMantissa: reconstruction.sumCollateralMantissa.toString(),
        sumBorrowPlusEffectsMantissa: reconstruction.sumBorrowPlusEffectsMantissa.toString(),
        derivedLiquidity: reconstruction.derivedLiquidity.toString(),
        derivedShortfall: reconstruction.derivedShortfall.toString(),
        nativeLiquidity: reconstruction.nativeLiquidity.toString(),
        nativeShortfall: reconstruction.nativeShortfall.toString(),
        liquidityDelta: reconstruction.liquidityDelta.toString(),
        shortfallDelta: reconstruction.shortfallDelta.toString(),
        liquidationBufferState: liquidationBuffer?.state ?? null,
        thresholdUtilizationBps: liquidationBuffer?.thresholdUtilizationBps?.toString() ?? null,
        liquidationBufferBpsOfBorrow: liquidationBuffer?.liquidationBufferBpsOfBorrow?.toString() ?? null
      }
    }
  ];

  const classificationClaimId = `${objectId}:claim:classification`;
  const claims: NoemaAgentClaim[] = [
    claim({
      id: classificationClaimId,
      subject: objectId,
      property: "economicObject.type",
      value: "VENUS_CORE_LENDING_POSITION",
      state: "VERIFIED",
      sourceRefs: ["rule:kumo-venus-lending-object-v1"],
      evidenceRefs: [accountEvidenceId, marketEvidenceId],
      confidence: 1,
      observedAt,
      createdAt: evaluatedAt
    }),
    claim({
      id: `${objectId}:claim:positionState`,
      subject: objectId,
      property: "position.state",
      value: assessment.state,
      state: "VERIFIED",
      sourceRefs: ["rule:kumo-venus-position-state-v1"],
      evidenceRefs: [accountEvidenceId, marketEvidenceId],
      confidence: 1,
      observedAt,
      createdAt: evaluatedAt
    }),
    claim({
      id: `${objectId}:claim:accountLiquidity`,
      subject: objectId,
      property: "venus.accountLiquidityMantissa",
      value: state.accountLiquidity.toString(),
      state: "VERIFIED",
      sourceRefs: [`venus-core:${state.comptroller}:getAccountLiquidity`],
      evidenceRefs: [accountEvidenceId],
      confidence: 1,
      observedAt,
      createdAt: evaluatedAt
    }),
    claim({
      id: `${objectId}:claim:accountShortfall`,
      subject: objectId,
      property: "venus.accountShortfallMantissa",
      value: state.accountShortfall.toString(),
      state: "VERIFIED",
      sourceRefs: [`venus-core:${state.comptroller}:getAccountLiquidity`],
      evidenceRefs: [accountEvidenceId],
      confidence: 1,
      observedAt,
      createdAt: evaluatedAt
    }),
    claim({
      id: `${objectId}:claim:liveCollateralMarketCount`,
      subject: objectId,
      property: "position.liveCollateralMarketCount",
      value: assessment.liveCollateralMarketCount,
      state: "VERIFIED",
      sourceRefs: ["rule:kumo-venus-live-collateral-v1"],
      evidenceRefs: [marketEvidenceId],
      confidence: 1,
      observedAt,
      createdAt: evaluatedAt
    }),
    claim({
      id: `${objectId}:claim:debtMarketCount`,
      subject: objectId,
      property: "position.debtMarketCount",
      value: assessment.debtMarketCount,
      state: "VERIFIED",
      sourceRefs: ["rule:kumo-venus-current-debt-v1"],
      evidenceRefs: [marketEvidenceId],
      confidence: 1,
      observedAt,
      createdAt: evaluatedAt
    }),
    claim({
      id: `${objectId}:claim:effectiveRiskPolicyObserved`,
      subject: objectId,
      property: "risk.accountEffectivePolicyObserved",
      value: true,
      state: "VERIFIED",
      sourceRefs: [
        `venus-core:${state.comptroller}:getEffectiveLtvFactor`,
        `venus-core:${state.comptroller}:getEffectiveLiquidationIncentive`
      ],
      evidenceRefs: [marketEvidenceId],
      confidence: 1,
      observedAt,
      createdAt: evaluatedAt
    }),
    claim({
      id: `${objectId}:claim:differentiatedRiskPolicyMarketCount`,
      subject: objectId,
      property: "risk.differentiatedPolicyMarketCount",
      value: differentiatedRiskPolicyMarketCount,
      state: "VERIFIED",
      sourceRefs: ["rule:kumo-venus-effective-vs-base-policy-v1"],
      evidenceRefs: [marketEvidenceId],
      confidence: 1,
      observedAt,
      createdAt: evaluatedAt
    }),
    claim({
      id: `${objectId}:claim:nativeLiquidityReconstructionExact`,
      subject: objectId,
      property: "venus.nativeLiquidityReconstructionExact",
      value: reconstruction.exactNativeMatch,
      state: "VERIFIED",
      sourceRefs: [`rule:${VENUS_LIQUIDITY_RECONSTRUCTION_RULE}`],
      evidenceRefs: [accountEvidenceId, marketEvidenceId, reconstructionEvidenceId],
      confidence: 1,
      observedAt,
      createdAt: evaluatedAt
    }),
    claim({
      id: `${objectId}:claim:protocolCollateralContribution`,
      subject: objectId,
      property: "venus.protocolCollateralContributionMantissa",
      value: reconstruction.sumCollateralMantissa.toString(),
      state: "VERIFIED",
      sourceRefs: [`rule:${VENUS_LIQUIDITY_RECONSTRUCTION_RULE}`],
      evidenceRefs: [reconstructionEvidenceId],
      confidence: 1,
      observedAt,
      createdAt: evaluatedAt
    }),
    claim({
      id: `${objectId}:claim:protocolBorrowContribution`,
      subject: objectId,
      property: "venus.protocolBorrowContributionMantissa",
      value: reconstruction.sumBorrowPlusEffectsMantissa.toString(),
      state: "VERIFIED",
      sourceRefs: [`rule:${VENUS_LIQUIDITY_RECONSTRUCTION_RULE}`],
      evidenceRefs: [reconstructionEvidenceId],
      confidence: 1,
      observedAt,
      createdAt: evaluatedAt
    })
  ];

  if (liquidationBuffer) {
    claims.push(
      claim({
        id: `${objectId}:claim:liquidationBufferState`,
        subject: objectId,
        property: "venus.liquidationBufferState",
        value: liquidationBuffer.state,
        state: "VERIFIED",
        sourceRefs: [`rule:${VENUS_LIQUIDITY_RECONSTRUCTION_RULE}:buffer-v1`],
        evidenceRefs: [reconstructionEvidenceId],
        confidence: 1,
        observedAt,
        createdAt: evaluatedAt
      }),
      claim({
        id: `${objectId}:claim:thresholdUtilizationBps`,
        subject: objectId,
        property: "venus.thresholdUtilizationBps",
        value: liquidationBuffer.thresholdUtilizationBps?.toString() ?? null,
        state: "VERIFIED",
        sourceRefs: [`rule:${VENUS_LIQUIDITY_RECONSTRUCTION_RULE}:buffer-v1`],
        evidenceRefs: [reconstructionEvidenceId],
        confidence: 1,
        observedAt,
        createdAt: evaluatedAt
      }),
      claim({
        id: `${objectId}:claim:liquidationBufferBpsOfBorrow`,
        subject: objectId,
        property: "venus.liquidationBufferBpsOfBorrow",
        value: liquidationBuffer.liquidationBufferBpsOfBorrow?.toString() ?? null,
        state: "VERIFIED",
        sourceRefs: [`rule:${VENUS_LIQUIDITY_RECONSTRUCTION_RULE}:buffer-v1`],
        evidenceRefs: [reconstructionEvidenceId],
        confidence: 1,
        observedAt,
        createdAt: evaluatedAt
      })
    );
  }

  const finalized = state.snapshot.blockTag === "finalized";
  const liquidityReadSucceeded = state.liquidityError === 0n;
  const sameChain = state.chainId === 56 && state.snapshot.chainId === 56;
  const effectiveRiskComplete = state.activeMarkets.every((market) =>
    market.effectiveCollateralFactorMantissa >= 0n
    && market.effectiveLiquidationThresholdMantissa >= market.effectiveCollateralFactorMantissa
    && market.effectiveLiquidationIncentiveMantissa > 0n
  );
  const exactNativeLiquidityReconstruction = reconstruction.exactNativeMatch;
  const verificationStatus = finalized
    && liquidityReadSucceeded
    && sameChain
    && effectiveRiskComplete
    && exactNativeLiquidityReconstruction
    ? "PASS"
    : "FAIL";

  return {
    id: objectId,
    version: 2,
    objectType: "VENUS_CORE_LENDING_POSITION",
    classification: {
      primary: "LENDING_POSITION",
      secondary: ["VENUS_CORE", assessment.state],
      confidence: 1,
      claimRef: classificationClaimId
    },
    economics: {
      chainId: 56,
      protocol: "venus-core",
      account: state.account,
      positionState: assessment.state,
      accountLiquidityMantissa: state.accountLiquidity.toString(),
      accountShortfallMantissa: state.accountShortfall.toString(),
      liveCollateralMarketCount: assessment.liveCollateralMarketCount,
      debtMarketCount: assessment.debtMarketCount,
      enteredMarketCount: state.enteredMarkets.length,
      listedMarketCount: state.listedMarketCount,
      accountEffectivePolicyObserved: true,
      differentiatedRiskPolicyMarketCount,
      marketRisk,
      nativeLiquidityReconstructionRule: reconstruction.rule,
      nativeLiquidityExactMatch: reconstruction.exactNativeMatch,
      protocolCollateralContributionMantissa: reconstruction.sumCollateralMantissa.toString(),
      protocolBorrowContributionMantissa: reconstruction.sumBorrowPlusEffectsMantissa.toString(),
      liquidationBufferState: liquidationBuffer?.state ?? null,
      thresholdUtilizationBps: liquidationBuffer?.thresholdUtilizationBps?.toString() ?? null,
      liquidationBufferBpsOfBorrow: liquidationBuffer?.liquidationBufferBpsOfBorrow?.toString() ?? null,
      finalizedBlockNumber: state.snapshot.blockNumber,
      finalizedBlockHash: state.snapshot.blockHash
    },
    claims,
    evidence,
    verification: {
      status: verificationStatus,
      verifierVersion: "kumo-venus-noema-verifier-v3",
      checks: [
        {
          id: `${objectId}:check:finalized`,
          type: "FINALIZED_BLOCK_REQUIRED",
          subject: objectId,
          result: finalized ? "PASS" : "FAIL",
          evidenceRefs: [chainEvidenceId],
          ruleVersion: "1",
          timestamp: evaluatedAt,
          reason: finalized ? undefined : `BLOCK_TAG_${state.snapshot.blockTag}`
        },
        {
          id: `${objectId}:check:liquidity-read`,
          type: "VENUS_LIQUIDITY_READ_SUCCESS",
          subject: objectId,
          result: liquidityReadSucceeded ? "PASS" : "FAIL",
          evidenceRefs: [accountEvidenceId],
          ruleVersion: "1",
          timestamp: evaluatedAt,
          reason: liquidityReadSucceeded ? undefined : `VENUS_ERROR_${state.liquidityError.toString()}`
        },
        {
          id: `${objectId}:check:chain`,
          type: "BSC_CHAIN_COHERENCE",
          subject: objectId,
          result: sameChain ? "PASS" : "FAIL",
          evidenceRefs: [chainEvidenceId],
          ruleVersion: "1",
          timestamp: evaluatedAt
        },
        {
          id: `${objectId}:check:effective-risk`,
          type: "VENUS_ACCOUNT_EFFECTIVE_RISK_POLICY_COMPLETE",
          subject: objectId,
          result: effectiveRiskComplete ? "PASS" : "FAIL",
          evidenceRefs: [marketEvidenceId],
          ruleVersion: "1",
          timestamp: evaluatedAt
        },
        {
          id: `${objectId}:check:native-liquidity-reconstruction`,
          type: "VENUS_NATIVE_LIQUIDITY_RECONSTRUCTION_EXACT",
          subject: objectId,
          result: exactNativeLiquidityReconstruction ? "PASS" : "FAIL",
          evidenceRefs: [accountEvidenceId, marketEvidenceId, reconstructionEvidenceId],
          ruleVersion: VENUS_LIQUIDITY_RECONSTRUCTION_RULE,
          timestamp: evaluatedAt,
          reason: exactNativeLiquidityReconstruction
            ? undefined
            : `LIQUIDITY_DELTA_${reconstruction.liquidityDelta.toString()}_SHORTFALL_DELTA_${reconstruction.shortfallDelta.toString()}`
        }
      ]
    },
    status: verificationStatus === "PASS" && freshness === "FRESH"
      ? "RESOLVED"
      : freshness === "STALE"
        ? "STALE"
        : "INSUFFICIENT_EVIDENCE",
    createdAt: evaluatedAt,
    updatedAt: evaluatedAt
  };
}

export function buildVenusHealthMandate(input: {
  principal: string;
  maxEvidenceAgeMs?: number;
}): NoemaAgentMandate {
  return {
    id: `noema-mandate:venus-health:${input.principal}`,
    version: 2,
    principal: input.principal,
    objective: "Assess the current Venus Core lending position from finalized onchain state, account-effective risk policy, and an exact deterministic reconstruction of Venus-native liquidity before any health or rescue decision.",
    economicObjectType: "VENUS_CORE_LENDING_POSITION",
    requiredClaims: [
      { property: "position.state", acceptedStates: ["VERIFIED"] },
      { property: "venus.accountLiquidityMantissa", acceptedStates: ["VERIFIED"] },
      { property: "venus.accountShortfallMantissa", acceptedStates: ["VERIFIED"] },
      { property: "position.liveCollateralMarketCount", acceptedStates: ["VERIFIED"] },
      { property: "position.debtMarketCount", acceptedStates: ["VERIFIED"] },
      { property: "risk.accountEffectivePolicyObserved", acceptedStates: ["VERIFIED"] },
      { property: "venus.nativeLiquidityReconstructionExact", acceptedStates: ["VERIFIED"] },
      { property: "venus.liquidationBufferState", acceptedStates: ["VERIFIED"] }
    ],
    maxEvidenceAgeMs: input.maxEvidenceAgeMs ?? 60_000,
    constraints: {
      chainId: 56,
      protocol: "venus-core",
      finalizedStateRequired: true,
      accountEffectiveRiskPolicyRequired: true,
      exactNativeLiquidityReconstructionRequired: true,
      genericHealthFactorAllowed: false
    }
  };
}

export function buildVenusHealthNoemaAssessment(input: {
  state: VenusCoreAccountState;
  principal: string;
  evaluatedAt: number;
  maxEvidenceAgeMs?: number;
}): NoemaAgentAssessment<VenusLendingPositionEconomicState> {
  const economicObject = buildVenusLendingPositionEconomicObject(input);
  const mandate = buildVenusHealthMandate({ principal: input.principal, maxEvidenceAgeMs: input.maxEvidenceAgeMs });
  const evaluation = evaluateNoemaMandate({ economicObject, mandate, evaluatedAt: input.evaluatedAt });

  return {
    profileVersion: NOEMA_AGENT_PROFILE_VERSION,
    upstreamRef: NOEMA_UPSTREAM_REF,
    economicObject,
    mandate,
    evaluation,
    inferenceProposals: []
  };
}
