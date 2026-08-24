import type { TaskStatus } from "@kumo/shared";

export type PodStatus = "created" | "assigned" | "quoted" | "executing" | "completed" | "failed" | "cancelled";

// Adapted from Jaydearcadian/Kumo@0dd10a0. The BNB port adds explicit
// prepared/approved states so preparation and user authority remain distinct
// from execution.
const ALLOWED_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  draft: ["posted", "cancelled"],
  posted: ["claimed", "prepared", "cancelled"],
  claimed: ["prepared", "failed", "cancelled"],
  prepared: ["approved", "posted", "failed", "cancelled"],
  approved: ["executing", "failed", "cancelled"],
  executing: ["succeeded", "failed", "cancelled"],
  succeeded: ["settled", "refunded"],
  failed: ["refunded", "cancelled", "prepared"],
  settled: [],
  refunded: [],
  cancelled: []
};

export function canTransition(from: string, to: string): boolean {
  if (from === to) return true;
  const allowed = ALLOWED_TRANSITIONS[from as TaskStatus];
  return Boolean(allowed?.includes(to as TaskStatus));
}

export function assertTransition(from: string, to: string): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid task transition: ${from} → ${to}`);
  }
}

const ALLOWED_POD_TRANSITIONS: Record<PodStatus, PodStatus[]> = {
  created: ["assigned", "cancelled", "failed"],
  assigned: ["quoted", "executing", "cancelled", "failed"],
  quoted: ["executing", "cancelled", "failed"],
  executing: ["completed", "failed", "cancelled"],
  completed: [],
  failed: ["assigned", "cancelled"],
  cancelled: []
};

export function canPodTransition(from: string, to: string): boolean {
  if (from === to) return true;
  const allowed = ALLOWED_POD_TRANSITIONS[from as PodStatus];
  return Boolean(allowed?.includes(to as PodStatus));
}

export function assertPodTransition(from: string, to: string): void {
  if (!canPodTransition(from, to)) {
    throw new Error(`Invalid pod transition: ${from} → ${to}`);
  }
}
