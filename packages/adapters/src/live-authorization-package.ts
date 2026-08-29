import {
  executableQuoteSchema,
  observationSnapshotSchema,
  preparedActionSchema,
  preparedActionSimulationReceiptSchema,
  strategyProposalSchema,
  type ExecutableQuote,
  type ObservationSnapshot,
  type PreparedAction,
  type PreparedActionSimulationReceipt,
  type StrategyProposal
} from "@kumo/financial-agent-kernel";

export interface LiveRebalancerAuthorizationPackage {
  baseAction: PreparedAction;
  proposal: StrategyProposal;
  quote: ExecutableQuote;
  previousObservation: ObservationSnapshot;
  simulationReceipt: PreparedActionSimulationReceipt;
  positionId: string;
}

export function parseLiveRebalancerAuthorizationPackage(input: {
  authorizationArtifact: unknown;
  simulationArtifact: unknown;
}): LiveRebalancerAuthorizationPackage {
  if (!input.authorizationArtifact || typeof input.authorizationArtifact !== "object") {
    throw new Error("AUTHORIZATION_PACKAGE_OBJECT_REQUIRED");
  }
  if (!input.simulationArtifact || typeof input.simulationArtifact !== "object") {
    throw new Error("SIMULATION_ARTIFACT_OBJECT_REQUIRED");
  }

  const authorizationArtifact = input.authorizationArtifact as Record<string, unknown>;
  const simulationArtifact = input.simulationArtifact as Record<string, unknown>;
  const actionCandidate = authorizationArtifact.preparedAction ?? authorizationArtifact.action;
  const proposalCandidate = authorizationArtifact.proposal;
  const quoteCandidate = authorizationArtifact.quote;
  const observationCandidate = authorizationArtifact.previousObservation ?? authorizationArtifact.observation;
  const simulationCandidate = simulationArtifact.simulationReceipt ?? authorizationArtifact.simulationReceipt;

  if (!actionCandidate || !proposalCandidate || !quoteCandidate || !observationCandidate || !simulationCandidate) {
    throw new Error("AUTHORIZATION_PACKAGE_REQUIRES_ACTION_PROPOSAL_QUOTE_PREVIOUS_OBSERVATION_AND_SIMULATION_RECEIPT");
  }

  const baseAction = preparedActionSchema.parse(actionCandidate);
  const proposal = strategyProposalSchema.parse(proposalCandidate);
  const quote = executableQuoteSchema.parse(quoteCandidate);
  const previousObservation = observationSnapshotSchema.parse(observationCandidate);
  const simulationReceipt = preparedActionSimulationReceiptSchema.parse(simulationCandidate);

  if (!baseAction.quoteId) throw new Error("LIVE_EXECUTION_REQUIRES_BOUND_EXECUTABLE_QUOTE_ID");
  if (quote.id !== baseAction.quoteId) throw new Error("LIVE_EXECUTION_QUOTE_ID_MISMATCH");
  if (quote.proposalId !== proposal.id || baseAction.proposalId !== proposal.id) throw new Error("LIVE_EXECUTION_PROPOSAL_LINEAGE_MISMATCH");
  if (quote.chainId !== baseAction.executionChainId) throw new Error("LIVE_EXECUTION_QUOTE_CHAIN_MISMATCH");
  if (quote.marketSnapshotRoot !== proposal.marketSnapshotRoot || baseAction.marketSnapshotRoot !== proposal.marketSnapshotRoot) {
    throw new Error("LIVE_EXECUTION_MARKET_ROOT_LINEAGE_MISMATCH");
  }
  if (baseAction.evidenceSnapshotRoot !== proposal.evidenceSnapshotRoot) throw new Error("LIVE_EXECUTION_EVIDENCE_ROOT_LINEAGE_MISMATCH");
  if (previousObservation.marketSnapshotRoot !== proposal.marketSnapshotRoot) throw new Error("LIVE_EXECUTION_PRIOR_OBSERVATION_ROOT_MISMATCH");
  if (previousObservation.agentId !== proposal.agentId || previousObservation.category !== proposal.category) {
    throw new Error("LIVE_EXECUTION_PRIOR_OBSERVATION_IDENTITY_MISMATCH");
  }
  if (proposal.disposition !== "propose") throw new Error("LIVE_EXECUTION_REQUIRES_STRATEGY_PROPOSAL");
  if (baseAction.executionChainId !== 56 || quote.chainId !== 56 || previousObservation.chainId !== 56) {
    throw new Error("LIVE_EXECUTION_REQUIRES_BSC_MAINNET_LINEAGE");
  }

  const explicitPositionId = authorizationArtifact.positionId;
  const observedPositionId = previousObservation.values.positionId;
  const positionId = typeof explicitPositionId === "string" ? explicitPositionId : observedPositionId;
  if (typeof positionId !== "string" || positionId.length === 0) throw new Error("LIVE_EXECUTION_POSITION_ID_REQUIRED");
  if (observedPositionId !== positionId) throw new Error("LIVE_EXECUTION_POSITION_ID_LINEAGE_MISMATCH");

  return { baseAction, proposal, quote, previousObservation, simulationReceipt, positionId };
}
