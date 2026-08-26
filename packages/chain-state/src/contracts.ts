import type {
  ContractIdentityExpectation,
  ContractIdentityObservation,
  ContractIdentityResult
} from "./types.js";

function normalizeAddress(value: string): string {
  return value.toLowerCase();
}

export function evaluateContractIdentity(input: {
  expected: ContractIdentityExpectation;
  observed: ContractIdentityObservation;
}): ContractIdentityResult {
  const reasons: string[] = [];

  if (input.observed.chainId !== input.expected.chainId) reasons.push("CHAIN_ID_MISMATCH");
  if (normalizeAddress(input.observed.address) !== normalizeAddress(input.expected.address)) {
    reasons.push("CONTRACT_ADDRESS_MISMATCH");
  }
  if (!input.observed.bytecodePresent) reasons.push("CONTRACT_BYTECODE_MISSING");
  if (input.expected.expectedCodeHash !== undefined) {
    if (!input.observed.observedCodeHash) reasons.push("CONTRACT_CODE_HASH_MISSING");
    else if (input.observed.observedCodeHash.toLowerCase() !== input.expected.expectedCodeHash.toLowerCase()) {
      reasons.push("CONTRACT_CODE_HASH_MISMATCH");
    }
  }

  return { valid: reasons.length === 0, reasons };
}
