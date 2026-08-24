# Research Foundry — BNB Smart Money Era Tracks Truth

Verified: 2026-08-24
Status: `PASS_WITH_LIMITATIONS`

## Research question

What does the actual `Tracks` surface require from Kumo Marketplace, what do the partner tracks materially change, and which architecture/build decisions follow from evidence rather than assumption?

Canonical source: https://www.bnbchain.org/en/hackathons/smart-money-era?tab=tracks

Supporting primary sources:

- BNB Agent Studio: https://www.bnbchain.org/en/bnb-agent-studio
- 8004scan Builder Hub / OpenAPI: https://8004scan.io/developers and https://8004scan.io/api/v1/public/docs/openapi.json
- Altana sessions: https://docs.altana.network/concepts/sessions
- Altana ERC-8183: https://docs.altana.network/sdk/erc8183
- Altana x402 seller SDK: https://docs.altana.network/sdk/x402-server
- Altana skills: https://skills.altana.network/
- TermiX BSC MCP: https://github.com/TermiX-official/bsc-mcp
- PancakeSwap developer docs: https://developer.pancakeswap.finance/

---

## 1. Verified facts

### Main track

The product requested is explicitly a **front end** that surfaces agent data and lets users discover and activate agents by category. The required cold-user journey is:

```text
land → find agent by category → understand agent → activate → no dead end
```

All four categories are first-class and must have equal depth:

1. Rebalancing — manages LP ranges / resets positions automatically.
2. Grid Trading — places/manages automated grid orders.
3. Yield Optimisation — routes liquidity to highest available APR.
4. Health Factor Monitoring — protects lending positions from liquidation.

Single-category submissions score poorly.

Published judging criteria are:

- Functionality
- Data Quality
- Agent Diversity

The page contains a `Weight` column but publishes no numeric weights for these three criteria.

Three judges score independently and then compare.

The product must be functional and publicly accessible during judging.

Agents surfaced on the marketplace must be live on BSC.

The winner receives the main prize and official adoption as the BNB Agent Studio marketplace / canonical front door for agents on BSC.

Phase 2 contains additional criteria that remain unpublished / redacted.

### 8004scan / AltLayer resource

8004scan is not listed as an independent prize track on the page. It is an official hackathon resource supplied by sponsor AltLayer.

The official page explicitly positions 8004scan as a discovery/trust data source for agent marketplaces, recommendation systems, reputation systems and analytics.

Hackathon participants can apply for complimentary Pro access:

- 500 requests/minute
- 100,000 requests/day

The current OpenAPI contract supports:

```text
GET /agents
GET /agents/{chainId}/{tokenId}
GET /agents/search?q=...&chainId=...
GET /accounts/{address}/agents
GET /stats
GET /feedbacks
GET /chains
```

`/agents/search` supports semantic + keyword search, an explicit `chainId` filter and up to 100 results for Pro/Enterprise.

The public API's normalized `Agent` response currently contains identity/listing fields such as chain ID, token ID, name, description, owner, supported protocols, score, stars, feedback count and creation timestamp. It does **not**, in that public schema, expose the full registration metadata/services payload needed to prove endpoint liveness. Therefore Kumo must not treat the list/search response as sufficient runtime evidence.

ERC-8004 itself explicitly does not guarantee that advertised agent capabilities are functional or benign. Registration is identity/discovery evidence, not execution verification.

### BNB Agent Studio

The current Studio surface says deployed agents receive:

- ERC-8004 identity
- ERC-8183 task interface
- x402 self-funding/payment capability
- cloud deployment

Current public installation surface uses:

```text
npm install -g @bnbagent/studio-cli
bag skills install
```

The FAQ on the same page also says `bag install`, creating a current first-party CLI wording inconsistency. Build automation must gate on a working/version-recorded `bag` binary rather than assume one prose path is canonical forever.

### Altana partner track

To qualify, the submission must show live onchain transactions in the Altana explorer on testnet or mainnet.

Required properties:

- agents on their own Altana wallets;
- sessions with a real call allowlist;
- spend cap;
- expiry;
- sessions registered in Keystore;
- real onchain transaction through a session key;
- user-facing display of what authority the agent has;
- user-facing revocation.

Mainnet is stronger, but testnet qualifies.

Bonus:

- hire BNB Agent Studio agents through ERC-8183 using Altana SDK;
- sell over x402/B402 using Altana x402 server SDK.

Altana session permissions are enforced onchain. A session outside its call allowlist or over its spend cap reverts. `grantSession` registers the key by default; `revokeSession` is monotonic; expiry is automatic.

Important security detail: omitted `permissions.calls` means unrestricted calls within the spend cap. Kumo must set both call constraints and spend constraints for financial agents unless unrestricted calls are intentionally part of the mandate.

Sessions must be byte-exact at execution relative to the granted permissions/expiry/public key. Persist the exact granted session object.

### ERC-8183 via Altana

Altana's current SDK describes ERC-8183 as job escrow in `$U`:

```text
buyer funds job
→ seller submits deliverable
→ optimistic dispute window
→ settle / dispute
→ refund after expiry if seller does not deliver
```

