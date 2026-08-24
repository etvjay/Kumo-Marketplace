# Kumo Rebalancer

Status: STRATEGY FOUNDATION IMPLEMENTED — LIVE BSC EXECUTION UNVERIFIED

Kumo Rebalancer is the first Kumo-operated reference agent for the BNB Smart Money `Rebalancing` core market.

Its initial live target is a single PancakeSwap V3 concentrated-liquidity position on BNB Smart Chain.

## Product statement

> Keep an LP position productively in range only when the executable net benefit of repositioning exceeds its costs and risk.

The agent is not a generic portfolio robo-advisor and does not rebalance simply because a threshold moved.

## Why PancakeSwap V3

PancakeSwap explicitly supports autonomous V3 range-rebalancing agents through BNB Agent Studio and documents the safe execution order and guardrails for unattended wallets. The first Kumo adapter therefore targets the same BSC V3 surface.

Initial BSC configuration:

- chain: `56`
- V3 factory: `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865`
- NonfungiblePositionManager: `0x46A15B0b27311cedF172AB29E4f4766fbE7F4364`
- Smart Router: `0x13f4EA83D0bd40E75C8222255bc855a974568Dd4`

Execution must verify code/network identity before these configured addresses are trusted.

## Decision model

The agent observes:

- current V3 NFT position and range;
- current tick / spot price;
- whether the position is in range;
- position value;
- uncollected fees;
- pool liquidity;
- recent volume when available;
- fee APR estimate when available;
- realized volatility when available;
- gas and executable route economics.

The agent chooses a target range centered around the refreshed market tick and evaluates:

```text
expected net benefit
=
expected fee improvement
- expected impermanent-loss delta
- gas cost
- slippage cost
- bridge cost if capital must move cross-chain
```

A drift trigger is necessary but not sufficient. The proposal is refused when the net benefit hurdle, liquidity floor, volatility bound, position cap, gas cap or total-cost cap fails.

## Operational modes

### Recommend

Return the evidence packet and proposal/refusal. No transaction quote is required for a refusal and no authority is used.

### Shadow

Generate an executable quote but do not move capital. Persist the prospective proposal so later analysis can compare the proposed rebalance with the static position baseline.

### Execute

Execution is permitted only after:

```text
proposal
→ exact PancakeSwap quote
→ fresh onchain position/pool read
→ market-root comparison
→ security veto checks
→ policy checks
→ canary/simulation
→ bounded authority
→ atomic rebalance
```

## PancakeSwap execution shape

The live venue adapter should prepare one atomic or all-or-revert operation covering the required sequence where possible:

1. decrease/remove liquidity from the existing range;
2. collect fees/tokens;
3. perform any required balancing swap;
4. mint/increase the new concentrated-liquidity range;
5. leave no broad token approval behind.

Required unattended-wallet controls:

- short deadlines;
- exact/scoped approvals;
- slippage ceiling;
- contract allowlist;
- method allowlist;
- maximum spend/exposure;
- quote expiry;
- code identity check;
- atomic multicall where the supported PancakeSwap path permits it.

## Outcome proof

A successful transaction is only an `ExecutionReceipt`.

Kumo must later measure an `OutcomeRecord` over a frozen observation window:

- position value before/after;
- fees earned;
- gas and execution costs;
- impermanent-loss delta;
- fraction of time in range;
- static/no-rebalance baseline value;
- net value versus baseline.

Only the final comparison can promote the run to `beneficial`, `neutral` or `harmful`.

## Missing live work

The following are intentionally not claimed yet:

- live BSC RPC adapter;
- live V3 NFT position decoding;
- exact remove/collect/swap/mint calldata;
- exact Smart Router quote integration;
- Altana session-key execution;
- ERC-8183 hiring;
- live canary;
- live transaction receipt;
- measured outcome against a static baseline.
