import type {
  ChainSnapshot,
  ObservationPurpose,
  StateCoherenceResult,
  StateReadPolicy
} from "./types.js";

export const BSC_CHAIN_ID = 56 as const;

export function defaultBscStateReadPolicy(purpose: ObservationPurpose): StateReadPolicy {
  switch (purpose) {
    case "execution":
      return {
        purpose,
        blockTag: "latest",
        maxAgeMs: 15_000,
        requireSameChain: true,
        requireSameBlock: true,
        requireBlockHash: true
      };
    case "evidence":
    case "outcome":
      return {
        purpose,
        blockTag: "finalized",
        maxAgeMs: 60_000,
        requireSameChain: true,
        requireSameBlock: true,
        requireBlockHash: true
      };
  }
}

export function evaluateStateCoherence(input: {
  snapshots: ChainSnapshot[];
  policy: StateReadPolicy;
  nowMs?: number;
}): StateCoherenceResult {
  const { snapshots, policy } = input;
  const nowMs = input.nowMs ?? Date.now();
  const issues: StateCoherenceResult["issues"] = [];

  if (snapshots.length === 0) {
    return { coherent: false, issues: [{ code: "NO_STATE_SNAPSHOTS", detail: "No chain snapshots supplied" }] };
  }

  const first = snapshots[0]!;
  for (const snapshot of snapshots) {
    if (snapshot.purpose !== policy.purpose) {
      issues.push({
        code: "PURPOSE_MISMATCH",
        detail: `${snapshot.purpose} does not match policy purpose ${policy.purpose}`
      });
    }
    if (snapshot.blockTag !== policy.blockTag) {
      issues.push({
        code: "BLOCK_TAG_MISMATCH",
        detail: `${snapshot.blockTag} does not match required ${policy.blockTag}`
      });
    }
    if (policy.requireSameChain && snapshot.chainId !== first.chainId) {
      issues.push({
        code: "CHAIN_MISMATCH",
        detail: `${snapshot.chainId} does not match ${first.chainId}`
      });
    }
    if (policy.requireSameBlock && snapshot.blockNumber !== first.blockNumber) {
      issues.push({
        code: "BLOCK_NUMBER_MISMATCH",
        detail: `${snapshot.blockNumber} does not match ${first.blockNumber}`
      });
    }
    if (policy.requireSameBlock && snapshot.blockHash !== first.blockHash) {
      issues.push({
        code: "BLOCK_HASH_MISMATCH",
        detail: `${snapshot.blockHash} does not match ${first.blockHash}`
      });
    }
    if (policy.requireBlockHash && !snapshot.blockHash) {
      issues.push({ code: "BLOCK_HASH_REQUIRED", detail: "Snapshot has no block hash" });
    }

    const observedMs = Date.parse(snapshot.observedAt);
    if (!Number.isFinite(observedMs)) {
      issues.push({ code: "INVALID_OBSERVED_AT", detail: snapshot.observedAt });
    } else if (Math.max(0, nowMs - observedMs) > policy.maxAgeMs) {
      issues.push({
        code: "SNAPSHOT_STALE",
        detail: `${snapshot.blockNumber} exceeds ${policy.maxAgeMs}ms age policy`
      });
    }
  }

  return { coherent: issues.length === 0, issues };
}
