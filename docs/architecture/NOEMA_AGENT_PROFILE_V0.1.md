# Noema Agent Profile v0.1 for Kumo

Status: IMPLEMENTED PROFILE — FIRST CONFORMANCE TARGET: KUMO REBALANCER

Upstream semantic reference: `etvjay/Noema@d8a2cc388f1d4b82d1bb71328aa366d8628c3913`

This profile is a deliberately small compatibility layer between Noema's Evidence-Bounded Economic Object model and Kumo's financial-agent runtime.

It is **not** a fork of Noema and does not redefine Noema as a generic agent framework.

## Boundary

```text
Noema profile
= what economic object is being reasoned about,
  which claims are evidence-backed,
  which conclusions are inferred,
  what remains stale/conflicting/unresolved,
  and whether a candidate is inside an evidence-bounded mandate.

Domain strategy
= whether the Rebalancer / Grid Operator / Yield Scout / Health Guard
  actually wants to propose its domain-specific action.

Kumo Financial Agent Kernel
= whether the resulting proposal remains fresh, safe, policy-compliant,
  authorized and executable.
```

Noema does not own execution authority. Kumo does not silently promote AI inference into economic truth.

## Upstream semantics preserved

The profile preserves the current Noema economic-kernel vocabulary for:

- claim states: `UNKNOWN`, `OBSERVED`, `SOURCED`, `ATTESTED`, `VERIFIED`, `INFERRED`, `CONFLICTING`, `STALE`, `REVOKED`;
- evidence types;
- evidence authorities;
- economic-object states;
- verification outcomes: `PASS`, `FAIL`, `UNRESOLVED`;
- mandate decisions: `ALLOW`, `BLOCK`, `CONDITIONAL`.

AI output remains proposal-only. A `NoemaInferenceProposal` cannot silently become a canonical `VERIFIED` claim.

## Minimal profile objects

```text
NoemaAgentEvidenceRef
NoemaAgentClaim
NoemaAgentVerificationCheck
NoemaAgentVerificationSummary
NoemaAgentEconomicObject<TDomainState>
NoemaAgentMandate
NoemaAgentMandateEvaluation
NoemaInferenceProposal
NoemaAgentAssessment<TDomainState>
```

The profile intentionally uses evidence references rather than pretending Kumo already produces the full upstream Noema canonical source snapshots and content hashes. That richer commitment layer can be integrated later without weakening the current truth boundary.

## Anti-collapse invariant

The profile standardizes **epistemics**, not cognition.

It must never introduce one universal `scoreOpportunity()` or one universal financial state machine.

Each core agent keeps a different:

- economic object;
- mandate;
- state machine;
- decision function;
- action vocabulary;
- outcome function.

For the first four Kumo agents:

```text
Rebalancer   → concentrated-liquidity / allocation cognition
Grid Operator → market-making / inventory cognition
Yield Scout  → capital-deployment / opportunity cognition
Health Guard → solvency / rescue cognition
```

## Rebalancer conformance

The first concrete economic object is:

`CONCENTRATED_LIQUIDITY_POSITION`

Direct position/pool state becomes evidence-backed claims. Current tick, range bounds and derived in-range coherence are verified against position/pool evidence. USD valuation and pool-liquidity valuation are sourced market-data claims. Fee-APR, volatility, expected fee improvement, expected IL delta and expected net benefit remain `INFERRED`.

The Rebalancer domain strategy still decides whether a rebalance is economically desirable. The Noema mandate independently checks whether the candidate is sufficiently evidenced and inside the configured capital constraints. Only when both are satisfied can the strategy emit a `propose` disposition.

```text
PancakeSwap state
→ LiquidityPositionEconomicObject
→ claims / evidence / verification
→ Rebalancer domain economics
→ RebalanceMandate evaluation
→ ALLOW + strategy wants action ? StrategyProposal : REFUSE
→ Kumo kernel refresh / quote / veto / authority / execution
```

`ALLOW` here means **economically admissible under the Noema mandate**. It does not mean funds may move.

## Current non-claims

v0.1 does not yet claim:

- full canonical Noema source snapshots;
- upstream Noema object-root/evidence-root compatibility;
- AI model inference in the live Rebalancer path;
- cross-repo package publication;
- Grid/Yield/Health Noema conformance;
- live execution authority;
- beneficial financial outcome.

Those remain separate implementation/evidence milestones.
