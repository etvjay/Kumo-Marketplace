# BNB Execution Source Registry

Fetched/verified: 2026-08-26

Purpose: keep Kumo's chain/protocol assumptions traceable to primary or protocol-maintained sources. This is a source registry, not evidence that a live adapter has successfully executed against every listed deployment.

## Source precedence

1. protocol-maintained deployment/address registries and audited tagged repositories;
2. protocol technical documentation for state semantics;
3. chain/EIP specifications for execution semantics;
4. current ecosystem articles only for discovery/landscape context;
5. aggregators/community pages never override protocol-maintained contract truth.

## BNB Smart Chain / EVM

| Source | What Kumo uses it for |
| --- | --- |
| https://docs.bnbchain.org/bnb-smart-chain/introduction/ | BSC execution/finality model and `finalized` semantics |
| https://docs.bnbchain.org/bnb-smart-chain/developers/json_rpc/json-rpc-endpoint/ | JSON-RPC availability, public endpoint limitations, BSC finality APIs |
| https://ethereum.org/en/developers/apis/json-rpc/ | EVM JSON-RPC state/read/receipt semantics |
| https://eips.ethereum.org/EIPS/eip-20 | ERC-20 balances/allowance/approval semantics |
| https://eips.ethereum.org/EIPS/eip-712 | typed structured signing/domain separation |
| https://eips.ethereum.org/EIPS/eip-2612 | permit semantics, nonce/deadline |
| https://eips.ethereum.org/EIPS/eip-5792 | wallet batched-call semantics/capabilities |

Operational consequence: action-critical reads must be block-bound. Kumo does not combine independently fetched `latest` values into one economic object and pretend they were simultaneous.

Default Kumo read policy:

```text
evidence  → finalized block
execution → latest block, then explicit drift/revalidation
outcome   → finalized block
```

Public BSC RPC endpoints are not assumed to be event-indexing infrastructure. Event-heavy monitoring should use an RPC/indexing provider that supports the required log/WebSocket surface.

## PancakeSwap V3 — Rebalancer

| Surface | Current Kumo role |
| --- | --- |
| V3 Factory `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865` | canonical pool resolution |
| NonfungiblePositionManager `0x46A15B0b27311cedF172AB29E4f4766fbE7F4364` | LP NFT position state / liquidity actions |
| V3 Universal Router `0x1A0A18AC4BECDDbd6389559687d1A73d8927E416` | current V3 routing candidate |
| Infinity Universal Router `0xd9C500DfF816a1Da21A48A732d3498Bf09dc9AEB` | newer Pancake routing surface; not automatically substituted into V3 position management |
| Pancake Permit2 `0x31c2F6fcFf4F8759b3Bd5Bf0e1084A055615c768` | scoped/signature-transfer candidate |
| Legacy Smart Router `0x13f4EA83D0bd40E75C8222255bc855a974568Dd4` | compatibility only; not default for new execution |

Primary docs: https://developer.pancakeswap.finance/

State semantics used by the adapter: V3 `slot0` supplies `sqrtPriceX96` and tick; pool `liquidity()` is current in-range liquidity rather than total initialized liquidity. Kumo therefore must not label that raw integer `total pool liquidity`.

## Venus — Health Guard

Primary docs:

- https://docs-v4.venus.io/guides/liquidation
- https://docs-v4.venus.io/technical-reference/reference-isolated-pools/comptroller/comptroller
- https://docs-v4.venus.io/deployed-contracts/oracles

Canonical health semantics for the first adapter:

```text
Comptroller account state
→ liquidity above liquidation threshold
→ shortfall below liquidation threshold
```

Kumo must preserve collateral-factor and liquidation-threshold distinctions. A UI `health factor/rate` may be derived later, but it cannot replace protocol-native liquidity/shortfall as the evidence claim.

Supplemental risk signals may include resilient-oracle/deviation-sentinel/paused-market state. They supplement deterministic solvency arithmetic; they do not replace it.

## Aave V3 BNB — Yield Scout

Protocol-maintained address registry:
https://github.com/aave-dao/aave-address-book/blob/main/src/AaveV3BNB.sol

Fetched current addresses include:

- PoolAddressesProvider `0xff75B6da14FfbbfD355Daf7a2731456b3562Ba6D`
- Pool `0x6807dc923806fE8Fd134338EABCA509979a7e0cB`
- Oracle `0x39bc1bfDa2130d6Bb6DBEfd366939b4c7aa7C697`
- ProtocolDataProvider `0xc90Df74A7c16245c5F5C5870327Ceb38Fe5d5328`

Yield Scout should derive executable net yield from reserve/account state and current entry/exit economics. Displayed APY is never accepted as a canonical action claim merely because an API returned it.

## Lista Lending — Yield Scout

Primary docs:

- https://docs.bsc.lista.org/lista-lending/smart-contract
- https://docs.bsc.lista.org/introduction/lista-lending/markets

Fetched current BNB deployment surface includes Moolah, VaultAllocator, liquidator/oracle adapters and asset-specific vaults. Because markets are permissionless/isolated, protocol identity is not enough: each candidate market/vault needs its own allowlist, liquidity, asset, oracle and exitability checks.

## 1inch Limit Order Protocol v4 — Grid Operator

Protocol repo:
https://github.com/1inch/limit-order-protocol

The upstream repo explicitly warns that `master` is work-in-progress and unaudited. Kumo's first Grid adapter therefore targets audited tag `4.3.2`, not `master`.

BSC Limit Order Protocol v4 / Router v6 shared deployment:
`0x111111125421cA6dc452d289314280a0f8842A65`

The protocol provides EIP-712 signed off-chain orders with onchain fills/cancellation state and supports range-order-like pricing extensions. This fits Grid Operator's explicit order/inventory state machine better than pretending an AMM rebalance is a grid.

## BNB Agent SDK / commerce boundary

Primary docs:
https://docs.bnbchain.org/developer-kit/bnbagent-sdk/security/

The SDK's SigningPolicy is a useful external precedent for Kumo's authority boundary: typed-data domains/types are policy-gated, broad Permit forms are denylisted by default, and scoped signer wrappers are preferred over exposing raw wallet authority to agent tools.

Kumo still keeps agent identity/hiring/payment separate from financial strategy authority.

## Cross-chain liquidity ingress

Primary docs:
https://docs.bnbchain.org/bnb-smart-chain/cross-chain-bridge/

Kumo models cross-chain liquidity as a provider-routed capability:

```text
source liquidity
→ route provider / solver / bridge
→ destination asset
→ BSC position action
```

The route itself has freshness, fee, slippage, timeout and settlement evidence. `bridge success` and `financial rescue success` remain different claims.
