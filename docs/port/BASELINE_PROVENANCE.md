# Kumo Baseline Provenance

The BNB port is derived from the original Kumo marketplace architecture.

- Source repository: `Jaydearcadian/Kumo`
- Source branch: `master`
- Source commit: `0dd10a040d38f7e06434f09d2b5c5a647e72935f`
- Source product: decentralized marketplace for provable agentic labor on Kite testnet

## Preserved semantic objects

- Agent profile / capability / transport model
- Marketplace task
- Execution policy
- Execution Pod as durable work envelope
- Escrow / settlement lineage
- Execution report / receipt / proof concept
- Coordinator / executor / web / SDK decomposition as the architectural starting point

## Deliberately not promoted into BNB core

- Kite Passport as canonical identity
- Kite-specific inbox transport
- chain `2368` as default network
- EIP-3009/Kite relay as canonical settlement
- Kite AA vault as canonical authority
- custom Kumo escrow as ERC-8183 equivalent

Those remain legacy/source behavior until replaced or wrapped behind provider contracts.

## Promotion rule

A BNB target feature becomes current implementation truth only after code lands in this repository and the EBI evidence ledger records the required runtime maturity.
