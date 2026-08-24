# Kumo Core Agent Capability Harvest

Date: 2026-08-24
Status: ACTIVE IMPLEMENTATION INPUT

## Goal

Deploy rich reference agents for the four BNB Smart Money core markets without building four unrelated bots or importing whole prior projects.

Core markets:

- Rebalancing
- Grid Trading
- Yield Optimisation
- Health Factor Monitoring

The marketplace remains open to other agents. These four receive the deepest qualification, comparison, activation and outcome surfaces because they are the hackathon's required categories.

## Governing design decision

Build one shared `Kumo Financial Agent Kernel` and four strategy modules.

```text
observe
→ cheap triage
→ evidence packet
→ strategy decision
→ refresh / drift gate
→ exact executable quote
→ policy / security veto
→ canary or simulation
→ bounded authorization
→ execute
→ receipt
→ outcome measurement
→ optional judgment / recovery
→ later execution memory
```

The kernel owns execution discipline. Strategy modules own market-specific logic.

---

# Repository harvest

## Jaydearcadian/zo-market-maker-ts

Use for: **Grid Operator**

Directly useful mechanics:

- external fair-price feed + venue price comparison;
- symmetric spread quoting around fair value;
- position tracking;
- inventory-triggered close mode;
- tighter exit spread when inventory exceeds a threshold;
- warmup period before quoting;
- quote update throttling;
- independent order and position synchronization loops;
- market monitor surface.

Do not port venue-specific 01 Exchange/Solana code as the BNB implementation. Extract the strategy mechanics behind a venue adapter.

## Jaydearcadian/Bifrost

Use for: **all four agents, especially Rebalancer and Health Guard**

Directly useful mechanics:

```text
quote → policy → canary → verify → execute
```

- deterministic policy checks;
- canary-first execution;
- sandbox/simulation before consequential value movement;
- route validation;
- proof/receipt lifecycle.

This becomes the shared execution safety sequence.

## Jaydearcadian/STN-Delta

Use for: **cross-chain liquidity ingress for every agent**

Directly useful mechanics:

- real-time RFQ route abstraction;
- source-chain liquidity → destination-chain settlement;
- signed intent payloads;
- HTLC/atomic-swap mental model;
- residual/delta routing;
- simulation/live mode separation.

Kumo should generalize the routing model, not copy TON/Omniston-specific code.

## Jaydearcadian/mcosm-openrails

Use for: **commercial/job lifecycle and settlement discipline**

Directly useful lifecycle:

```text
workspace/context
→ authority
→ terms
→ proof
→ payment
→ receipt
```

Useful objects:

- participant/agent;
- bounded Path/capability;
- Intent and Proposal;
- accepted Pact;
- Proof;
- Payment;
- Receipt;
- exception/recovery case.

Useful product lesson: SDK, REST and MCP should expose the same stable nouns instead of separate mental models.

## Jaydearcadian/routedock

Use for: **one-click agent/provider integration and payment-mode routing**

Directly useful mechanics:

- one SDK call chooses among compatible payment/settlement modes;
- provider manifest discovery instead of hard-coded endpoint logic;
- capability search by manifest;
- session expiry;
- endpoint allowlists;
- spend caps;
- monotonic/replay-safe session accounting;
- explicit dispute/refund state;
- reference agent consuming paid streaming orderbook data.

Kumo equivalent should select connection/payment/execution mode from an agent manifest while keeping authority independent.

## Jaydearcadian/arc-policy-envelope

Use for: **all execution agents**

Directly useful mechanics:

- max-per-action limit;
- period cap;
- actor allowlist;
- venue/recipient allowlist;
- schedule window;
- deterministic policy hash;
- request hash;
- approval/denial hash;
- explicit separation of `agent decided` from `money may move`.

This maps cleanly into `ActivationEnvelope` + Altana scoped authority.

## Jaydearcadian/competitionos

Use for: **agent vaults, scoring/evaluation and operator controls**

Directly useful mechanics:

- operator key distinct from agent key;
- per-action/stake cap;
- daily cap;
- max concurrent/open positions;
- approved resolvers/assets;
- operator pause and key rotation;
- content-addressed resolution evidence;
- low-confidence results flagged rather than force-settled;
- SDK + MCP + REST agent onboarding.

Do not import competition semantics. Reuse the bounded-agent-vault and independently verifiable resolver patterns.

## Jaydearcadian/autonomous-response-sys-experiment

Use for: **Health Guard and external-risk monitoring**

Directly useful mechanics:

- direct web observation;
- structured AI extraction;
- comparative-equivalence tolerance;
- threshold detection;
- explicit measured reliability by data type;
- monitor → coordinate → execute decomposition;
- exploit/status/price monitoring concepts.

