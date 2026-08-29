import { keccak256, toHex, type Hex } from "viem";
import type { MarketDriftResult } from "./interfaces.js";
import {
  validatePreparedActionSimulationReceipt,
  type PreparedActionSimulationReceipt
} from "./simulation.js";
import {
  preparedActionSchema,
  type ExecutableQuote,
  type PreparedAction,
  type PreparedCall,
  type PreparedSpendBound,
  type StrategyProposal
} from "./types.js";

export const PREPARED_ACTION_AUTHORIZATION_COMMITMENT_VERSION = "kumo-prepared-action-authorization-v2" as const;

export interface PreparedActionAuthorizationMaterial {
  proposalId: string;
  quoteId?: string;
  executionChainId: number;
  signer: string;
  expiresAt: string;
  marketSnapshotRoot: string;
  evidenceSnapshotRoot: string;
  atomic: boolean;
  calls: PreparedCall[];
  spendBounds: PreparedSpendBound[];
}

function canonicalCall(call: PreparedCall) {
  return {
    order: call.order,
    kind: call.kind,
    label: call.label,
    to: call.to.toLowerCase(),
    data: call.data.toLowerCase(),
    value: call.value,
    asset: call.asset?.toLowerCase() ?? null,
    amount: call.amount ?? null,
    spender: call.spender?.toLowerCase() ?? null
  };
}

function canonicalSpendBound(bound: PreparedSpendBound) {
  return {
    asset: bound.asset.toLowerCase(),
    maxAmount: bound.maxAmount,
    spender: bound.spender.toLowerCase(),
    purpose: bound.purpose
  };
}

export function computePreparedActionAuthorizationCommitment(
  input: PreparedActionAuthorizationMaterial
): Hex {
  const canonical = JSON.stringify({
    version: PREPARED_ACTION_AUTHORIZATION_COMMITMENT_VERSION,
    proposalId: input.proposalId,
    quoteId: input.quoteId ?? null,
    executionChainId: input.executionChainId,
    signer: input.signer.toLowerCase(),
    expiresAt: input.expiresAt,
    marketSnapshotRoot: input.marketSnapshotRoot,
    evidenceSnapshotRoot: input.evidenceSnapshotRoot,
    atomic: input.atomic,
    calls: input.calls.map(canonicalCall),
    spendBounds: input.spendBounds.map(canonicalSpendBound)
  });
  return keccak256(toHex(canonical));
}

export interface PreparedActionAuthorizationValidationInput {
  action: PreparedAction;
  proposal: StrategyProposal;
  quote?: ExecutableQuote | null;
  marketDrift?: MarketDriftResult;
  simulationReceipt?: PreparedActionSimulationReceipt;
  now: string;
  requireSimulationPassed?: boolean;
}

export interface PreparedActionAuthorizationValidation {
  evaluatedAt: string;
  commitmentValid: boolean;
  eligibleForAuthorization: boolean;
  recomputedAuthorizationCommitment: Hex;
  reasons: string[];
  driftEvidenceRefs: string[];
  simulationEvidenceRefs: string[];
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function approvalMatchesBound(call: PreparedCall, bound: PreparedSpendBound): boolean {
  return call.kind === "approval"
    && call.asset !== undefined
    && call.spender !== undefined
    && call.amount !== undefined
    && sameAddress(call.asset, bound.asset)
    && sameAddress(call.spender, bound.spender)
    && call.amount === bound.maxAmount;
}

export function validatePreparedActionForAuthorization(
  input: PreparedActionAuthorizationValidationInput
): PreparedActionAuthorizationValidation {
  const reasons: string[] = [];
  const parsed = preparedActionSchema.safeParse(input.action);
  if (!parsed.success) reasons.push("PREPARED_ACTION_SCHEMA_INVALID");

  const nowMs = Date.parse(input.now);
  const createdAtMs = Date.parse(input.action.createdAt);
  const expiresAtMs = Date.parse(input.action.expiresAt);
  const proposalExpiresAtMs = Date.parse(input.proposal.expiresAt);
  if (!Number.isFinite(nowMs)) reasons.push("AUTHORIZATION_CLOCK_INVALID");
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(expiresAtMs)) reasons.push("ACTION_TIME_INVALID");
  if (Number.isFinite(createdAtMs) && Number.isFinite(expiresAtMs) && createdAtMs >= expiresAtMs) reasons.push("ACTION_TIME_WINDOW_INVALID");
  if (Number.isFinite(nowMs) && Number.isFinite(expiresAtMs) && nowMs >= expiresAtMs) reasons.push("ACTION_EXPIRED");
  if (Number.isFinite(expiresAtMs) && Number.isFinite(proposalExpiresAtMs) && expiresAtMs > proposalExpiresAtMs) reasons.push("ACTION_EXPIRY_EXCEEDS_PROPOSAL");

