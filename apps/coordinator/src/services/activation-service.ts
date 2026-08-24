import type { ActivationEnvelope, PreparedAction } from "@kumo/shared";

export interface ActivationRevalidationInput {
  prepared: PreparedAction;
  now: string;
  currentMarketSnapshotRoot: string;
  currentEvidenceSnapshotRoot: string;
}

export type RevalidationResult =
  | { ok: true }
  | { ok: false; code: "PREPARED_ACTION_EXPIRED" | "MARKET_DRIFT" | "EVIDENCE_DRIFT" };

/**
 * Minimal deterministic drift gate. Later category adapters may define bounded
 * numerical drift policies, but changing roots already forces explicit
 * re-preparation instead of silently executing against a new world state.
 */
export function revalidatePreparedAction(input: ActivationRevalidationInput): RevalidationResult {
  if (Date.parse(input.now) >= Date.parse(input.prepared.expiresAt)) {
    return { ok: false, code: "PREPARED_ACTION_EXPIRED" };
  }
  if (input.currentMarketSnapshotRoot !== input.prepared.marketSnapshotRoot) {
    return { ok: false, code: "MARKET_DRIFT" };
  }
  if (input.currentEvidenceSnapshotRoot !== input.prepared.evidenceSnapshotRoot) {
    return { ok: false, code: "EVIDENCE_DRIFT" };
  }
  return { ok: true };
}

export function assertEnvelopeMatchesPrepared(prepared: PreparedAction, envelope: ActivationEnvelope): void {
  if (prepared.taskId !== envelope.taskId) throw new Error("ACTIVATION_TASK_MISMATCH");
  if (prepared.agentId !== envelope.agentId) throw new Error("ACTIVATION_AGENT_MISMATCH");
  if (prepared.inputRoot !== envelope.inputRoot) throw new Error("ACTIVATION_INPUT_MISMATCH");
  if (prepared.marketSnapshotRoot !== envelope.marketSnapshotRoot) throw new Error("ACTIVATION_MARKET_MISMATCH");
  if (prepared.evidenceSnapshotRoot !== envelope.evidenceSnapshotRoot) throw new Error("ACTIVATION_EVIDENCE_MISMATCH");
  if (prepared.policyFingerprint !== envelope.policyFingerprint) throw new Error("ACTIVATION_POLICY_MISMATCH");
}
