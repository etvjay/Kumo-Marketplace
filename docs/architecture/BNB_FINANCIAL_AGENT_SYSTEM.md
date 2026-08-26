# BNB Financial Agent System

Status: ARCHITECTURE FROZEN — ADAPTER IMPLEMENTATION PARTIAL

Kumo's BNB financial agents operate on one shared state/execution substrate while preserving different domain cognition.

## System

```text
RPC / protocol sources / indexers / market data
                  ↓
          Chain Truth Layer
   block + hash + finality + timestamp
                  ↓
       Contract Identity Layer
 chain + address + bytecode/code identity
                  ↓
       Protocol Adapter Layer
 authoritative protocol-specific reads
                  ↓
             Noema Layer
 evidence → claims → verification → economic object
                  ↓
        Domain Cognition Layer
 ┌────────────┬───────────┬────────────┬──────────────┐
 │ Rebalancer │ Grid      │ Yield      │ Health Guard │
 │ LP/range   │ inventory │ deployment │ solvency     │
 └────────────┴───────────┴────────────┴──────────────┘
                  ↓
       Financial Agent Kernel
 proposal → quote → refresh → veto → canary
                  ↓
         Authority / Commerce
 bounded signer/session + hiring/payment identity
                  ↓
              Execution
                  ↓
       Receipt + Post-State Read
                  ↓
         Outcome / Counterfactual
                  ↓
          execution memory later
```

## State hierarchy

Kumo must preserve these as separate objects:

1. **Chain state** — concrete block/hash/finality/timestamp.
2. **Contract state** — storage/call results at that block.
3. **Protocol state** — coherent interpretation across the contracts that own a protocol surface.
4. **Position state** — actor-specific LP/order/lending/vault state.
5. **Economic state** — evidence-bounded valuation/risk/opportunity claims.
6. **Agent state** — current proposal, inference, uncertainty and mode.
7. **Authority state** — what the agent is permitted to sign/call/spend and until when.
8. **Outcome state** — what changed and whether the intervention beat its baseline.

```text
Observation ≠ Interpretation ≠ Recommendation ≠ Authorization ≠ Execution ≠ Outcome
```

## Block-coherent observation rule

A consequential economic object cannot be assembled from arbitrary independent `latest` reads.

The adapter first freezes a block:

```text
purpose=evidence
→ get finalized block N/hash H
→ position read @ N
→ pool read @ N
→ oracle read @ N
→ contract code evidence @ N
→ one coherent evidence packet
```

Execution uses a different purpose:

```text
prepared proposal based on evidence block
→ freeze latest execution block M
→ re-read every consequential field @ M
→ compare against prepared assumptions
→ reject drift or continue
```

Post-execution outcome verification returns to finalized state.

## Shared layer vs agent-specific cognition

Shared substrate owns:

- block/finality coherence;
- RPC/provider identity;
- contract identity evidence;
- protocol-read provenance;
- claim/evidence freshness;
- quote freshness;
- policy/security veto;
- bounded authority;
- transaction receipt and post-state reconstruction.

It does **not** own one universal financial score.

Agent-specific cognition remains:

```text
Rebalancer
  range geometry + fee capture + IL + reposition economics

Grid Operator
  fair price + spread + inventory + fills + drawdown

Yield Scout
  executable net yield + liquidity + lockup + switching/risk cost

Health Guard
  collateral/debt + liquidation threshold + liquidity/shortfall + rescue cost
```

## Read providers vs event/indexing providers

Do not make one RPC do every job.

```text
coherent point-in-time truth
→ archive-capable JSON-RPC reads

continuous discovery/monitoring
→ log/indexing/WebSocket provider

market valuation
→ explicit market-data/oracle adapters
```

Every derived economic claim records which class of source produced it.

## Contract identity

An address constant is configuration, not proof.

Minimum execution gate:

```text
expected chain
+ expected address
+ bytecode present
+ deployment source/version
+ optional expected runtime-code hash
```

Proxy protocols require implementation/admin/upgradability awareness where those facts affect safety. A later identity hardening milestone should pin runtime-code hashes for every consequential adapter contract.

## Authority

Strategy recommendation never grants wallet authority.

```text
Noema ALLOW
≠ strategy PROPOSE
≠ Kumo READY
≠ signer may sign arbitrary typed data
```

The authority layer must bind at least chain, verifying/called contracts, methods/action family, token/spend ceiling, slippage, expiry and exact prepared-action identity.

## Cross-chain state

Cross-chain rescue/rebalance introduces two independent state machines:

```text
source-chain funding/route state
            +
destination BSC financial-position state
```

The route must be observed and verified separately. Arrival of funds on BSC is a prerequisite for a Health Guard rescue, not proof the lending position became safe.
