import {
  NOEMA_AGENT_PROFILE_VERSION,
  NOEMA_UPSTREAM_REF,
  type NoemaAgentAssessment,
  type NoemaConformanceIssue,
  type NoemaConformanceResult
} from "./types.js";

export function validateNoemaAgentAssessment(
  assessment: NoemaAgentAssessment<unknown>
): NoemaConformanceResult {
  const issues: NoemaConformanceIssue[] = [];
  const object = assessment.economicObject;
  const evidenceIds = new Set(object.evidence.map((evidence) => evidence.id));
  const claimIds = new Set(object.claims.map((claim) => claim.id));

  if (assessment.profileVersion !== NOEMA_AGENT_PROFILE_VERSION) {
    issues.push({
      code: "PROFILE_VERSION_MISMATCH",
      severity: "BLOCKING",
      detail: `Expected ${NOEMA_AGENT_PROFILE_VERSION}, received ${assessment.profileVersion}`
    });
  }

  if (assessment.upstreamRef !== NOEMA_UPSTREAM_REF) {
    issues.push({
      code: "UPSTREAM_REF_MISMATCH",
      severity: "BLOCKING",
      detail: `Expected ${NOEMA_UPSTREAM_REF}, received ${assessment.upstreamRef}`
    });
  }

  for (const claim of object.claims) {
    for (const evidenceRef of claim.evidenceRefs) {
      if (!evidenceIds.has(evidenceRef)) {
        issues.push({
          code: "CLAIM_EVIDENCE_REF_MISSING",
          severity: "BLOCKING",
          detail: `${claim.id} references missing evidence ${evidenceRef}`
        });
      }
    }

    if (claim.state === "VERIFIED" && claim.evidenceRefs.length === 0) {
      issues.push({
        code: "VERIFIED_WITHOUT_EVIDENCE",
        severity: "BLOCKING",
        detail: `${claim.id} is VERIFIED without evidence`
      });
    }

    if (claim.state === "VERIFIED") {
      for (const ref of claim.evidenceRefs) {
        const evidence = object.evidence.find((candidate) => candidate.id === ref);
        if (evidence?.freshness === "STALE") {
          issues.push({
            code: "VERIFIED_FROM_STALE_EVIDENCE",
            severity: "BLOCKING",
            detail: `${claim.id} is VERIFIED from stale evidence ${ref}`
          });
        }
      }
    }
  }

  if (assessment.mandate.id !== assessment.evaluation.mandateId
    || assessment.mandate.version !== assessment.evaluation.mandateVersion) {
    issues.push({
      code: "MANDATE_EVALUATION_MISMATCH",
      severity: "BLOCKING",
      detail: "Mandate evaluation does not bind the supplied mandate version"
    });
  }

  if (object.id !== assessment.evaluation.objectId
    || object.version !== assessment.evaluation.objectVersion) {
    issues.push({
      code: "OBJECT_EVALUATION_MISMATCH",
      severity: "BLOCKING",
      detail: "Mandate evaluation does not bind the supplied economic object version"
    });
  }

  for (const claimRef of assessment.evaluation.supportingClaims) {
    if (!claimIds.has(claimRef)) {
      issues.push({
        code: "SUPPORTING_CLAIM_MISSING",
        severity: "BLOCKING",
        detail: `Evaluation references missing claim ${claimRef}`
      });
    }
  }

  if (assessment.evaluation.decision === "ALLOW" && object.verification.status !== "PASS") {
    issues.push({
      code: "ALLOW_WITHOUT_VERIFICATION_PASS",
      severity: "BLOCKING",
      detail: "Noema mandate cannot ALLOW when economic object verification is not PASS"
    });
  }

  for (const proposal of assessment.inferenceProposals) {
    if (claimIds.has(proposal.id)) {
      issues.push({
        code: "AI_PROPOSAL_COLLIDES_WITH_CANONICAL_CLAIM",
        severity: "BLOCKING",
        detail: `${proposal.id} exists simultaneously as AI proposal and canonical claim`
      });
    }
  }

  return {
    conformant: !issues.some((issue) => issue.severity === "BLOCKING"),
    issues
  };
}

export function assertNoemaAgentAssessment(assessment: NoemaAgentAssessment<unknown>): void {
  const result = validateNoemaAgentAssessment(assessment);
  if (!result.conformant) {
    throw new Error(`NOEMA_CONFORMANCE_FAILED:${result.issues.map((issue) => issue.code).join(",")}`);
  }
}
