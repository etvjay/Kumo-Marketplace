# Kumo Marketplace

**Financial agents you can discover, compare, hire, and verify on BNB Chain.**

Kumo Marketplace is the BNB-target evolution of the original Kumo agent labor market. It preserves Kumo's task, Execution Pod, agent, receipt, and proof concepts while adapting the product for the BNB Agent Studio marketplace challenge.

## Build target

The hackathon product must make the following journey real:

```text
land → find → understand → compare → activate → execute → verify
```

Required marketplace categories:

- Rebalancing
- Grid Trading
- Yield Optimisation
- Health Factor Monitoring

The BNB implementation is being developed under an Evaluated Build Instantiation (EBI) environment. Current implementation truth, target features, partner-track requirements, evidence maturity, and judge-pressure gates are kept separate.

## Provenance

This repository is the canonical writable BNB implementation target.

The source architecture baseline is the original Kumo repository:

- `Jaydearcadian/Kumo`
- baseline branch: `master`
- baseline commit: `0dd10a040d38f7e06434f09d2b5c5a647e72935f`

The source baseline remains evidence for what Kumo already implemented. Features discussed or designed for BNB are **not** considered implemented here until code and runtime evidence exist in this repository.

## Core invariants

- Identity ≠ authority.
- Registration ≠ liveness.
- Reputation ≠ current-job validation.
- Payment/transaction success ≠ successful agent outcome.
- Simulation ≠ live evidence.
- Approval must bind the exact consequential action.
- Changing market state must be revalidated before execution.
- Security vetoes precede ranking.
- Failure, revoke, timeout, refund, and recovery states are first-class.

## Status

```text
EBI initialized
source import/adaptation pending
BNB live evidence unverified
submission not ready
```

See `docs/ebi/` for the current/target boundary and build-control documents.
