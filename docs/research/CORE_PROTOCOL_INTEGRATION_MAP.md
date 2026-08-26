# Core Protocol Integration Map

Status: IMPLEMENTATION INPUT
Fetched/updated: 2026-08-26

## Initial matrix

| Agent | First protocol/venue | Authoritative read surface | Primary write surface | Outcome truth |
| --- | --- | --- | --- | --- |
| Kumo Rebalancer | PancakeSwap V3 BSC | Factory + V3 Pool + NonfungiblePositionManager | PositionManager + current V3 routing surface | post-position value/fees/costs vs frozen static baseline |
| Kumo Grid Operator | 1inch Limit Order Protocol v4 (`4.3.2`) | order hash/state + wallet inventory + price/liquidity feeds | EIP-712 order creation/cancellation; fills on Router v6/LOP | realized spread/PnL, fills, inventory variance, drawdown vs passive/static-grid baseline |
| Kumo Yield Scout | Aave V3 BNB | Pool/DataProvider/Oracle/reserve state | supply/withdraw via audited Aave Pool surface | realized net yield after entry/exit/gas vs stay-put baseline |
| Kumo Yield Scout second venue | Lista Lending | Moolah/vault/market/oracle state | selected vault/market entry/exit | realized net yield + exitability/risk costs |
| Kumo Health Guard | Venus | Comptroller + market balances + oracle/sentinel state | repay/add collateral/reduce debt through approved Venus surfaces | liquidity/shortfall recovery, liquidation avoided, rescue cost |

## Rebalancer: PancakeSwap V3

### State owners

```text
Factory
→ token0/token1/fee → canonical pool

V3 Pool
→ sqrtPriceX96
→ current tick
→ current in-range liquidity
→ oracle observations/TWAP inputs

NonfungiblePositionManager
→ NFT owner/operator
→ tick bounds
→ position liquidity
→ fee-growth checkpoints / tokens owed

ERC-20s
→ balances / decimals / approvals
```

### Derived state

Never label derived values as direct pool facts:

```text
raw liquidity + sqrtPriceX96 + tick bounds
→ token0/token1 quantities

quantities + explicit token price evidence
→ USD position value

fee history + volume/range assumptions
→ fee projection [INFERRED]

scenario/risk model
→ IL delta [INFERRED]
```

### Execution direction

Use current V3 Universal Router/Permit2 capabilities only after exact calldata and signing policy are verified. Keep the older Smart Router as a legacy compatibility surface, not the new default.

Prefer single-use/scoped transfer authority where possible. Broad persistent allowance is not a harmless convenience for an autonomous agent.

## Grid Operator: 1inch Limit Order Protocol v4

### Why first

It gives the Grid agent real order semantics:

```text
signed maker order
→ active/cancelled/partially-filled/filled state
→ explicit inventory movement
```

rather than simulating a grid through repeated AMM market swaps.

### Version lock

Use audited upstream tag `4.3.2`. `master` is explicitly marked work-in-progress and unaudited by 1inch.

BSC Router v6 / LOP v4 address:
`0x111111125421cA6dc452d289314280a0f8842A65`

### Grid-specific state

```text
reference/fair price
order ladder
remaining amount per order
inventory
fills
fees/gas
realized/unrealized PnL
volatility
staleness
```

The Grid strategy alone owns transitions such as `NORMAL → INVENTORY_SKEWED → CLOSE → PAUSED`.

## Yield Scout: Aave V3 BNB

### First read path

```text
Pool/DataProvider
→ reserve configuration/state
→ liquidity / utilization / supply state

Oracle/market data
→ asset valuation

wallet/account
→ current capital position
```

Current protocol-maintained BNB address registry is `aave-dao/aave-address-book/src/AaveV3BNB.sol`.

### Decision object

```text
reported/current rate
+ reserve liquidity
+ withdrawal availability
+ reward economics if any
- entry gas/slippage
- exit cost
- switching cost
- explicit protocol/risk haircut
= executable net yield candidate
```

No headline APY ranking.

## Yield Scout second venue: Lista Lending

Lista adds a materially different BNB-native market/vault architecture. Because new markets can be created and isolated, Yield Scout must qualify each concrete market/vault rather than inheriting trust from the Lista brand.

Minimum market qualification:

- exact contract identity;
- underlying asset identity;
- oracle source;
- available liquidity;
- withdrawal/exit mechanics;
- rate model;
- caps/restrictions;
- historical/current adverse state where available.

## Health Guard: Venus

### Canonical deterministic state

Do not normalize Venus prematurely into a generic `healthFactor` field.

The first Venus adapter preserves:

```text
collateral balances
borrow balances
collateral factors
liquidation thresholds
oracle prices
account liquidity
account shortfall
```

`getAccountLiquidity`-style protocol state is the canonical solvency fact for the first adapter. A Kumo health rate may later be derived with explicit lineage.

### Supplemental risk layer

Separate signals can include:

- market paused/deprecated;
- oracle deviation/sentinel state;
- bridge/token-representation incident;
- governance/emergency risk changes.

These can move Health Guard from `WATCH` to `PREPARE/REFRESH/PAUSE`, but deterministic rescue size still derives from lending state.

### Rescue ladder

```text
HEALTHY
→ WATCH
→ WARN
→ PREPARE
→ REFRESH
→ RESCUE
→ VERIFY
```

Rescue writes remain bounded to repay/add-collateral/deleverage/close actions authorized for the exact lending position.

## Cross-chain liquidity ingress

Health Guard and Rebalancer may need BSC liquidity that originates elsewhere.

Model:

```text
source asset/state
→ route quote
→ route authorization
→ bridge/solver execution
→ BSC arrival proof
→ refresh destination protocol state
→ destination action
```

Never collapse route execution and destination financial success into one receipt.

## Integration implementation order

1. make Pancake V3 reads same-block/finality-bound;
2. finish V3 position math and valuation;
3. add generic contract-identity/source registry primitives;
4. build Venus read-only Health Guard adapter;
5. build Aave V3 BNB read-only Yield adapter;
6. build 1inch LOP v4 read/order-state adapter;
7. add shadow outcome ledgers for all four before live capital;
8. add bounded signing/execution surfaces only after read/decision evidence is reproducible.