Critical boundary: deterministic onchain health-factor/state remains primary. AI/web monitoring is supplemental evidence, never the canonical HF oracle.

## Jaydearcadian/Gaia

Use for: **ambiguous event evidence / secondary adjudication**

Directly useful mechanics:

- independent node inference;
- structured answer + evidence;
- commit/reveal;
- quorum settlement;
- disagreement detection;
- onchain attestation.

This is an optional escalation/evidence lane, not the hot path.

## Jaydearcadian/RJP

Use for: **protocol/contract risk and bounded judgment**

Directly useful mechanics:

- normalized case objects over bounded observation windows;
- reproducible evidence manifests and roots;
- revisioned judgments;
- freshness windows;
- `SAFE → ALLOW`, `UNSAFE → DENY`, `INSUFFICIENT_DATA → REFRESH`;
- cheap mirrored read-side consumption;
- judgment-aware vs direct-agent benchmarking.

Best Kumo use: contract/permission safety judgments and disputed mandate fulfillment, not routine market arithmetic.

## etvjay/0-1

Use for: **the common decision engine**

Directly useful pipeline:

```text
cheap triage
→ evidence research
→ opposing views / evidence council
→ belief / opportunity object
→ refresh live prior
→ reject drift
→ exact execution quote
→ risk gates
→ shadow opportunity / refusal
→ append-only forecast ledger
→ later outcome scoring
```

Highest-value imports:

- cheap-first / expensive-later analysis;
- execution edge rather than theoretical edge;
- exact quote before action;
- stale-state refusal;
- shadow mode;
- prospective outcome ledger;
- future-data-leakage protection;
- explicit refusal instead of forced action.

## etvjay/Noema

Use for: **evidence-bounded economic state**

Directly useful mechanics:

```text
sources → evidence → claims → verification → economic object
```

Use the evidence discipline and versioned economic-object idea. Do not import RWA-specific semantics into DeFi.

## etvjay/Nomos

Use for: **authority, replay, allocation, rectification and GenLayer judgment boundary**

Directly useful primitives:

- Policy Envelope;
- Workflow Authorization;
- Mandate Allocation;
- Dynamic Authority Allocation;
- Dynamic Authorization Lanes;
- Capital Commitment / encumbrance concepts;
- Claim Verification;
- Gaia rectification plane.

Critical invariant to retain:

```text
judgment proposes; determinism disposes
```

For Kumo: recommendations create no authority; authority is separately granted, bounded and replay-safe.

## etvjay/Thinking-Reed

Use for: **lineage and evidence semantics**

Directly useful rules:

- fact / observation / assertion / inference / assumption / hypothesis / decision are distinct;
- generated output is not evidence reality changed;
- failures/refusals/disagreement are first-class;
- consequential execution is permission-bounded;
- artifacts trace back to evidence and decisions.

## etvjay/Engram

Use for: **later execution-memory enhancement, not MVP dependency**

Directly useful future loop:

```text
execution
→ operational memory
→ comparable future recall
→ explicit influence
→ changed action vs no-memory control
→ observed outcome
```

Potential use: each Kumo reference agent can eventually remember route failures, adverse liquidity states, strategy underperformance, or recovery patterns. Do not block the hackathon path on Engram.

## etvjay/OneSpin

Use for: **portable authoritative state projection**

Useful pattern:

- preserve source authority;
- deterministic versioned reducer;
- reusable projection;
- downstream systems apply their own local policy.

Useful later if Kumo consumes GenLayer/RJP judgments without importing their internal code.

---

# Reference agent mechanics

## 1. Kumo Rebalancer

Purpose: maintain a portfolio/LP position inside a bounded target policy only when the expected net improvement exceeds execution cost and risk.

### Observe

- current asset weights / LP range;
- target allocation/range;
- current price and volatility;
- liquidity depth;
- fee income / fee APR;
- in-range utilization;
- gas;
- swap/reposition quote;
- route availability;
- authority state.

### Decide

Compute:

```text
allocation drift
range drift
expected fee improvement
expected IL/risk delta
reposition cost
slippage
bridge cost if any
net expected benefit
```

A rebalance is eligible only if the expected net benefit clears a configured hurdle after all known costs.

### Safety

```text
candidate rebalance
→ exact quote
→ market refresh
→ security veto
→ policy envelope
→ canary/simulation
→ bounded authority
→ execute
```

### Outcome

Measure after a frozen observation window:

- net fees earned;
- impermanent-loss delta;
- reposition cost;
- gas/slippage/bridge costs;
- in-range time;
- net value vs no-rebalance baseline.

Primary first venue target: PancakeSwap LP rebalancing.

## 2. Kumo Grid Operator

Purpose: maintain a bounded grid/market-making strategy with explicit inventory and drawdown controls.