`hireErc8183Agent` runs buyer-side create/register/budget/approve/fund as an atomic relay intent. A scoped session key can be used, meaning the spend cap can bound how much autonomous hiring can escrow.

The deliverable is committed onchain as a hash of a canonical manifest; clients should verify the manifest hash before trusting the content.

### x402 / B402 via Altana

The seller SDK can guard an HTTP capability with onchain payment. Studio buyers use `$U` over EIP-3009.

The current compatibility contract says Studio buyers require an HTTPS production URL and use the `$U` EIP-3009 rail.

This is a useful optional monetization path for Kumo agents, but is a bonus rather than a main-track hard requirement.

### TermiX partner track

No TermiX integration is required.

TermiX will hire from the marketplace themselves.

Scoring:

- Value of services — 30%
- Proven agent advantage — 30%
- High-stakes categories & track record — 20%
- Marketplace quality — 20%

Required Agent Advantage Report:

1. at least 3 real tasks run both ways: hired agent vs without agent;
2. time, cost and output quality for each, with actual outputs attached;
3. at least one trading, stock or security task.

Trading agents need a real record including win rate, time window and risk taken.

### PancakeSwap partner challenge

The hard semantic requirement is real benefit to PancakeSwap traders or LPs.

Examples include:

- smarter liquidity management;
- better yield discovery;
- research identifying useful new pool demand;
- safe automated swaps without putting user funds at risk.

No numeric judging weights are published on the track page.

### TermiX BSC MCP resource

The linked public MCP server currently exposes BSC/PancakeSwap functionality including swaps, V2/V3 liquidity management, balances, security checks and contract calls. It is a useful reference / possible measurement tool, but because TermiX explicitly says no integration is required, it must not become a blocking dependency.

---

## 2. Observations

### O1 — 8004scan is effectively the intended discovery substrate

The hackathon asks for a front end rather than a new registry, and the official Resources section gives a high-throughput agent API specifically for marketplace/discovery use. Rebuilding the registry would be duplicated infrastructure with no judging advantage.

### O2 — registry scale is not category supply

The official page cites >200,000 BNB ERC-8004 registrations, but current indexed examples reveal substantial noise: many agents have zero feedback, thin metadata, generic personalities, or weak evidence of callable financial capability.

Search sampling found credible BSC trading agents such as `VerdantAegis` and `Ave.ai Trading Agent`, but grid-trading search results surfaced stronger examples on Injective rather than BSC. This is negative evidence against assuming that all four required categories already have deep BSC supply.

### O3 — Kumo's product cannot merely mirror 8004scan scores

ERC-8004 reputation is public and useful, but the standard explicitly warns about Sybil/spam risk and does not guarantee functional advertised capability. A financial marketplace needs independent liveness, endpoint/service verification, current economic context and outcome evidence.

### O4 — Altana and ERC-8183 are unusually composable with the main-track product

The main track asks users to activate/hire agents; Altana's bonus explicitly rewards an agent-hiring marketplace using ERC-8183. This is not an unrelated partner bolt-on. It can become Kumo's canonical high-confidence activation path while improving authority legibility.

### O5 — TermiX changes reputation from decoration into experiment design

Because TermiX will actually hire agents and compare results, Kumo needs performance measurement from the beginning. A profile score without paired baseline evidence will not satisfy the partner rubric.

### O6 — PancakeSwap gives Kumo one strong cross-track proof lane

A bounded PancakeSwap LP-management/rebalancing path can simultaneously support:

- main-track Rebalancing depth;
- main-track Data Quality;
- Altana bounded authority;
- PancakeSwap real benefit;
- TermiX paired agent-vs-manual evidence.

This is a high-leverage implementation target.

---

## 3. Inferences

These are not published requirements.

### I1 — official adoption likely raises the hidden Phase-2 bar from demo quality to operability

Because the winner is intended to become the canonical Agent Studio front door, likely Phase-2 pressure includes reliability, maintainability, operational visibility, security, truthful degraded states and handoff quality. This must remain labeled `INFERRED_EVALUATOR_PRESSURE` until BNB publishes Phase-2 criteria.

### I2 — category parity should be measured structurally, not visually

Equal-depth tabs are insufficient. For each category Kumo should require parity across:

```text
supply count
verified liveness
profile/comparison metrics
activation path
receipt/evidence path
at least one production-shape agent
```

### I3 — Kumo may need to create or recruit missing category supply

If live 8004scan/Agent Studio discovery cannot produce credible BSC agents in all four categories, the challenge cannot be solved by frontend ingestion alone. The fallback must be to deploy or onboard at least one real Studio-compatible agent in deficient categories rather than filling the UI with weak registry matches.

### I4 — 8004scan should be discovery truth, not final marketplace truth

Recommended truth chain:

```text
ERC-8004 / 8004scan identity
→ raw metadata/service evidence
→ independent liveness
→ category qualification
→ security/economic assessment
→ activation capability
→ observed execution
→ verified outcome
→ Kumo reputation
```

