export const PANCAKESWAP_V3_BSC = {
  chainId: 56,
  factory: "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865",
  nonfungiblePositionManager: "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364",
  smartRouter: "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4"
} as const;

/**
 * These addresses are configuration constants for the first BSC adapter.
 * Before execution, the live adapter must verify code identity/network and
 * refuse if the configured deployment no longer matches expected code.
 */
