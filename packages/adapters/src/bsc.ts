export const BSC_MAINNET_CHAIN_ID = 56 as const;
export const BSC_TESTNET_CHAIN_ID = 97 as const;

export type BscChainId = typeof BSC_MAINNET_CHAIN_ID | typeof BSC_TESTNET_CHAIN_ID;

export function isBscChainId(value: number): value is BscChainId {
  return value === BSC_MAINNET_CHAIN_ID || value === BSC_TESTNET_CHAIN_ID;
}
