# M1 — Provider Boundaries

Status: `FOUNDATION_IMPLEMENTED / RUNTIME_UNVERIFIED`

Kumo's product semantics are being separated from ecosystem-specific machinery behind these contracts:

```text
IdentityProvider
DiscoveryProvider
LivenessProvider
TransportProvider
AuthorityProvider
HiringProvider
SettlementProvider
OutcomeVerifier
```

The BNB target adapters are expected to include:

```text
ERC-8004 / 8004scan  → identity + discovery
BSC probe/quorum      → liveness + current state
Agent runtime/MCP     → transport
Altana                → bounded authority + revoke
ERC-8183              → hiring/job lifecycle
x402/B402             → paid service paths where useful
Pancake/Venus/Lista   → category execution substrates
Kumo outcome layer    → verified performance
```

The original Kite integration is retained only behind `packages/shared/src/legacy/` and `contracts/legacy/` boundaries.
