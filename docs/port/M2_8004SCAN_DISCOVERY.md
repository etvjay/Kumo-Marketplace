# M2 — ERC-8004 / 8004scan Discovery

Status: `ADAPTER_IMPLEMENTED / LIVE_UNVERIFIED`

Kumo now has an isolated `Eight004ScanProvider` implementing `DiscoveryProvider` and `IdentityProvider`, plus an HTTP liveness probe.

## Verified upstream API surface — 2026-08-24

8004scan documents these public endpoints:

```text
GET /api/v1/public/agents
GET /api/v1/public/agents/search?q=...
GET /api/v1/public/agents/{chainId}/{tokenId}
GET /api/v1/public/accounts/{address}/agents
GET /api/v1/public/feedbacks
GET /api/v1/public/chains
```

Anonymous access is documented at 10 requests/minute; production use should supply an API key and handle rate-limit headers.

## Deliberate boundaries

- Registration is discovery evidence, not liveness evidence.
- The adapter does not infer one of Kumo's four financial categories from marketing text.
- The raw upstream record is retained under `legacy.raw8004scan` until the exact production response schema is pinned by fixture evidence.
- `HttpLivenessProvider` independently probes an advertised HTTP endpoint.
- Reputation/feedback is not yet treated as verified Kumo outcome history.

## Next evidence

1. Capture a real BSC agent response fixture from 8004scan.
2. Verify chain 56 filtering semantics.
3. Probe the discovered endpoint.
4. Bind ERC-8004 identity to endpoint/operator evidence.
5. Only then promote M2 from adapter implementation to live evidence.