---

## 4. Contradictions / ambiguity register

### C001 — main rubric weight column has no numeric weights

Status: `UNRESOLVED`

Do not assume equal thirds.

### C002 — Phase 2 additional criteria are redacted

Status: `UNRESOLVED`

Do not manufacture requirements. Run inferred adoption-defense tests separately.

### C003 — `activate` is not defined normatively

Status: `UNRESOLVED`

Conservative Kumo rule: activation must produce a real actionable/hiring path rather than a dead-end CTA. ERC-8183 is the strongest current canonical path where supported.

### C004 — `live on BSC` is not defined normatively

Status: `UNRESOLVED`

Conservative Kumo standard:

```text
BSC-bound identity
+ discoverable/current metadata
+ callable/live runtime
+ successful task/execution evidence
```

Registration alone is insufficient.

### C005 — BNB Agent Studio CLI wording differs on one first-party page

`bag skills install` and `bag install` both appear.

Status: `RESOLVE_AT_RUNTIME`

Use installed CLI help/version as execution truth.

### C006 — submission form fields remain unverified

The official short link redirects to Google Forms, but the complete form schema was not retrievable in this research environment.

Status: `UNVERIFIED`

Do not assume repo/video/deck/etc fields unless the form or organizers state them.

---

## 5. Decisions affected

### D001 — KEEP the 8004scan adapter and make it primary discovery

Decision: `ACCEPT`

Reason: directly aligned with official hackathon resources and avoids redundant indexing.

### D002 — ADD raw metadata/service retrieval as a separate layer

Decision: `REQUIRED`

Reason: the public search/list schema is not enough to establish services/liveness.

### D003 — ADD independent liveness verification before category admission

Decision: `REQUIRED`

Reason: ERC-8004 registration does not prove functional capability.

### D004 — ADD category qualification instead of free-text mapping only

Decision: `REQUIRED`

Each category needs deterministic eligibility fields and an explicit evidence reason.

### D005 — PRIORITIZE Altana + ERC-8183 after category/discovery viability

Decision: `ACCEPT`

Reason: directly compounds main-track functionality and Altana partner score.

### D006 — START TermiX experiment instrumentation before agents are polished

Decision: `ACCEPT`

Persist T0 inputs, baseline, agent output, time, cost, quality rubric and later outcome. Do not reconstruct after the fact.

### D007 — USE PancakeSwap rebalancing as the first cross-track live proof lane

Decision: `ACCEPT`

Reason: best overlap between Rebalancing, bounded authority, measurable benefit and agent-advantage evidence.

### D008 — DO NOT make TermiX MCP or Noema/Nomos hard dependencies

Decision: `ACCEPT`

They may improve evaluation or differentiation, but must not block the main discover→compare→activate path.

---

## 6. Evidence maturity

| Claim | Maturity |
|---|---|
| Track requirements extracted from current official page | X1 / source-grounded |
| 8004scan API shape | X1 / source-grounded |
| Kumo 8004scan adapter code exists | implementation evidence in repo; runtime not yet proven |
| BSC category supply sufficient | X0 / unproven |
| Altana session semantics | X1 / source-grounded |
| ERC-8183 Kumo activation works | X0 / not implemented |
| PancakeSwap measurable benefit | X0 / not run |
| TermiX agent advantage | X0 / not run |

---

## 7. Unresolved assumptions

1. There are enough genuinely live BSC agents to populate all four categories without Kumo deploying supply itself.
2. 8004scan Pro access will be granted quickly enough for development/judging.
3. Agent Studio / ERC-8183 service metadata can be resolved reliably from discovered agents.
4. A common activation abstraction can cover both native Agent Studio/ERC-8183 agents and other BSC agents without lying about capability parity.
5. Phase 2 will not introduce a new requirement that invalidates the architecture.

---

## 8. Smallest next falsification experiment

**Can Kumo obtain at least one credible, live, callable BSC agent for each of the four mandatory categories and produce enough fresh evidence to make a hiring decision?**

For each category:

```text
1. semantic-search 8004scan with chainId=56;
2. retain top N candidates;
3. fetch full agent/registration metadata;
4. locate advertised MCP/A2A/web/ERC-8183 service;
5. independently probe service liveness;
6. verify category claim against actual capability surface;
7. record freshness, price/economic metrics and trust signals;
8. attempt a dry or testnet activation where safe;
9. classify supply as QUALIFIED / PARTIAL / FAILED.
```

Falsification condition:

If any required category has no credible qualified supply, stop treating Kumo as ingestion-only and immediately deploy/onboard a production-shape BSC agent for that category.

---

## Research Foundry outcome

`PASS_WITH_LIMITATIONS`

The Kumo direction survives the Tracks-page audit and is strengthened in three ways:

1. 8004scan becomes the evidence-backed primary discovery substrate.
2. Altana/ERC-8183 becomes the preferred bounded activation path where available.
3. The real risk moves from "can we build a marketplace?" to **"can we prove deep, live, economically useful supply in all four categories?"**

That supply question is now the next blocking experiment.