  if (input.proposal.disposition !== "propose") reasons.push("STRATEGY_NOT_PROPOSED");
  if (input.action.proposalId !== input.proposal.id) reasons.push("PROPOSAL_ID_MISMATCH");
  if (input.action.marketSnapshotRoot !== input.proposal.marketSnapshotRoot) reasons.push("MARKET_ROOT_MISMATCH");
  if (input.action.evidenceSnapshotRoot !== input.proposal.evidenceSnapshotRoot) reasons.push("EVIDENCE_ROOT_MISMATCH");

  if (input.action.quoteId) {
    if (!input.quote) {
      reasons.push("QUOTE_CONTEXT_REQUIRED");
    } else {
      if (input.quote.id !== input.action.quoteId) reasons.push("QUOTE_ID_MISMATCH");
      if (input.quote.proposalId !== input.proposal.id) reasons.push("QUOTE_PROPOSAL_MISMATCH");
      if (input.quote.chainId !== input.action.executionChainId) reasons.push("QUOTE_CHAIN_MISMATCH");
      if (input.quote.marketSnapshotRoot !== input.action.marketSnapshotRoot) reasons.push("QUOTE_MARKET_ROOT_MISMATCH");
      const quoteExpiryMs = Date.parse(input.quote.expiresAt);
      if (Number.isFinite(quoteExpiryMs) && quoteExpiryMs < expiresAtMs) reasons.push("ACTION_EXPIRY_EXCEEDS_QUOTE");
    }
  } else if (input.quote) {
    reasons.push("UNBOUND_QUOTE_CONTEXT");
  }

  if (!input.action.calls.every((call, index) => call.order === index)) reasons.push("CALL_ORDER_INVALID");

  const positiveApprovals = input.action.calls.filter((call) =>
    call.kind === "approval" && call.amount !== undefined && BigInt(call.amount) > 0n
  );
  for (const bound of input.action.spendBounds) {
    if (BigInt(bound.maxAmount) <= 0n) continue;
    if (!positiveApprovals.some((call) => approvalMatchesBound(call, bound))) {
      reasons.push(`SPEND_BOUND_APPROVAL_MISMATCH:${bound.asset.toLowerCase()}:${bound.spender.toLowerCase()}`);
    }
  }
  for (const approval of positiveApprovals) {
    if (!input.action.spendBounds.some((bound) => approvalMatchesBound(approval, bound))) {
      reasons.push(`UNBOUNDED_POSITIVE_APPROVAL:${approval.asset?.toLowerCase() ?? "unknown"}:${approval.spender?.toLowerCase() ?? "unknown"}`);
    }
  }

  if (input.action.authorizationCommitmentVersion !== PREPARED_ACTION_AUTHORIZATION_COMMITMENT_VERSION) reasons.push("AUTHORIZATION_COMMITMENT_VERSION_MISMATCH");
  const recomputedAuthorizationCommitment = computePreparedActionAuthorizationCommitment(input.action);
  const commitmentValid = recomputedAuthorizationCommitment.toLowerCase() === input.action.authorizationCommitment.toLowerCase();
  if (!commitmentValid) reasons.push("AUTHORIZATION_COMMITMENT_MISMATCH");

  if (input.marketDrift?.drifted) {
    for (const reason of input.marketDrift.reasons) reasons.push(`MARKET_DRIFT:${reason}`);
  }

  const requireSimulationPassed = input.requireSimulationPassed ?? true;
  if (requireSimulationPassed) {
    if (!input.simulationReceipt) {
      reasons.push("SIMULATION_RECEIPT_REQUIRED");
    } else {
      const simulationValidation = validatePreparedActionSimulationReceipt(input.action, input.simulationReceipt);
      for (const reason of simulationValidation.reasons) reasons.push(reason);
    }
    if (input.action.simulationStatus !== "PASSED") reasons.push("SIMULATION_STATUS_NOT_PROMOTED");
  }

  return {
    evaluatedAt: input.now,
    commitmentValid,
    eligibleForAuthorization: reasons.length === 0,
    recomputedAuthorizationCommitment,
    reasons,
    driftEvidenceRefs: input.marketDrift?.evidenceRefs ?? [],
    simulationEvidenceRefs: input.simulationReceipt
      ? [input.simulationReceipt.id, ...input.simulationReceipt.evidenceRefs]
      : []
  };
}
