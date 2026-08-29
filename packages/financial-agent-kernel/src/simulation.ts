import { z } from "zod";
import { keccak256, toHex, type Hex } from "viem";
import type { PreparedAction } from "./types.js";

const hexDataSchema = z.string().regex(/^0x[0-9a-fA-F]*$/);

export const preparedActionSimulationCallResultSchema = z.object({
  order: z.number().int().nonnegative(),
  passed: z.boolean(),
  transactionHash: hexDataSchema.optional(),
  gasUsed: z.string().regex(/^\d+$/).optional(),
  failureReason: z.string().optional()
});

export const preparedActionSimulationReceiptSchema = z.object({
  schemaVersion: z.literal("kumo-prepared-action-simulation-v1"),
  id: z.string().min(1),
  actionId: z.string().min(1),
  authorizationCommitment: hexDataSchema,
  executionChainId: z.number().int().positive(),
  simulationKind: z.enum(["STATEFUL_FORK", "STRUCTURAL_FIXTURE"]),
  engine: z.string().min(1),
  simulatedAt: z.string().min(1),
  forkBlockNumber: z.string().regex(/^\d+$/),
  forkBlockHash: hexDataSchema.optional(),
  passed: z.boolean(),
  callResults: z.array(preparedActionSimulationCallResultSchema),
  evidenceRefs: z.array(z.string()),
  receiptCommitment: hexDataSchema
});

export type PreparedActionSimulationCallResult = z.infer<typeof preparedActionSimulationCallResultSchema>;

export interface PreparedActionSimulationReceiptMaterial {
  schemaVersion: "kumo-prepared-action-simulation-v1";
  id: string;
  actionId: string;
  authorizationCommitment: string;
  executionChainId: number;
  simulationKind: "STATEFUL_FORK" | "STRUCTURAL_FIXTURE";
  engine: string;
  simulatedAt: string;
  forkBlockNumber: string;
  forkBlockHash?: string;
  passed: boolean;
  callResults: PreparedActionSimulationCallResult[];
  evidenceRefs: string[];
}

export type PreparedActionSimulationReceipt = z.infer<typeof preparedActionSimulationReceiptSchema>;

function canonicalCallResult(result: PreparedActionSimulationCallResult) {
  return {
    order: result.order,
    passed: result.passed,
    transactionHash: result.transactionHash?.toLowerCase() ?? null,
    gasUsed: result.gasUsed ?? null,
    failureReason: result.failureReason ?? null
  };
}

export function computePreparedActionSimulationReceiptCommitment(
  input: PreparedActionSimulationReceiptMaterial
): Hex {
  return keccak256(toHex(JSON.stringify({
    schemaVersion: input.schemaVersion,
    id: input.id,
    actionId: input.actionId,
    authorizationCommitment: input.authorizationCommitment.toLowerCase(),
    executionChainId: input.executionChainId,
    simulationKind: input.simulationKind,
    engine: input.engine,
    simulatedAt: input.simulatedAt,
    forkBlockNumber: input.forkBlockNumber,
    forkBlockHash: input.forkBlockHash?.toLowerCase() ?? null,
    passed: input.passed,
    callResults: input.callResults.map(canonicalCallResult),
    evidenceRefs: [...input.evidenceRefs]
  })));
}

export function sealPreparedActionSimulationReceipt(
  input: PreparedActionSimulationReceiptMaterial
): PreparedActionSimulationReceipt {
  return preparedActionSimulationReceiptSchema.parse({
    ...input,
    receiptCommitment: computePreparedActionSimulationReceiptCommitment(input)
  });
}

export interface SimulationReceiptBindingValidation {
  valid: boolean;
  reasons: string[];
  recomputedReceiptCommitment: Hex;
}

export function validatePreparedActionSimulationReceipt(
  action: PreparedAction,
  receipt: PreparedActionSimulationReceipt
): SimulationReceiptBindingValidation {
  const reasons: string[] = [];
  const parsed = preparedActionSimulationReceiptSchema.safeParse(receipt);
  if (!parsed.success) {
    return {
      valid: false,
      reasons: ["SIMULATION_RECEIPT_SCHEMA_INVALID"],
      recomputedReceiptCommitment: "0x" as Hex
    };
  }

  const recomputedReceiptCommitment = computePreparedActionSimulationReceiptCommitment(receipt);
  if (recomputedReceiptCommitment.toLowerCase() !== receipt.receiptCommitment.toLowerCase()) {
    reasons.push("SIMULATION_RECEIPT_COMMITMENT_MISMATCH");
  }
  if (receipt.schemaVersion !== "kumo-prepared-action-simulation-v1") {
    reasons.push("SIMULATION_RECEIPT_SCHEMA_MISMATCH");
  }
  if (receipt.actionId !== action.id) reasons.push("SIMULATION_ACTION_ID_MISMATCH");
  if (receipt.authorizationCommitment.toLowerCase() !== action.authorizationCommitment.toLowerCase()) {
    reasons.push("SIMULATION_AUTHORIZATION_COMMITMENT_MISMATCH");
  }
  if (receipt.executionChainId !== action.executionChainId) reasons.push("SIMULATION_CHAIN_MISMATCH");
  if (receipt.simulationKind !== "STATEFUL_FORK") reasons.push("STATEFUL_FORK_SIMULATION_REQUIRED");

  const simulatedAtMs = Date.parse(receipt.simulatedAt);
  const actionCreatedAtMs = Date.parse(action.createdAt);
  const actionExpiresAtMs = Date.parse(action.expiresAt);
  if (!Number.isFinite(simulatedAtMs)) reasons.push("SIMULATION_TIME_INVALID");
  if (Number.isFinite(simulatedAtMs) && Number.isFinite(actionCreatedAtMs) && simulatedAtMs < actionCreatedAtMs) {
    reasons.push("SIMULATION_PREDATES_ACTION");
  }
  if (Number.isFinite(simulatedAtMs) && Number.isFinite(actionExpiresAtMs) && simulatedAtMs >= actionExpiresAtMs) {
    reasons.push("SIMULATION_AFTER_ACTION_EXPIRY");
  }
  if (!/^\d+$/.test(receipt.forkBlockNumber)) reasons.push("SIMULATION_FORK_BLOCK_INVALID");

  if (receipt.callResults.length !== action.calls.length) reasons.push("SIMULATION_CALL_COUNT_MISMATCH");
  for (let index = 0; index < receipt.callResults.length; index += 1) {
    const result = receipt.callResults[index];
    if (!result || result.order !== index) reasons.push(`SIMULATION_CALL_ORDER_MISMATCH:${index}`);
  }
  if (receipt.passed && receipt.callResults.some((result) => !result.passed)) {
    reasons.push("SIMULATION_PASS_WITH_FAILED_CALL");
  }
  if (!receipt.passed) reasons.push("SIMULATION_FAILED");

  return {
    valid: reasons.length === 0,
    reasons,
    recomputedReceiptCommitment
  };
}

export function applyPreparedActionSimulationReceipt(
  action: PreparedAction,
  receipt: PreparedActionSimulationReceipt
): PreparedAction {
  const validation = validatePreparedActionSimulationReceipt(action, receipt);
  if (!validation.valid) {
    throw new Error(`SIMULATION_RECEIPT_INVALID:${validation.reasons.join(",")}`);
  }
  return {
    ...action,
    simulationStatus: "PASSED",
    evidenceRefs: [...new Set([...action.evidenceRefs, receipt.id, ...receipt.evidenceRefs])]
  };
}
