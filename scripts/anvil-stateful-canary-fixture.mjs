import fs from "node:fs/promises";
import { AnvilPreparedActionCanary } from "../packages/adapters/dist/index.js";

const evidencePath = process.env.KUMO_EVIDENCE_PATH || "evidence/fixtures/rebalancer-prepared-action.json";
const artifact = JSON.parse(await fs.readFile(evidencePath, "utf8"));
const action = artifact.preparedAction;
if (!action) throw new Error("PREPARED_ACTION_FIXTURE_REQUIRED");

function response(result) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function makeMockFork({ failAt } = {}) {
  const methods = [];
  const sent = [];
  let txIndex = 0;
  const receipts = new Map();

  const fetchImpl = async (_url, init) => {
    const request = JSON.parse(init.body);
    methods.push(request.method);
    switch (request.method) {
      case "eth_chainId":
        return response("0x38");
      case "eth_getBlockByNumber":
        return response({
          number: "0x7123456",
          hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        });
      case "evm_snapshot":
        return response("0x1");
      case "anvil_impersonateAccount":
        if (request.params[0].toLowerCase() !== action.signer.toLowerCase()) throw new Error("MOCK_BAD_IMPERSONATION");
        return response(null);
      case "anvil_setBalance":
        if (request.params[0].toLowerCase() !== action.signer.toLowerCase()) throw new Error("MOCK_BAD_BALANCE_TARGET");
        return response(null);
      case "eth_sendTransaction": {
        const tx = request.params[0];
        const expected = action.calls[txIndex];
        if (!expected) throw new Error("MOCK_EXTRA_TRANSACTION");
        if (tx.from.toLowerCase() !== action.signer.toLowerCase()) throw new Error("MOCK_BAD_FROM");
        if (tx.to.toLowerCase() !== expected.to.toLowerCase()) throw new Error(`MOCK_BAD_TO:${txIndex}`);
        if (tx.data.toLowerCase() !== expected.data.toLowerCase()) throw new Error(`MOCK_BAD_DATA:${txIndex}`);
        const hash = `0x${(txIndex + 1).toString(16).padStart(64, "0")}`;
        const failed = failAt === txIndex;
        receipts.set(hash, {
          transactionHash: hash,
          blockNumber: "0x7123457",
          status: failed ? "0x0" : "0x1",
          gasUsed: "0x186a0"
        });
        sent.push(txIndex);
        txIndex += 1;
        return response(hash);
      }
      case "eth_getTransactionReceipt":
        return response(receipts.get(request.params[0]) ?? null);
      case "anvil_stopImpersonatingAccount":
        return response(null);
      case "evm_revert":
        return response(true);
      default:
        throw new Error(`MOCK_UNEXPECTED_RPC:${request.method}`);
    }
  };

  return { fetchImpl, methods, sent };
}

const passMock = makeMockFork();
const passCanary = new AnvilPreparedActionCanary({
  forkRpcUrl: "http://mock-anvil.local",
  fetchImpl: passMock.fetchImpl,
  clock: () => "2026-08-29T05:00:01.000Z",
  receiptPollIntervalMs: 1,
  receiptTimeoutMs: 100
});
const passResult = await passCanary.run(action);

const failAt = 3;
const failMock = makeMockFork({ failAt });
const failCanary = new AnvilPreparedActionCanary({
  forkRpcUrl: "http://mock-anvil.local",
  fetchImpl: failMock.fetchImpl,
  clock: () => "2026-08-29T05:00:01.000Z",
  receiptPollIntervalMs: 1,
  receiptTimeoutMs: 100
});
const failResult = await failCanary.run(action);

const passSequence = [
  "eth_chainId",
  "eth_getBlockByNumber",
  "evm_snapshot",
  "anvil_impersonateAccount",
  "anvil_setBalance",
  ...action.calls.flatMap(() => ["eth_sendTransaction", "eth_getTransactionReceipt"]),
  "anvil_stopImpersonatingAccount",
  "evm_revert"
];
const sequenceExact = JSON.stringify(passMock.methods) === JSON.stringify(passSequence);
const allCallsExecuted = passMock.sent.length === action.calls.length;
const passReceiptBound = passResult.receipt.actionId === action.id
  && passResult.receipt.authorizationCommitment === action.authorizationCommitment
  && passResult.receipt.executionChainId === 56
  && passResult.receipt.simulationKind === "STATEFUL_FORK"
  && passResult.receipt.engine === "ANVIL_STATEFUL_BSC_FORK_RPC_V1";
const passPromoted = passResult.receipt.passed && passResult.action.simulationStatus === "PASSED";
const passCallsComplete = passResult.receipt.callResults.length === action.calls.length
  && passResult.receipt.callResults.every((result, index) => result.order === index && result.passed);
const cleanupGuaranteed = passMock.methods.at(-2) === "anvil_stopImpersonatingAccount"
  && passMock.methods.at(-1) === "evm_revert";

const failedStopped = failMock.sent.length === failAt + 1;
const failedReceipt = !failResult.receipt.passed
  && failResult.action.simulationStatus === "FAILED"
  && failResult.receipt.callResults[failAt]?.passed === false
  && failResult.receipt.callResults.slice(failAt + 1).every((result) => !result.passed && result.failureReason?.startsWith("NOT_EXECUTED_AFTER_PRIOR_FAILURE:"));
const failedCleanup = failMock.methods.at(-2) === "anvil_stopImpersonatingAccount"
  && failMock.methods.at(-1) === "evm_revert";

const passed = sequenceExact && allCallsExecuted && passReceiptBound && passPromoted && passCallsComplete
  && cleanupGuaranteed && failedStopped && failedReceipt && failedCleanup;

console.log(JSON.stringify({
  schemaVersion: "kumo-anvil-stateful-canary-fixture-v1",
  classification: "MOCK_RPC_FIXTURE_NOT_STATEFUL_FORK_EVIDENCE",
  status: passed ? "ANVIL_CANARY_FIXTURE_PASS" : "ANVIL_CANARY_FIXTURE_FAIL",
  invariants: {
    sequenceExact,
    allCallsExecuted,
    passReceiptBound,
    passPromoted,
    passCallsComplete,
    cleanupGuaranteed,
    failedStopped,
    failedReceipt,
    failedCleanup,
    passed
  },
  pass: {
    rpcMethods: passMock.methods,
    callsExecuted: passMock.sent.length,
    receiptCommitment: passResult.receipt.receiptCommitment
  },
  failure: {
    failAt,
    callsExecuted: failMock.sent.length,
    callResults: failResult.receipt.callResults
  }
}, null, 2));
if (!passed) process.exitCode = 1;
