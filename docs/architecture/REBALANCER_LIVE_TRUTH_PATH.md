# Rebalancer Live Truth Path

Status: RAW STATE + PRINCIPAL VALUATION + BASELINE FOUNDATION IMPLEMENTED — LIVE SHADOW RUN NOT YET EVIDENCED

## Purpose

The Rebalancer must not receive a pre-computed `positionValueUsd` and treat it as chain truth. It reconstructs the position from block-bound PancakeSwap V3 state, then attaches explicit price evidence.

## Read path

```text
freeze BSC block N/hash H
  ↓
NonfungiblePositionManager.positions(tokenId) @ N
NonfungiblePositionManager.ownerOf(tokenId) @ N
  ↓
Factory.getPool(token0, token1, fee) @ N
  ↓
Pool.slot0() @ N
Pool.liquidity() @ N
ERC20.decimals() @ N
contract code evidence @ N
```

The snapshot includes the position fee-growth checkpoints because the eventual static counterfactual needs to reconstruct what the original range would have earned if it had been left untouched.

## Principal reconstruction

V3 liquidity is not a token amount.

The implementation uses the canonical V3 piecewise liquidity formulas:

```text
price below range
→ all principal in token0

price inside range
→ token0 + token1

price above range
→ all principal in token1
```

Tick-to-sqrt-price conversion is an exact integer port of the canonical V3 `TickMath.getSqrtRatioAtTick` algorithm. The implementation includes the canonical zero/min/max vectors to catch accidental arithmetic drift.

## Fees

`tokensOwed0` / `tokensOwed1` are recorded as **crystallized fee floors**, not complete accrued fees.

A position can have additional in-range fees that are realized when the position is poked/modified/collected. Kumo therefore keeps:

```text
principal value
crystallized fee floor
future full-fee reconstruction
```

as separate concepts.

## Valuation

```text
principal raw amounts
+ token decimals
+ explicit token/USD price evidence
→ principal USD value

crystallized owed amounts
+ same price evidence
→ crystallized-fee floor USD
```

Price evidence is external economic evidence. It is never relabeled as direct PancakeSwap contract state.

`spotToken1PerToken0` is independently derived from `sqrtPriceX96` and token decimals and can be used as a coherence check against external prices, but it does not itself provide a USD anchor.

## Static baseline

Before a shadow or live rebalance, freeze:

- block number/hash/timestamp;
- owner and token identities;
- decimals and fee tier;
- original tick range;
- current tick and sqrt price;
- original liquidity;
- `feeGrowthInside{0,1}LastX128` checkpoints;
- crystallized owed tokens;
- reconstructed principal amounts;
- external price evidence;
- marked USD values.

The counterfactual is explicitly:

> leave the original PancakeSwap V3 range and liquidity unchanged.

It is **not** a simple token-HODL baseline.

## Shadow record

A shadow decision binds:

```text
baseline
+ Kumo StrategyProposal
+ Noema economic object/version
+ Noema mandate decision
+ evidence snapshot root
+ market snapshot root
```

and states `SHADOW_ONLY`. There is no authority and no transaction.

## Still missing before first evidence-backed shadow run

1. a concrete BSC LP token ID to observe;
2. live token/USD price provider evidence;
3. pool-level market metrics needed by the strategy (USD liquidity, volume/fee model, volatility model);
4. executable rebalance quote adapter;
5. durable shadow-ledger persistence;
6. later counterfactual fee-growth reconstruction.

No live financial advantage is claimed until those are measured.
