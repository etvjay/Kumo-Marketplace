import fs from "node:fs/promises";
import path from "node:path";
import {
  VenusCorePoolReader,
  deriveVenusNativeLiquidationBuffer,
  reconstructVenusAccountLiquidity
} from "../packages/reference-agents/dist/health/index.js";

const rpcUrl = process.env.BSC_RPC_URL || "https://bsc-dataseed.bnbchain.org";
const account = process.env.VENUS_LIQUIDITY_ACCOUNT || "0x9FBd07c1db2a93b1BB079C6c958DF374EF93fFd9";
const outputPath = process.env.KUMO_EVIDENCE_PATH || "evidence/live/venus-liquidity-live-probe.json";
if (!/^0x[0-9a-fA-F]{40}$/.test(account)) throw new Error("VENUS_LIQUIDITY_ACCOUNT_INVALID");

const generatedAt = new Date().toISOString();
const rpcProviderId = new URL(rpcUrl).hostname;
const reader = new VenusCorePoolReader({ rpcUrl, rpcProviderId, purpose: "evidence" });
const state = await reader.readAccount(account);
const reconstruction = reconstructVenusAccountLiquidity(state);
const liquidationBuffer = deriveVenusNativeLiquidationBuffer(reconstruction);
const debtMarkets = state.activeMarkets.filter((market) => market.borrowBalance > 0n).length;
const currentDebtObserved = debtMarkets > 0;

const debtSemanticsConsistent = currentDebtObserved
  ? liquidationBuffer.state !== "NO_DEBT"
  : liquidationBuffer.state === "NO_DEBT" && liquidationBuffer.liquidationBufferBpsOfBorrow === null;

const passed = state.snapshot.blockTag === "finalized"
  && reconstruction.exactNativeMatch
  && reconstruction.liquidityDelta === 0n
  && reconstruction.shortfallDelta === 0n
  && debtSemanticsConsistent;

const output = {
  schemaVersion: "kumo-venus-liquidity-live-probe-v2",
  generatedAt,
  classification: "LIVE_READ_ONLY_PROTOCOL_ARITHMETIC_PROBE",
  ownershipClaim: "NONE_PUBLIC_CHAIN_ACCOUNT_ONLY",
  borrowerRiskClaim: currentDebtObserved ? "CURRENT_DEBT_OBSERVED" : "NONE_COLLATERAL_ONLY_OR_NO_DEBT",
  account,
  rpcProviderId,
  finalizedBlock: {
    number: state.snapshot.blockNumber,
    hash: state.snapshot.blockHash,
    timestamp: state.snapshot.blockTimestamp
  },
  native: {
    liquidity: state.accountLiquidity,
    shortfall: state.accountShortfall,
    solvencyStatus: state.nativeSolvencyStatus
  },
  reconstruction,
  liquidationBuffer,
  invariants: {
    finalized: state.snapshot.blockTag === "finalized",
    exactNativeMatch: reconstruction.exactNativeMatch,
    zeroLiquidityDelta: reconstruction.liquidityDelta === 0n,
    zeroShortfallDelta: reconstruction.shortfallDelta === 0n,
    currentDebtObserved,
    debtSemanticsConsistent,
    noDebtDoesNotInventBorrowBuffer: currentDebtObserved || liquidationBuffer.liquidationBufferBpsOfBorrow === null,
    passed
  }
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
const json = JSON.stringify(output, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2);
await fs.writeFile(outputPath, `${json}\n`, "utf8");
console.log(json);
if (!passed) process.exitCode = 1;
