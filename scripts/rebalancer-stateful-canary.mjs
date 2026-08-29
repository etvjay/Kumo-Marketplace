import fs from "node:fs/promises";
import path from "node:path";
import { AnvilPreparedActionCanary } from "../packages/adapters/dist/index.js";

const inputPath = process.env.KUMO_PREPARED_ACTION_PATH;
const forkRpcUrl = process.env.KUMO_ANVIL_FORK_RPC_URL;
const outputPath = process.env.KUMO_SIMULATION_EVIDENCE_PATH || "evidence/live/rebalancer-stateful-canary.json";

if (!inputPath) throw new Error("KUMO_PREPARED_ACTION_PATH_REQUIRED");
if (!forkRpcUrl) throw new Error("KUMO_ANVIL_FORK_RPC_URL_REQUIRED");

const source = JSON.parse(await fs.readFile(inputPath, "utf8"));
const action = source.preparedAction ?? source.action ?? source;
if (!action?.authorizationCommitment || !Array.isArray(action.calls)) {
  throw new Error("PREPARED_ACTION_ARTIFACT_INVALID");
}

const canary = new AnvilPreparedActionCanary({
  forkRpcUrl,
  fundSignerForGas: true
});
const result = await canary.run(action);
const output = {
  schemaVersion: "kumo-rebalancer-stateful-canary-artifact-v1",
  generatedAt: new Date().toISOString(),
  classification: "STATEFUL_LOCAL_FORK_SIMULATION_NOT_LIVE_BSC_EXECUTION",
  status: result.receipt.passed ? "STATEFUL_FORK_CANARY_PASS" : "STATEFUL_FORK_CANARY_FAIL",
  sourceActionId: action.id,
  authorizationCommitment: action.authorizationCommitment,
  promotedSimulationStatus: result.action.simulationStatus,
  simulationReceipt: result.receipt,
  limitations: [
    "This executes only against the supplied Anvil fork RPC; it does not broadcast to BSC mainnet.",
    "The signer is impersonated on the local fork and may be given simulated BNB for gas; this creates no real authority or funds.",
    "A passing receipt is only valid for the exact authorization commitment and must still survive fresh semantic drift validation before an Altana session is granted."
  ]
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify(output, null, 2));
if (!result.receipt.passed) process.exitCode = 1;
