export const PANCAKESWAP_V3_BSC = {
  chainId: 56,
  factory: "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865",
  nonfungiblePositionManager: "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364",

  // Compatibility only. Do not select this legacy router for new execution
  // merely because older Kumo code referenced it.
  legacySmartRouter: "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4",
  smartRouter: "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4",

  // Current PancakeSwap deployment surfaces fetched 2026-08-26.
  v3UniversalRouter: "0x1A0A18AC4BECDDbd6389559687d1A73d8927E416",
  infinityUniversalRouter: "0xd9C500DfF816a1Da21A48A732d3498Bf09dc9AEB",
  permit2: "0x31c2F6fcFf4F8759b3Bd5Bf0e1084A055615c768"
} as const;

/**
 * Addresses are configuration inputs, not sufficient identity proof.
 * Consequential reads/execution must bind chain + address + bytecode evidence
 * at a concrete block before the deployment is trusted.
 */
