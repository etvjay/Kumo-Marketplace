export const NOEMA_AGENT_PROFILE_VERSION = "0.1.0" as const;
export const NOEMA_UPSTREAM_REF = "etvjay/Noema@d8a2cc388f1d4b82d1bb71328aa366d8628c3913" as const;

export type Ref = string;
export type UnixMillis = number;
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export const CLAIM_STATES = [
  "UNKNOWN",
  "OBSERVED",
  "SOURCED",
  "ATTESTED",
  "VERIFIED",
  "INFERRED",
  "CONFLICTING",
  "STALE",
  "REVOKED"
] as const;
export type ClaimState = (typeof CLAIM_STATES)[number];

export const EVIDENCE_TYPES = [
  "DOCUMENT",
  "ORACLE",
  "ONCHAIN_STATE",
  "ATTESTATION",
  "API_RESPONSE",
  "FILING",
  "PROOF",
  "OTHER"
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export const EVIDENCE_AUTHORITIES = [
  "PRIMARY_SOURCE",
  "AUTHORIZED_ATTESTOR",
  "ONCHAIN_STATE",
  "INDEPENDENT_ORACLE",
  "REFERENCE_DATA",
  "MARKET_DATA",
  "DERIVED",
  "AI_INFERENCE",
  "DEMO_FIXTURE"
] as const;
export type EvidenceAuthority = (typeof EVIDENCE_AUTHORITIES)[number];

export const ECONOMIC_OBJECT_STATES = [
  "RESOLVED",
  "PARTIALLY_RESOLVED",
  "CONFLICTING",
  "STALE",
  "INSUFFICIENT_EVIDENCE",
  "REVOKED",
  "UNSUPPORTED"
] as const;
export type EconomicObjectState = (typeof ECONOMIC_OBJECT_STATES)[number];

export const VERIFICATION_OUTCOMES = ["PASS", "FAIL", "UNRESOLVED"] as const;
export type VerificationOutcome = (typeof VERIFICATION_OUTCOMES)[number];
export type EvidenceFreshness = "FRESH" | "STALE" | "UNKNOWN";
export type MandateDecision = "ALLOW" | "BLOCK" | "CONDITIONAL";

/**
 * A deliberately small reference to Noema evidence. The full upstream Noema
 * Evidence object additionally commits content hashes and canonical source
 * snapshots. Kumo keeps that richer boundary downstream-compatible without
 * pretending its current agent observations are already canonical Noema data.
 */
export interface NoemaAgentEvidenceRef {
  id: Ref;
  type: EvidenceType;
  source: Ref;
  authority: EvidenceAuthority;
  observedAt: UnixMillis;
  fetchedAt: UnixMillis;
  freshness: EvidenceFreshness;
  locator?: string;
  metadata?: JsonObject;
}

export interface NoemaAgentClaim<T extends JsonValue = JsonValue> {
  id: Ref;
  subject: Ref;
  property: string;
  value: T;
  unit?: string;
  state: ClaimState;
  sourceRefs: Ref[];
  evidenceRefs: Ref[];
  confidence?: number;
  observedAt?: UnixMillis;
  validFrom?: UnixMillis;
  expiresAt?: UnixMillis;
  supersedes?: Ref;
  createdAt: UnixMillis;
}

export interface NoemaAgentVerificationCheck {
  id: Ref;
  type: string;
  subject: Ref;
  result: VerificationOutcome;
  evidenceRefs: Ref[];
  ruleVersion: string;
  timestamp: UnixMillis;
  reason?: string;
}

export interface NoemaAgentVerificationSummary {
  status: VerificationOutcome;
  verifierVersion: string;
  checks: NoemaAgentVerificationCheck[];
}

export interface NoemaAgentEconomicObject<TState = JsonObject> {
  id: Ref;
  version: number;
  objectType: string;
  classification: {
    primary: string;
    secondary: string[];
    confidence: number;
    claimRef: Ref;
  };
  economics: TState;
  claims: NoemaAgentClaim[];
  evidence: NoemaAgentEvidenceRef[];
  verification: NoemaAgentVerificationSummary;
  status: EconomicObjectState;
  createdAt: UnixMillis;
  updatedAt: UnixMillis;
}

export interface NoemaAgentClaimRequirement {
  property: string;
  acceptedStates: ClaimState[];
}

export interface NoemaAgentMandate {
  id: Ref;
  version: number;
  principal: Ref;
  objective: string;
  economicObjectType: string;
  requiredClaims: NoemaAgentClaimRequirement[];
  maxEvidenceAgeMs?: number;
  constraints: JsonObject;
  expiresAt?: UnixMillis;
}

export interface NoemaAgentMandateEvaluation {
  id: Ref;
  objectId: Ref;
  objectVersion: number;
  mandateId: Ref;
  mandateVersion: number;
  decision: MandateDecision;
  reasonCodes: string[];
  supportingClaims: Ref[];
  evidenceRefs: Ref[];
  verificationStatus: VerificationOutcome;
  evaluatedAt: UnixMillis;
}

/**
 * AI is proposal-only at the profile boundary. A proposal is not a canonical
 * claim and cannot silently acquire OBSERVED/SOURCED/VERIFIED state.
 */
export interface NoemaInferenceProposal<T extends JsonValue = JsonValue> {
  id: Ref;
  subject: Ref;
  property: string;
  value: T;
  confidence: number;
  sourceRefs: Ref[];
  evidenceRefs: Ref[];
  explanation?: string;
  createdAt: UnixMillis;
  status: "PROPOSED";
}

export interface NoemaAgentAssessment<TState = JsonObject> {
  profileVersion: typeof NOEMA_AGENT_PROFILE_VERSION;
  upstreamRef: typeof NOEMA_UPSTREAM_REF;
  economicObject: NoemaAgentEconomicObject<TState>;
  mandate: NoemaAgentMandate;
  evaluation: NoemaAgentMandateEvaluation;
  inferenceProposals: NoemaInferenceProposal[];
}

export interface NoemaConformanceIssue {
  code: string;
  severity: "WARNING" | "BLOCKING";
  detail: string;
}

export interface NoemaConformanceResult {
  conformant: boolean;
  issues: NoemaConformanceIssue[];
}

export interface NoemaStandardAgent<TState = JsonObject> {
  getNoemaAssessment(): NoemaAgentAssessment<TState> | undefined;
}
