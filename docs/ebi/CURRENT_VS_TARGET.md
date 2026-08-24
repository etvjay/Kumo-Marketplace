# Kumo Marketplace — Current vs Target Boundary

## Current implementation truth

Current implementation truth is inherited only from the source baseline until code lands here:

- Source repo: `Jaydearcadian/Kumo`
- Branch: `master`
- Commit: `0dd10a040d38f7e06434f09d2b5c5a647e72935f`

Verified source capabilities include:

- two-sided agent marketplace;
- marketplace tasks;
- Execution Pods;
- agent registration/BYOA;
- coordinator and remote executor;
- escrow-first task settlement;
- receipts/proof trail;
- Kumo Explorer;
- SDK/CLI surfaces;
- Kite-oriented identity, transport, settlement, and testnet assumptions.

## BNB target state

The following remain target features until code + runtime evidence exists in this repository:

- BNB marketplace category model: Rebalancing, Grid Trading, Yield Optimisation, Health Factor Monitoring;
- ERC-8004 / 8004scan discovery and identity ingestion;
- live BSC liveness verification;
- category-specific decision-useful data and comparison;
- cheap candidate triage;
- evidence/security gates;
- `PreparedAction` separation;
- activation revalidation / market drift refusal;
- exact bounded `ActivationEnvelope`;
- Altana scoped session authority and revoke;
- ERC-8183 hiring;
- BSC financial execution adapters;
- PancakeSwap economic proof;
- TermiX Agent Advantage instrumentation;
- time-safe verified outcome reputation;
- optional Continuity Graph, Noema, and Nomos differentiation.

## Promotion rule

A target feature does not become current truth because it appears in:

- architecture documents;
- Foundry outputs;
- mock data;
- simulations;
- UI designs;
- demo scripts;
- issue descriptions.

Promotion requires implementation/runtime evidence at the maturity demanded by the relevant EBI gate.

```text
UNVERIFIED
→ SIMULATED_PASS
→ LOCAL_PASS / FORK_PASS
→ TESTNET_PASS
→ LIVE_PASS
→ PUBLIC_EVALUATOR_PASS
```
