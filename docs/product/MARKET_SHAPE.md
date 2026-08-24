# Kumo Market Shape

Status: `FROZEN_PRODUCT_DIRECTION`

## Product thesis

Kumo is a broad marketplace for agents. The four BNB hackathon categories are the deepest curated markets inside that broader marketplace, not the entire supply universe.

```text
Kumo Marketplace
├── Core BNB Markets
│   ├── Rebalancing
│   ├── Grid Trading
│   ├── Yield Optimisation
│   └── Health Factor Monitoring
│
├── Other Financial Agents
├── Data / Research Agents
├── Execution Agents
├── Coordination / Negotiation Agents
└── Developer-added agent categories
```

The core BNB markets receive stronger qualification, richer decision data, explicit BSC activation proof, and judge-visible depth.

Other agents remain discoverable, hireable, negotiable and capable of accumulating evidence without pretending to satisfy a core-track qualification contract.

## Supply strategy

Kumo uses three supply lanes:

1. External agents discovered from public registries and ecosystems.
2. Developer-onboarded agents connected through SDK/API/REST/MCP/A2A/Kumo Inbox.
3. Kumo reference agents deployed where external supply is weak or where a deterministic demonstration baseline is required.

Reference agents are not filler. They exist to guarantee at least one production-shape path in each core category and to establish reproducible evidence against which third-party agents can later be compared.

## Interface principle

The product should be explicit rather than feature-heavy.

Primary requester surface:

```text
Discover
→ choose a market
→ compare agents
→ inspect evidence / economics / authority
→ activate
→ observe job
→ verify result
```

Primary agent surface:

```text
Connect agent
→ declare capabilities
→ verify endpoint
→ qualify for one or more markets
→ configure execution / settlement path
→ publish
→ negotiate / receive jobs
→ execute
→ build track record
```

Advanced infrastructure should appear only when needed by the current decision. Bridges, Altana, ERC-8183, ERC-8004, x402, GenLayer and other protocol machinery must not dominate the primary interface.

## Judgment boundary

Deterministic facts are resolved deterministically:

- transaction inclusion / success
- token balances
- received bridge funds
- slippage
- fees
- health factor
- collateral / debt
- APY snapshots
- grid fills
- execution timing

Judgment is an escalation path for questions such as:

- Did the agent satisfy the agreed mandate?
- Did delivered work satisfy qualitative requirements?
- Which conflicting evidence should govern settlement?
- Is a refund justified under agreed terms?
- Which agent is responsible in a cross-agent dispute?

Potential adjudication provider: GenLayer / Internet Court.

```text
execute
→ deterministic verification
→ satisfied? settle
→ disagreement / qualitative ambiguity?
→ open JudgmentCase
→ adjudicate
→ apply bounded consequence
```

Judgment does not replace track data quality, runtime verification, authority enforcement or outcome measurement.

## Structural rule

Every additional feature must answer at least one of:

1. Does it deepen one of the four core tracks?
2. Does it make agent onboarding materially easier?
3. Does it make activation safer or clearer?
4. Does it improve evidence, settlement, recovery or dispute handling?
5. Does it improve the cold evaluator journey?

If not, defer it.
