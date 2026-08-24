# Kumo Financial Agent Kernel

Status: IMPLEMENTED FOUNDATION — LIVE EXECUTION UNVERIFIED

The Financial Agent Kernel is the shared execution discipline beneath Kumo's reference financial agents.

It exists so Rebalancing, Grid Trading, Yield Optimisation and Health Factor Monitoring do not become four unrelated bots with four incompatible safety models.

## Canonical loop

```text
observe
→ investigate
→ propose / refuse
→ exact executable quote
→ refresh consequential market state
→ security gate
→ policy gate
→ canary when required
→ bounded authority
→ execute
→ receipt
→ later outcome measurement
```

## Modes

Every reference agent must support the same three operational modes.

### `recommend`

Produce evidence and a structured proposal/refusal. No authority is required and no execution occurs.

### `shadow`

Produce the recommendation and executable quote, but do not move value. The result can be retained as a prospective baseline/experiment record.

### `execute`

Execution is possible only after quote freshness, state refresh, security/policy gates, bounded authority and any required canary all pass.

## Core invariants

```text
observation ≠ inference
proposal ≠ authority
quote ≠ execution
transaction receipt ≠ beneficial outcome
registration ≠ liveness
judgment ≠ deterministic financial fact
```

Additional invariants:

1. A strategy may explicitly refuse. Refusal is a valid result, not an error.
2. Consequential market state is refreshed after proposal formation.
3. Material market-root drift blocks the prepared action rather than silently adapting an already-approved proposal.
4. An execution-mode run cannot become ready without bounded authority.
5. A required canary must pass before execution.
6. Security and policy vetoes are terminal for the current prepared action.
7. Outcome measurement happens after execution and may compare against a frozen baseline; a successful transaction does not prove that the strategy was beneficial.
8. The kernel contains no chain-specific strategy logic. Venue/protocol behavior belongs in strategy and provider adapters.

## Shared objects

- `ObservationSnapshot`
- `EvidencePacket`
- `StrategyProposal`
- `ExecutableQuote`
- `ExecutionReadiness`
- `CanaryResult`
- `ExecutionReceipt`
- `OutcomeRecord`

The evidence packet distinguishes observations/source assertions from inferences, assumptions and hypotheses so generated strategy language cannot silently become evidence.

## Strategy interface

Each core agent supplies a `FinancialAgentStrategy` implementation:

```text
observe
investigate
propose
quote
refresh
measure
```

This allows the four reference agents to differ deeply in economics while sharing the same lifecycle, authority boundary and evidence semantics.

## First strategy modules

The intended first modules are:

```text
Kumo Rebalancer
Kumo Grid Operator
Kumo Yield Scout
Kumo Health Guard
```

Each starts with one real BNB venue/protocol and expands only after that first path has end-to-end evidence.

## Evidence status

The package is an implementation foundation. It does not itself prove:

- a live PancakeSwap rebalance;
- a live BSC grid trade;
- a live yield movement;
- a live lending rescue;
- Altana authority;
- ERC-8183 hiring;
- successful canary execution;
- beneficial financial outcomes.

Those claims require separate live receipts and outcome records.
