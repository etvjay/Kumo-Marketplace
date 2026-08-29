import {
  validatePreparedActionForAuthorization,
  type ExecutableQuote,
  type MarketDriftResult,
  type PreparedAction,
  type PreparedSpendBound,
  type StrategyProposal
} from "@kumo/financial-agent-kernel";

export const ALTANA_SDK_PROFILE = {
  package: "@altananetwork/sdk",
  version: "0.8.0",
  upstreamRef: "altananetwork/altana-sdk@3feff446abd2611548b603e080224128079add8d"
} as const;

export interface AltanaCallPermission {
  to: string;
}

export interface AltanaSpendPermission {
  token: string;
  limit: bigint;
  period: "minute";
}

export interface AltanaSessionBlueprint {
  schemaVersion: "kumo-altana-session-blueprint-v1";
  walletAddress: string;
  authorizationCommitment: string;
  authorizationCommitmentVersion: string;
  expiry: number;
  register: true;
  permissions: {
    calls: AltanaCallPermission[];
    spend: AltanaSpendPermission[];
  };
  scopeStrength: "TARGET_ALLOWLIST_PLUS_TOKEN_SPEND_CAPS";
  sourceActionId: string;
  sourceProposalId: string;
  sourceQuoteId?: string;
  limitations: string[];
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function aggregateSpend(bounds: PreparedSpendBound[]): AltanaSpendPermission[] {
  const totals = new Map<string, { token: string; total: bigint }>();
  for (const bound of bounds) {
    const key = bound.asset.toLowerCase();
    const current = totals.get(key) ?? { token: bound.asset, total: 0n };
    current.total += BigInt(bound.maxAmount);
    totals.set(key, current);
  }
  return [...totals.values()]
    .filter((entry) => entry.total > 0n)
    .sort((a, b) => a.token.toLowerCase().localeCompare(b.token.toLowerCase()))
    .map((entry) => ({ token: entry.token, limit: entry.total, period: "minute" as const }));
}

function uniqueCallTargets(action: PreparedAction): AltanaCallPermission[] {
  const seen = new Map<string, string>();
  for (const call of action.calls) {
    const key = call.to.toLowerCase();
    if (!seen.has(key)) seen.set(key, call.to);
  }
  return [...seen.values()]
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map((to) => ({ to }));
}

/**
 * Translate a Kumo PreparedAction into an Altana session request profile.
 *
 * The Kumo action remains authoritative. Altana is the enforcement/transport
 * layer. This function refuses to produce a grant profile unless the action is
 * already authorization-eligible and the action signer is the Altana wallet.
 */
export function buildAltanaSessionBlueprint(input: {
  action: PreparedAction;
  proposal: StrategyProposal;
  quote?: ExecutableQuote | null;
  marketDrift?: MarketDriftResult;
  now: string;
  altanaWalletAddress: string;
}): AltanaSessionBlueprint {
  if (!sameAddress(input.action.signer, input.altanaWalletAddress)) {
    throw new Error("ALTANA_WALLET_DOES_NOT_OWN_PREPARED_ACTION");
  }
  if (input.action.executionChainId !== 56) {
    throw new Error("ALTANA_BNB_EXECUTION_CHAIN_REQUIRED");
  }

  const validation = validatePreparedActionForAuthorization({
    action: input.action,
    proposal: input.proposal,
    quote: input.quote,
    marketDrift: input.marketDrift,
    now: input.now,
    requireSimulationPassed: true
  });
  if (!validation.eligibleForAuthorization) {
    throw new Error(`PREPARED_ACTION_NOT_AUTHORIZATION_ELIGIBLE:${validation.reasons.join(",")}`);
  }

  const expiryMs = Date.parse(input.action.expiresAt);
  if (!Number.isFinite(expiryMs)) throw new Error("ALTANA_ACTION_EXPIRY_INVALID");
  const expiry = Math.floor(expiryMs / 1000);
  if (expiry <= Math.floor(Date.parse(input.now) / 1000)) throw new Error("ALTANA_ACTION_ALREADY_EXPIRED");

  const calls = uniqueCallTargets(input.action);
  if (calls.length === 0) throw new Error("ALTANA_CALL_ALLOWLIST_EMPTY");

  return {
    schemaVersion: "kumo-altana-session-blueprint-v1",
    walletAddress: input.altanaWalletAddress,
    authorizationCommitment: input.action.authorizationCommitment,
    authorizationCommitmentVersion: input.action.authorizationCommitmentVersion,
    expiry,
    register: true,
    permissions: {
      calls,
      spend: aggregateSpend(input.action.spendBounds)
    },
    scopeStrength: "TARGET_ALLOWLIST_PLUS_TOKEN_SPEND_CAPS",
    sourceActionId: input.action.id,
    sourceProposalId: input.action.proposalId,
    ...(input.action.quoteId ? { sourceQuoteId: input.action.quoteId } : {}),
    limitations: [
      "This blueprint does not grant a session; it is deterministic input for Altana grantSession.",
      "Altana call permissions are target-level in this profile. Exact calldata remains bound by Kumo's authorization commitment but is not yet method-selector-enforced by the session profile.",
      "Token spend caps conservatively sum Kumo spend bounds per token over Altana's minimum rolling period of one minute.",
      "The session must be KeyStore-registered; register=false is not permitted for hackathon evidence.",
      "The Altana wallet must own or control the consequential assets referenced by the PreparedAction before live execution."
    ]
  };
}

export interface AltanaGrantSessionPort {
  grantSession(input: {
    walletAddress: string;
    permissions: AltanaSessionBlueprint["permissions"];
    expiry: number;
    register: true;
    authorizationCommitment: string;
  }): Promise<{
    walletAddress: string;
    publicKey: string;
    expiry: number;
    transactionHash?: string;
    authorityRef: string;
  }>;
}

export interface AltanaAuthorityReceipt {
  provider: "ALTANA";
  providerProfile: typeof ALTANA_SDK_PROFILE;
  walletAddress: string;
  sessionPublicKey: string;
  expiry: number;
  authorizationCommitment: string;
  grantTransactionHash?: string;
  authorityRef: string;
  registeredInKeyStore: true;
}

export async function grantAltanaAuthority(input: {
  blueprint: AltanaSessionBlueprint;
  port: AltanaGrantSessionPort;
}): Promise<AltanaAuthorityReceipt> {
  const grant = await input.port.grantSession({
    walletAddress: input.blueprint.walletAddress,
    permissions: input.blueprint.permissions,
    expiry: input.blueprint.expiry,
    register: true,
    authorizationCommitment: input.blueprint.authorizationCommitment
  });
  if (!sameAddress(grant.walletAddress, input.blueprint.walletAddress)) {
    throw new Error("ALTANA_GRANTED_WALLET_MISMATCH");
  }
  if (grant.expiry !== input.blueprint.expiry) throw new Error("ALTANA_GRANTED_EXPIRY_MISMATCH");
  if (!grant.publicKey) throw new Error("ALTANA_SESSION_PUBLIC_KEY_REQUIRED");
  if (!grant.authorityRef) throw new Error("ALTANA_AUTHORITY_REF_REQUIRED");

  return {
    provider: "ALTANA",
    providerProfile: ALTANA_SDK_PROFILE,
    walletAddress: grant.walletAddress,
    sessionPublicKey: grant.publicKey,
    expiry: grant.expiry,
    authorizationCommitment: input.blueprint.authorizationCommitment,
    ...(grant.transactionHash ? { grantTransactionHash: grant.transactionHash } : {}),
    authorityRef: grant.authorityRef,
    registeredInKeyStore: true
  };
}