### Mechanics inherited from zo-market-maker-ts

- fair-price reference;
- quote around fair value;
- position tracking;
- normal vs close mode;
- update throttling;
- order reconciliation;
- position reconciliation.

### Rich extensions

- volatility-adaptive grid width;
- inventory-skewed bid/ask spacing;
- automatic recentering after material drift;
- maximum inventory imbalance;
- maximum open orders;
- maximum realized/unrealized drawdown;
- stale-price kill switch;
- venue-liquidity minimum;
- canary first order after strategy/config change;
- cooldown after rapid fills or volatility shock.

### Outcome

- net PnL after fees/gas/slippage;
- fill rate;
- turnover;
- inventory variance;
- max drawdown;
- spread capture;
- time active;
- benchmark vs passive hold / static-grid control.

## 3. Kumo Yield Scout

Purpose: discover and execute only yield moves whose **executable net yield** improves the user's position after costs, liquidity and risk.

### Discovery

Use the 0-1 cheap-first pattern:

```text
broad protocol/pool inventory
→ cheap APY/liquidity/lockup triage
→ top-K candidates
→ deeper contract/economic verification
```

### Normalize

Never compare headline APY directly.

```text
executable net yield
= base yield
+ incentive yield
- entry cost
- exit cost
- gas
- slippage
- bridge cost
- lockup/illiquidity cost
- explicit risk haircut
```

### Safety

- verify contract identity;
- freshness and multi-source consistency for consequential state;
- reject insufficient liquidity;
- reject unsupported/unknown reward tokens unless explicitly allowed;
- refresh yield/TVL/price/quote before execution;
- shadow recommendation before capital movement where practical;
- bounded allocation cap and protocol allowlist.

### Outcome

- realized net APY / yield;
- execution costs;
- liquidity/exit behavior;
- reward realization;
- adverse protocol/risk events;
- result vs hold/current-position baseline.

## 4. Kumo Health Guard

Purpose: detect deteriorating lending positions early and execute the least-cost bounded protective action before liquidation.

### Deterministic core

Primary state comes from protocol/chain data:

- collateral;
- debt;
- oracle price;
- liquidation threshold;
- health factor;
- distance to liquidation;
- available repay/add-collateral liquidity;
- execution quote/cost.

### Supplemental evidence

The autonomous-monitor/RJP/GenLayer family can provide secondary evidence for:

- protocol exploit/security incident;
- oracle/status-page anomaly;
- governance/emergency change;
- external market dislocation;
- ambiguous risk claims.

Supplemental judgment may tighten or pause policy. It does not replace deterministic health-factor arithmetic.

### Action ladder

```text
healthy
→ watch
→ warn
→ prepare protective action
→ refresh
→ canary/simulate
→ execute bounded rescue
→ verify
→ recover / escalate if needed
```

Possible rescue actions:

- repay debt;
- add collateral;
- reduce/close position;
- source liquidity via Kumo cross-chain routing;
- swap to required repayment asset.

### Outcome

- warning lead time;
- false-positive rate;
- avoided liquidation events;
- rescue cost;
- capital efficiency impact;
- health-factor recovery;
- failure/recovery path quality.

---

# Shared Kumo Financial Agent Kernel

Every reference agent should expose the same structural surfaces:

```text
AgentManifest
ObservationSnapshot
EvidencePacket
StrategyProposal
PreparedAction
ActivationEnvelope
ExecutionSession
ExecutionReceipt
OutcomeRecord
JudgmentCase? / RecoveryCase?
```

Every proposal should support:

- `recommend` mode;
- `shadow` mode;
- `execute` mode only when authority exists.

Every agent should be callable through the same integration family where appropriate:

- SDK
- REST/API
- MCP
- A2A
- Kumo Inbox

The interface must remain problem-first. Infrastructure details belong under evidence/advanced views.

---

# Deployment strategy

Do not wait for external agents to satisfy the four core categories.

Deploy one Kumo-operated reference agent per core track. External/discovered agents compete beside them.

Reference agents should be production-shaped but narrowly scoped:

- one initial venue/protocol per agent;
- rich decision and safety mechanics;
- real observable data;
- explicit authority;
- reproducible receipts;
- measurable outcomes;
- no invented multi-protocol breadth.

A second venue is added only after the first venue produces end-to-end live evidence.

---

# What not to import

- No full Engram dependency in the MVP.
- No RWA-specific Noema semantics.
- No full Nomos/GenLayer financial stack inside Kumo.
- No GenLayer judgment for deterministic financial arithmetic.
- No simulated supply presented as live marketplace depth.
- No chain-specific source implementation treated as a generic adapter.
- No clone agents counted as real diversity merely because configuration differs.
