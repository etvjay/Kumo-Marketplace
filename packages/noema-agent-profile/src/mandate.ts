import type {
  ClaimState,
  NoemaAgentEconomicObject,
  NoemaAgentMandate,
  NoemaAgentMandateEvaluation,
  Ref
} from "./types.js";

const HARD_FAILURE_STATES = new Set(["CONFLICTING", "STALE", "REVOKED"] as ClaimState[]);

export function evaluateNoemaMandate(input: {
  economicObject: NoemaAgentEconomicObject<unknown>;
  mandate: NoemaAgentMandate;
  evaluatedAt: number;
}): NoemaAgentMandateEvaluation {
  const { economicObject, mandate, evaluatedAt } = input;
  const reasonCodes: string[] = [];
  const supportingClaims: Ref[] = [];
  const evidenceRefs = new Set<Ref>();
  let decision: NoemaAgentMandateEvaluation["decision"] = "ALLOW";

  if (economicObject.objectType !== mandate.economicObjectType) {
    decision = "BLOCK";
    reasonCodes.push("ECONOMIC_OBJECT_TYPE_MISMATCH");
  }

  if (mandate.expiresAt !== undefined && evaluatedAt >= mandate.expiresAt) {
    decision = "BLOCK";
    reasonCodes.push("MANDATE_EXPIRED");
  }

  if (economicObject.verification.status !== "PASS") {
    decision = "BLOCK";
    reasonCodes.push(`OBJECT_VERIFICATION_${economicObject.verification.status}`);
  }

  if (["CONFLICTING", "STALE", "INSUFFICIENT_EVIDENCE", "REVOKED", "UNSUPPORTED"].includes(economicObject.status)) {
    decision = "BLOCK";
    reasonCodes.push(`OBJECT_${economicObject.status}`);
  }

  for (const requirement of mandate.requiredClaims) {
    const claim = economicObject.claims.find((candidate) => candidate.property === requirement.property);
    if (!claim) {
      decision = "BLOCK";
      reasonCodes.push(`REQUIRED_CLAIM_MISSING:${requirement.property}`);
      continue;
    }

    supportingClaims.push(claim.id);
    for (const ref of claim.evidenceRefs) evidenceRefs.add(ref);

    if (HARD_FAILURE_STATES.has(claim.state)) {
      decision = "BLOCK";
      reasonCodes.push(`REQUIRED_CLAIM_${claim.state}:${requirement.property}`);
      continue;
    }

    if (!requirement.acceptedStates.includes(claim.state)) {
      if (claim.state === "UNKNOWN" || claim.state === "INFERRED") {
        if (decision !== "BLOCK") decision = "CONDITIONAL";
        reasonCodes.push(`REQUIRED_CLAIM_NOT_VERIFIED:${requirement.property}`);
      } else {
        decision = "BLOCK";
        reasonCodes.push(`REQUIRED_CLAIM_STATE_REJECTED:${requirement.property}:${claim.state}`);
      }
    }
  }

  if (mandate.maxEvidenceAgeMs !== undefined) {
    const byId = new Map(economicObject.evidence.map((evidence) => [evidence.id, evidence]));
    for (const evidenceRef of evidenceRefs) {
      const evidence = byId.get(evidenceRef);
      if (!evidence) continue;
      const age = Math.max(0, evaluatedAt - evidence.observedAt);
      if (age > mandate.maxEvidenceAgeMs || evidence.freshness === "STALE") {
        decision = "BLOCK";
        reasonCodes.push(`MANDATE_EVIDENCE_STALE:${evidenceRef}`);
      }
    }
  }

  return {
    id: `noema-eval:${economicObject.id}:v${economicObject.version}:${mandate.id}:v${mandate.version}:${evaluatedAt}`,
    objectId: economicObject.id,
    objectVersion: economicObject.version,
    mandateId: mandate.id,
    mandateVersion: mandate.version,
    decision,
    reasonCodes: [...new Set(reasonCodes)],
    supportingClaims,
    evidenceRefs: [...evidenceRefs],
    verificationStatus: economicObject.verification.status,
    evaluatedAt
  };
}
