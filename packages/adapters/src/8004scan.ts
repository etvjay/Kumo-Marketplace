import type {
  AgentIdentity,
  AgentProfile,
  DiscoveryProvider,
  IdentityProvider,
  ProviderEvidence
} from "@kumo/shared";

const DEFAULT_BASE_URL = "https://8004scan.io/api/v1/public";

export interface Eight004ScanOptions {
  baseUrl?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function number(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return undefined;
}

function firstArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const root = asRecord(payload);
  if (!root) return [];
  for (const key of ["agents", "items", "data", "results"]) {
    const candidate = root[key];
    if (Array.isArray(candidate)) return candidate;
    const nested = asRecord(candidate);
    if (nested) {
      for (const nestedKey of ["agents", "items", "results"]) {
        if (Array.isArray(nested[nestedKey])) return nested[nestedKey] as unknown[];
      }
    }
  }
  return [];
}

function serviceEndpoint(record: JsonRecord): string | undefined {
  const direct = text(record.endpoint) ?? text(record.endpointUrl) ?? text(record.url);
  if (direct) return direct;
  const services = record.services;
  if (Array.isArray(services)) {
    for (const value of services) {
      const service = asRecord(value);
      const endpoint = service && (text(service.endpoint) ?? text(service.url));
      if (endpoint?.startsWith("http://") || endpoint?.startsWith("https://")) return endpoint;
    }
  }

  // Older registry payloads may expose endpoints rather than services. Preserve
  // compatibility without inferring a transport/capability from the URL alone.
  const endpoints = record.endpoints;
  if (Array.isArray(endpoints)) {
    for (const value of endpoints) {
      if (typeof value === "string" && (value.startsWith("http://") || value.startsWith("https://"))) {
        return value;
      }
      const endpointRecord = asRecord(value);
      const endpoint = endpointRecord && (text(endpointRecord.endpoint) ?? text(endpointRecord.url));
      if (endpoint?.startsWith("http://") || endpoint?.startsWith("https://")) return endpoint;
    }
  }
  return undefined;
}

function normalizeAgent(raw: unknown): AgentProfile | undefined {
  const record = asRecord(raw);
  if (!record) return undefined;
  const tokenId = number(record.tokenId) ?? number(record.token_id) ?? number(record.agentId) ?? number(record.agent_id) ?? number(record.id);
  const chainId = number(record.chainId) ?? number(record.chain_id) ?? number(asRecord(record.chain)?.id);
  const registry = text(record.registry) ?? text(record.agentRegistry) ?? text(record.agent_registry) ?? text(record.registryAddress) ?? text(record.registry_address);
  const owner = text(record.owner) ?? text(record.ownerAddress) ?? text(record.owner_address);
  const metadata = asRecord(record.metadata);
  const name = text(record.name) ?? text(metadata?.name) ?? (tokenId !== undefined ? `Agent ${tokenId}` : undefined);
  if (!name || tokenId === undefined) return undefined;

  const identity: AgentIdentity = {
    scheme: "erc-8004",
    id: String(tokenId),
    owner,
    chainId,
    registry
  };

  const endpointUrl = serviceEndpoint(record) ?? serviceEndpoint(metadata ?? {});
  const description = text(record.description) ?? text(metadata?.description) ?? "ERC-8004 registered agent";

  return {
    id: chainId !== undefined ? `erc8004:${chainId}:${tokenId}` : `erc8004:${tokenId}`,
    name,
    source: "8004scan",
    status: "unknown",
    description,
    categories: [],

    // Registry chain is evidence of identity origin, not proof that the agent
    // can execute financial work on that chain or any other chain.
    originChainIds: chainId !== undefined ? [chainId] : [],
    executionVenues: [],
    supportedChains: chainId !== undefined ? [chainId] : [],

    capabilities: [],
    endpointUrl,
    connectionSurfaces: [],
    supportedTransports: [],
    identities: [identity],
    legacy: { raw8004scan: record }
  };
}

export class Eight004ScanProvider implements DiscoveryProvider, IdentityProvider {
  readonly id = "8004scan";
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: Eight004ScanOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request(path: string): Promise<{ payload: unknown; evidence: ProviderEvidence[] }> {
    const url = `${this.baseUrl}${path}`;
    const observedAt = new Date().toISOString();
    const headers: Record<string, string> = { accept: "application/json" };
    if (this.apiKey) headers["X-API-Key"] = this.apiKey;
    const response = await this.fetchImpl(url, { headers });
    if (!response.ok) throw new Error(`8004scan ${response.status} for ${path}`);
    return {
      payload: await response.json(),
      evidence: [{ observedAt, source: url, environment: "mainnet" }]
    };
  }

  async discover(input: { category?: string; chainId?: number; limit?: number }) {
    const params = new URLSearchParams();
    if (input.chainId !== undefined) params.set("chainId", String(input.chainId));
    if (input.limit !== undefined) params.set("limit", String(input.limit));
    const suffix = params.size > 0 ? `?${params}` : "";
    const { payload, evidence } = await this.request(`/agents${suffix}`);
    const agents = firstArray(payload).map(normalizeAgent).filter((agent): agent is AgentProfile => Boolean(agent));
    return { agents, evidence };
  }

  async resolve(agentRef: string) {
    const match = agentRef.match(/^(?:erc8004:)?(\d+):(\d+)$/);
    if (!match) throw new Error("agentRef must be <chainId>:<tokenId> or erc8004:<chainId>:<tokenId>");
    const [, chainId, tokenId] = match;
    const { payload, evidence } = await this.request(`/agents/${chainId}/${tokenId}`);
    const root = asRecord(payload);
    const data = asRecord(root?.data);
    const raw = root?.agent ?? data?.agent ?? root?.data ?? payload;
    const agent = normalizeAgent(raw);
    if (!agent) throw new Error(`8004scan returned an unrecognized agent shape for ${agentRef}`);
    return { agent, evidence };
  }
}
