import type { AgentProfile, LivenessProvider, ProviderEvidence } from "@kumo/shared";

export interface HttpLivenessOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class HttpLivenessProvider implements LivenessProvider {
  readonly id = "http-liveness";
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpLivenessOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async probe(agent: AgentProfile) {
    const endpoint = agent.endpointUrl;
    const checkedAt = new Date().toISOString();
    if (!endpoint) {
      return {
        live: false,
        checkedAt,
        detail: "Agent has no probeable endpoint URL",
        evidence: [] as ProviderEvidence[]
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const started = Date.now();
    try {
      const response = await this.fetchImpl(endpoint, {
        method: "HEAD",
        signal: controller.signal,
        redirect: "follow"
      });
      const latencyMs = Date.now() - started;
      return {
        live: response.ok || response.status === 405,
        checkedAt,
        latencyMs,
        detail: `HTTP ${response.status}`,
        evidence: [{
          observedAt: checkedAt,
          source: endpoint,
          environment: "mainnet" as const,
          chainId: agent.supportedChains[0]
        }]
      };
    } catch (error) {
      return {
        live: false,
        checkedAt,
        latencyMs: Date.now() - started,
        detail: error instanceof Error ? error.message : "probe failed",
        evidence: [{
          observedAt: checkedAt,
          source: endpoint,
          environment: "mainnet" as const,
          chainId: agent.supportedChains[0]
        }]
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
