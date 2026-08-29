import {
  applyPreparedActionSimulationReceipt,
  sealPreparedActionSimulationReceipt,
  type PreparedAction,
  type PreparedActionSimulationReceipt
} from "@kumo/financial-agent-kernel";

interface JsonRpcResponse<T> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface RpcBlock {
  number: string;
  hash: string;
}

interface RpcTransactionReceipt {
  transactionHash: string;
  blockNumber: string;
  status: string;
  gasUsed: string;
}

export interface AnvilPreparedActionCanaryOptions {
  forkRpcUrl: string;
  requestTimeoutMs?: number;
  receiptPollIntervalMs?: number;
  receiptTimeoutMs?: number;
  fundSignerForGas?: boolean;
  signerGasBalanceWei?: bigint;
  clock?: () => string;
  fetchImpl?: typeof fetch;
}

export interface AnvilPreparedActionCanaryResult {
  action: PreparedAction;
  receipt: PreparedActionSimulationReceipt;
}

function hexQuantity(value: bigint): string {
  if (value < 0n) throw new Error("ANVIL_NEGATIVE_QUANTITY");
  return `0x${value.toString(16)}`;
}

function parseQuantity(value: string): bigint {
  if (!/^0x[0-9a-fA-F]+$/.test(value)) throw new Error(`ANVIL_INVALID_QUANTITY:${value}`);
  return BigInt(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executes an exact PreparedAction against one mutable Anvil BSC fork.
 *
 * This is deliberately stateful: every call observes all prior call effects.
 * The fork is snapshotted before execution and reverted in finally, so the
 * simulation does not leave persistent local state behind. It never signs or
 * broadcasts to BSC mainnet.
 */
export class AnvilPreparedActionCanary {
  readonly id = "kumo-anvil-stateful-prepared-action-canary-v1";
  private readonly fetchImpl: typeof fetch;
  private readonly clock: () => string;
  private readonly requestTimeoutMs: number;
  private readonly receiptPollIntervalMs: number;
  private readonly receiptTimeoutMs: number;
  private rpcId = 1;

  constructor(private readonly options: AnvilPreparedActionCanaryOptions) {
    if (!options.forkRpcUrl) throw new Error("ANVIL_FORK_RPC_URL_REQUIRED");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
    this.receiptPollIntervalMs = options.receiptPollIntervalMs ?? 100;
    this.receiptTimeoutMs = options.receiptTimeoutMs ?? 20_000;
  }

  async run(action: PreparedAction): Promise<AnvilPreparedActionCanaryResult> {
    if (action.executionChainId !== 56) throw new Error(`ANVIL_CANARY_WRONG_ACTION_CHAIN:${action.executionChainId}`);
    if (action.calls.length === 0) throw new Error("ANVIL_CANARY_ACTION_CALLS_REQUIRED");
    if (!action.calls.every((call, index) => call.order === index)) throw new Error("ANVIL_CANARY_CALL_ORDER_INVALID");

    const chainIdHex = await this.rpc<string>("eth_chainId", []);
    const chainId = Number(parseQuantity(chainIdHex));
    if (chainId !== action.executionChainId) throw new Error(`ANVIL_CANARY_FORK_CHAIN_MISMATCH:${chainId}`);

    const forkBlock = await this.rpc<RpcBlock>("eth_getBlockByNumber", ["latest", false]);
    if (!forkBlock?.number || !forkBlock.hash) throw new Error("ANVIL_CANARY_FORK_BLOCK_IDENTITY_REQUIRED");
    const snapshotId = await this.rpc<string>("evm_snapshot", []);
    if (!snapshotId) throw new Error("ANVIL_CANARY_SNAPSHOT_FAILED");

    const callResults: PreparedActionSimulationReceipt["callResults"] = [];
    const evidenceRefs: string[] = [
      `anvil:bsc-fork:block:${parseQuantity(forkBlock.number).toString()}:${forkBlock.hash}`,
      `prepared-action:${action.id}`,
      `authorization-commitment:${action.authorizationCommitment}`
    ];
    let passed = true;
    let failureReason: string | undefined;

    try {
      await this.rpc<null>("anvil_impersonateAccount", [action.signer]);
      if (this.options.fundSignerForGas ?? true) {
        const balance = this.options.signerGasBalanceWei ?? 10n ** 20n;
        await this.rpc<null>("anvil_setBalance", [action.signer, hexQuantity(balance)]);
      }

      for (const call of action.calls) {
        try {
          const transactionHash = await this.rpc<string>("eth_sendTransaction", [{
            from: action.signer,
            to: call.to,
            data: call.data,
            value: hexQuantity(BigInt(call.value))
          }]);
          const txReceipt = await this.waitForReceipt(transactionHash);
          const callPassed = parseQuantity(txReceipt.status) === 1n;
          callResults.push({
            order: call.order,
            passed: callPassed,
            transactionHash: txReceipt.transactionHash,
            gasUsed: parseQuantity(txReceipt.gasUsed).toString(),
            ...(!callPassed ? { failureReason: "TRANSACTION_STATUS_REVERTED" } : {})
          });
          evidenceRefs.push(`anvil:tx:${txReceipt.transactionHash}`);
          if (!callPassed) {
            passed = false;
            failureReason = `CALL_${call.order}_REVERTED`;
            break;
          }
        } catch (error) {
          passed = false;
          failureReason = error instanceof Error ? error.message : String(error);
          callResults.push({
            order: call.order,
            passed: false,
            failureReason
          });
          break;
        }
      }
    } finally {
      try {
        await this.rpc<null>("anvil_stopImpersonatingAccount", [action.signer]);
      } catch {
        // Fork cleanup continues through snapshot revert even if Anvil no longer
        // considers the account impersonated.
      }
      const reverted = await this.rpc<boolean>("evm_revert", [snapshotId]);
      if (!reverted) throw new Error("ANVIL_CANARY_SNAPSHOT_REVERT_FAILED");
    }

    for (let index = callResults.length; index < action.calls.length; index += 1) {
      callResults.push({
        order: index,
        passed: false,
        failureReason: `NOT_EXECUTED_AFTER_PRIOR_FAILURE:${failureReason ?? "UNKNOWN"}`
      });
    }

    const simulatedAt = this.clock();
    const receipt = sealPreparedActionSimulationReceipt({
      schemaVersion: "kumo-prepared-action-simulation-v1",
      id: `simulation:${action.id}:anvil:${parseQuantity(forkBlock.number).toString()}`,
      actionId: action.id,
      authorizationCommitment: action.authorizationCommitment,
      executionChainId: action.executionChainId,
      simulationKind: "STATEFUL_FORK",
      engine: "ANVIL_STATEFUL_BSC_FORK_RPC_V1",
      simulatedAt,
      forkBlockNumber: parseQuantity(forkBlock.number).toString(),
      forkBlockHash: forkBlock.hash,
      passed,
      callResults,
      evidenceRefs
    });

    if (!passed) {
      return { action: { ...action, simulationStatus: "FAILED" }, receipt };
    }
    return {
      action: applyPreparedActionSimulationReceipt(action, receipt),
      receipt
    };
  }

  private async waitForReceipt(transactionHash: string): Promise<RpcTransactionReceipt> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < this.receiptTimeoutMs) {
      const receipt = await this.rpc<RpcTransactionReceipt | null>("eth_getTransactionReceipt", [transactionHash]);
      if (receipt) return receipt;
      await sleep(this.receiptPollIntervalMs);
    }
    throw new Error(`ANVIL_CANARY_RECEIPT_TIMEOUT:${transactionHash}`);
  }

  private async rpc<T>(method: string, params: unknown[]): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.fetchImpl(this.options.forkRpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: this.rpcId++, method, params }),
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`ANVIL_RPC_HTTP_${response.status}:${method}`);
      const payload = await response.json() as JsonRpcResponse<T>;
      if (payload.error) throw new Error(`ANVIL_RPC_ERROR:${method}:${payload.error.code}:${payload.error.message}`);
      if (payload.result === undefined) throw new Error(`ANVIL_RPC_RESULT_MISSING:${method}`);
      return payload.result;
    } finally {
      clearTimeout(timeout);
    }
  }
}
