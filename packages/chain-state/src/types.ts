export const EVM_BLOCK_TAGS = ["latest", "safe", "finalized"] as const;
export type EvmBlockTag = (typeof EVM_BLOCK_TAGS)[number];

export const OBSERVATION_PURPOSES = ["evidence", "execution", "outcome"] as const;
export type ObservationPurpose = (typeof OBSERVATION_PURPOSES)[number];

export interface ChainSnapshot {
  chainId: number;
  purpose: ObservationPurpose;
  blockTag: EvmBlockTag;
  blockNumber: string;
  blockHash: string;
  blockTimestamp: number;
  observedAt: string;
  rpcProviderId: string;
}

export interface StateReadPolicy {
  purpose: ObservationPurpose;
  blockTag: EvmBlockTag;
  maxAgeMs: number;
  requireSameChain: boolean;
  requireSameBlock: boolean;
  requireBlockHash: boolean;
}

export interface StateCoherenceIssue {
  code: string;
  detail: string;
}

export interface StateCoherenceResult {
  coherent: boolean;
  issues: StateCoherenceIssue[];
}

export interface ContractIdentityExpectation {
  chainId: number;
  address: string;
  label: string;
  expectedCodeHash?: string;
  sourceRef: string;
  version?: string;
}

export interface ContractIdentityObservation {
  chainId: number;
  address: string;
  bytecodePresent: boolean;
  observedCodeHash?: string;
  snapshot: ChainSnapshot;
}

export interface ContractIdentityResult {
  valid: boolean;
  reasons: string[];
}

export interface ProtocolStateRead<TState> {
  adapterId: string;
  protocol: string;
  subjectRef: string;
  snapshot: ChainSnapshot;
  state: TState;
  evidenceRefs: string[];
  contractIdentityRefs: string[];
}

export interface ProtocolStateAdapter<TSubject, TState> {
  readonly id: string;
  readonly protocol: string;
  readonly chainId: number;
  read(input: {
    subject: TSubject;
    purpose: ObservationPurpose;
    policy?: StateReadPolicy;
  }): Promise<ProtocolStateRead<TState>>;
}
