import fs from "node:fs/promises";
import path from "node:path";
import {
  applyPreparedActionSimulationReceipt
} from "../packages/financial-agent-kernel/dist/index.js";
import {
  AltanaSdkSessionRuntime,
  buildAltanaSessionBlueprint,
  grantAltanaAuthority
} from "../packages/adapters/dist/index.js";
import {
  ChainlinkBscUsdPriceProvider,
  GeckoTerminalBscMarketDataProvider,
  PancakeV3BscReader,
  refreshPancakeV3AuthorizationState
} from "../packages/reference-agents/dist/rebalancer/index.js";

const privateKey = process.env.KUMO_ALTANA_ADMIN_PRIVATE_KEY;
const rpcUrl = process.env.BSC_RPC_URL;
const packagePath = process.env.KUMO_AUTHORIZATION_PACKAGE_PATH;
const simulationPath = process.env.KUMO_SIMULATION_EVIDENCE_PATH;
const outputPath = process.env.KUMO_EXECUTION_EVIDENCE_PATH || "evidence/live/rebalancer-altana-execution.json";

if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error("KUMO_ALTANA_ADMIN_PRIVATE_KEY_REQUIRED_AS_32_BYTE_HEX");
if (!rpcUrl) throw new Error("BSC_RPC_URL_REQUIRED");
if (!packagePath) throw new Error("KUMO_AUTHORIZATION_PACKAGE_PATH_REQUIRED");
if (!simulationPath) throw new Error("KUMO_SIMULATION_EVIDENCE_PATH_REQUIRED");

function safeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.split(privateKey).join("[REDACTED]");
}

const authorizationPackage = JSON.parse(await fs.readFile(packagePath, "utf8"));
const simulationArtifact = JSON.parse(await fs.readFile(simulationPath, "utf8"));
const baseAction = authorizationPackage.preparedAction ?? authorizationPackage.action;
const proposal = authorizationPackage.proposal;
const quote = authorizationPackage.quote;
const previousObservation = authorizationPackage.previousObservation ?? authorizationPackage.observation;
const simulationReceipt = simulationArtifact.simulationReceipt ?? authorizationPackage.simulationReceipt;
if (!baseAction || !proposal || !quote || !previousObservation || !simulationReceipt) {
  throw new Error("AUTHORIZATION_PACKAGE_REQUIRES_ACTION_PROPOSAL_QUOTE_PREVIOUS_OBSERVATION_AND_SIMULATION_RECEIPT");
}
if (!baseAction.quoteId) throw new Error("LIVE_EXECUTION_REQUIRES_BOUND_EXECUTABLE_QUOTE_ID");
if (quote.id !== baseAction.quoteId) throw new Error("LIVE_EXECUTION_QUOTE_ID_MISMATCH");
if (proposal.disposition !== "propose") throw new Error("LIVE_EXECUTION_REQUIRES_STRATEGY_PROPOSAL");

const action = applyPreparedActionSimulationReceipt(baseAction, simulationReceipt);
const runtime = new AltanaSdkSessionRuntime({ adminPrivateKey: privateKey, network: "mainnet" });
const walletAddress = await runtime.getWalletAddress();
if (action.signer.toLowerCase() !== walletAddress.toLowerCase()) throw new Error("LIVE_EXECUTION_ACTION_SIGNER_NOT_ALTANA_WALLET");

const rpcProviderId = new URL(rpcUrl).hostname;
const reader = new PancakeV3BscReader({ rpcUrl, rpcProviderId, purpose: "evidence" });
const priceProvider = new ChainlinkBscUsdPriceProvider({ rpcUrl, rpcProviderId });
const marketDataProvider = new GeckoTerminalBscMarketDataProvider();
const tokenId = authorizationPackage.positionId ?? previousObservation.values?.positionId;
if (typeof tokenId !== "string" || tokenId.length === 0) throw new Error("LIVE_EXECUTION_POSITION_ID_REQUIRED");

const output = {
  schemaVersion: "kumo-rebalancer-altana-live-execution-v1",
  generatedAt: new Date().toISOString(),
  classification: "LIVE_EXECUTION_ATTEMPT",
  status: "STARTED",
  walletAddress,
  positionId: tokenId,
  authorizationCommitment: action.authorizationCommitment,
  simulationReceiptCommitment: simulationReceipt.receiptCommitment,
  refresh: undefined,
  authority: undefined,
  execution: undefined,
  revocation: undefined,
  errors: [],
  privateKeyPersisted: false,
  sessionPrivateKeyPersisted: false
};

let authorityReceipt;
try {
  const refresh = await refreshPancakeV3AuthorizationState({
    tokenId,
    expectedOwner: walletAddress,
    agentId: proposal.agentId,
    previousObservation,
    proposal,
    quote,
    reader,
    priceProvider,
    marketDataProvider
  });
  output.refresh = {
    marketDrift: refresh.marketDrift,
    refreshedObservation: refresh.refreshedObservation,
    owner: refresh.prepared.snapshot.owner,
    blockNumber: refresh.prepared.snapshot.blockNumber.toString(),
    blockHash: refresh.prepared.snapshot.blockHash
  };
  if (refresh.marketDrift.drifted) throw new Error(`LIVE_EXECUTION_MARKET_DRIFT:${refresh.marketDrift.reasons.join(",")}`);

  const now = new Date().toISOString();
  const blueprint = buildAltanaSessionBlueprint({
    action,
    proposal,
    quote,
    marketDrift: refresh.marketDrift,
    simulationReceipt,
    now,
    altanaWalletAddress: walletAddress
  });
  authorityReceipt = await grantAltanaAuthority({ blueprint, port: runtime });
  output.authority = authorityReceipt;
  if (!authorityReceipt.grantTransactionHash) throw new Error("ALTANA_LIVE_GRANT_TRANSACTION_HASH_REQUIRED");

  const execution = await runtime.executePreparedAction({
    authorityRef: authorityReceipt.authorityRef,
    action
  });
  output.execution = execution;
  if (execution.status !== "CONFIRMED") throw new Error(`ALTANA_EXECUTION_NOT_CONFIRMED:${execution.status}`);
  if (!execution.transactionHash) throw new Error("ALTANA_EXECUTION_TRANSACTION_HASH_REQUIRED");
  output.status = "LIVE_EXECUTION_CONFIRMED_PENDING_REVOCATION";
} catch (error) {
  output.errors.push(safeError(error));
  output.status = "LIVE_EXECUTION_FAILED";
  process.exitCode = 1;
} finally {
  if (authorityReceipt?.authorityRef) {
    try {
      const revocation = await runtime.revokeAuthority(authorityReceipt.authorityRef);
      output.revocation = revocation;
      if (revocation.status !== "CONFIRMED" || !revocation.transactionHash) {
        output.errors.push(`ALTANA_REVOCATION_NOT_CONFIRMED:${revocation.status}`);
        output.status = "LIVE_EXECUTION_REVOCATION_UNVERIFIED";
        process.exitCode = 1;
      } else if (output.execution?.status === "CONFIRMED") {
        output.status = "LIVE_EXECUTION_AND_REVOCATION_CONFIRMED";
        output.classification = "LIVE_ALTANA_BNB_EXECUTION_EVIDENCE";
      }
    } catch (error) {
      output.errors.push(`ALTANA_REVOCATION_FAILED:${safeError(error)}`);
      output.status = "LIVE_EXECUTION_REVOCATION_FAILED";
      process.exitCode = 1;
    }
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(output, null, 2));
}
