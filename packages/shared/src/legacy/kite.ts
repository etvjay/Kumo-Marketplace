// Legacy compatibility boundary for the original Kite-target Kumo implementation.
// Do not add new BNB functionality to this module.

export const KUMO_KITE_BASELINE = {
  repository: "Jaydearcadian/Kumo",
  commit: "0dd10a040d38f7e06434f09d2b5c5a647e72935f",
  chainId: 2368
} as const;

export interface LegacyKiteIdentityMetadata {
  kitePassportId?: string;
  kitePassportWallet?: string;
  aaVaultAddress?: string;
  relayUrl?: string;
}
