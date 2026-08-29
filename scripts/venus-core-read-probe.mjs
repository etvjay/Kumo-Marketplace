import fs from "node:fs/promises";
import path from "node:path";
import { VenusCorePoolReader } from "../packages/reference-agents/dist/health/index.js";

const rpcUrl = process.env.BSC_RPC_URL || "https://bsc-dataseed.bnbchain.org";
const account = process.env.VENUS_PROBE_ACCOUNT || "0x0000000000000000000000000000000000000000";
const outputPath = process.env.KUMO_EVIDENCE_PATH || "evidence/live/venus-core-read-probe.json";
const rpcProviderId = new URL(rpcUrl).hostname;

const output = {
  schemaVersion: "kumo-venus-core-read-probe-v1",
  generatedAt: new Date().toISOString(),
  classification: "LIVE_READ_ONLY_PROTOCOL_PROBE",
  targetRole: account === "0x0000000000000000000000000000000000000000" ? "ZERO_ADDRESS_ABI_COHERENCE_TARGET" : "EXPLICIT_PUBLIC_ACCOUNT_TARGET",
  status: "STARTED",
  account,
  rpcProviderId,
  state: undefined,
  invariants: undefined,
  errors: []
};

try {
  const reader = new VenusCorePoolReader({ rpcUrl, rpcProviderId, purpose: "evidence" });
  const state = await reader.readAccount(account);
  const everyActiveMarketRelevant = state.activeMarkets.every((market) =>
    market.enteredAsCollateralMarket || BigInt(market.vTokenBalance) > 0n || BigInt(market.borrowBalance) > 0n
  );
  const allActiveSnapshotsClean = state.activeMarkets.every((market) => BigInt(market.snapshotError) === 0n);
  const allActivePricesPositive = state.activeMarkets.every((market) => BigInt(market.underlyingPriceMantissa) > 0n);
  const nativeStatusConsistent = state.accountShortfall > 0n
    ? state.nativeSolvencyStatus === "LIQUIDATION_ELIGIBLE"
    : state.accountLiquidity > 0n
      ? state.nativeSolvencyStatus === "SOLVENT"
      : state.nativeSolvencyStatus === "AT_LIQUIDATION_THRESHOLD";
  const finalized = state.snapshot.blockTag === "finalized";
  const sameChain = state.chainId === 56 && state.snapshot.chainId === 56;
  const protocolContractsPresent = state.evidenceRefs.some((ref) => ref.includes("comptroller") && ref.includes("code:"))
    && state.evidenceRefs.some((ref) => ref.includes("resilient-oracle") && ref.includes("code:"));
  const listedMarketsPresent = state.listedMarketCount > 0;
  const zeroTargetEmpty = account !== "0x0000000000000000000000000000000000000000"
    || (state.activeMarkets.length === 0 && state.enteredMarkets.length === 0 && state.accountShortfall === 0n);
  const passed = everyActiveMarketRelevant && allActiveSnapshotsClean && allActivePricesPositive
    && nativeStatusConsistent && finalized && sameChain && protocolContractsPresent && listedMarketsPresent && zeroTargetEmpty;

  output.state = state;
  output.invariants = {
    everyActiveMarketRelevant,
    allActiveSnapshotsClean,
    allActivePricesPositive,
    nativeStatusConsistent,
    finalized,
    sameChain,
    protocolContractsPresent,
    listedMarketsPresent,
    zeroTargetEmpty,
    passed
  };
  output.status = passed ? "VENUS_CORE_READ_PROBE_PASS" : "VENUS_CORE_READ_PROBE_FAIL";
  if (!passed) process.exitCode = 1;
} catch (error) {
  output.status = "VENUS_CORE_READ_PROBE_ERROR";
  output.errors.push(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(output, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2)}\n`, "utf8");
console.log(JSON.stringify(output, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2));
