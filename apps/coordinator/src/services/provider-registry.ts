import type {
  AuthorityProvider,
  DiscoveryProvider,
  HiringProvider,
  IdentityProvider,
  LivenessProvider,
  OutcomeVerifier,
  SettlementProvider,
  TransportProvider
} from "@kumo/shared";

export interface KumoProviders {
  identity: IdentityProvider;
  discovery: DiscoveryProvider;
  liveness: LivenessProvider;
  transport: TransportProvider;
  authority: AuthorityProvider;
  hiring: HiringProvider;
  settlement: SettlementProvider;
  outcome: OutcomeVerifier;
}

export function assertProviderSet(providers: Partial<KumoProviders>): asserts providers is KumoProviders {
  const required: Array<keyof KumoProviders> = [
    "identity",
    "discovery",
    "liveness",
    "transport",
    "authority",
    "hiring",
    "settlement",
    "outcome"
  ];
  const missing = required.filter((key) => !providers[key]);
  if (missing.length) {
    throw new Error(`Kumo provider set incomplete: ${missing.join(", ")}`);
  }
}
