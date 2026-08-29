import fs from "node:fs/promises";
import path from "node:path";
import { VenusCorePoolReader } from "../packages/reference-agents/dist/health/index.js";

const rpcUrl = process.env.BSC_RPC_URL || "https://bsc-dataseed.bnbchain.org";
const account = process.env.VENUS_EVIDENCE_ACCOUNT;
const discoveryRef = process.env.VENUS_ACCOUNT_DISCOVERY_REF || "UNSPECIFIED_PUBLIC_DISCOVERY_SOURCE";
const outputPath = process.env.KUMO_EVIDENCE_PATH || "evidence/live/venus-core-account-evidence.json";
if (!account || !/^0x[0-9a-fA-F]{40}$/.test(account)) throw new Error("VENUS_EVIDENCE_ACCOUNT_REQUIRED");

const rpcProviderId = new URL(rpcUrl).hostname;
const output = {
  schemaVersion: "kumo-venus-core-account-evidence-v1",
  generatedAt: new Date().toISOString(),
  classification: "LIVE_READ_ONLY_ACCOUNT_EVIDENCE",
  ownershipClaim: "NONE_PUBLIC_CHAIN_ACCOUNT_ONLY",
  account,
  discoveryRef,
  rpcProviderId,
  status: "STARTED",
  state: undefined,
  invariants: undefined,
  errors: []
};

try {
  const reader = new VenusCorePoolReader({ rpcUrl, rpcProviderId, purpose: "evidence" });
  const state = await reader.readAccount(account);
  const debtMarkets = state.activeMarkets.filter((market) => BigInt(market.borrowBalance) > 0n);
  const collateralMarkets = state.activeMarkets.filter((market) => market.enteredAsCollateralMarket && BigInt(market.vTokenBalance) > 0n);
  const everyDebtMarketListed = debtMarkets.every((market) => market.isListed);
  const everyCollateralMarketListed = collateralMarkets.every((market) => market.isListed);
  const everyRiskTupleSane = state.activeMarkets.every((market) =>
    BigInt(market.baseCollateralFactorMantissa) >= 0n
    && BigInt(market.baseLiquidationThresholdMantissa) >= BigInt(market.baseCollateralFactorMantissa)
    && BigInt(market.baseLiquidationIncentiveMantissa) > 0n
  );
  const allActivePricesPositive = state.activeMarkets.every((market) => BigInt(market.underlyingPriceMantissa) > 0n);
  const hasCurrentDebt = debtMarkets.length > 0;
  const hasEnteredCollateral = collateralMarkets.length > 0;
  const nativeLiquidityTupleExclusive = !(state.accountLiquidity > 0n && state.accountShortfall > 0n);
  const nativeStatusConsistent = state.accountShortfall > 0n
    ? state.nativeSolvencyStatus === "LIQUIDATION_ELIGIBLE"
    : state.accountLiquidity > 0n
      ? state.nativeSolvencyStatus === "SOLVENT"
      : state.nativeSolvencyStatus === "AT_LIQUIDATION_THRESHOLD";
  const finalized = state.snapshot.blockTag === "finalized";
  const sameChain = state.chainId === 56 && state.snapshot.chainId === 56;
  const currentExposure = hasCurrentDebt && hasEnteredCollateral;
  const passed = currentExposure && everyDebtMarketListed && everyCollateralMarketListed && everyRiskTupleSane
    && allActivePricesPositive && nativeLiquidityTupleExclusive && nativeStatusConsistent && finalized && sameChain;

  output.state = state;
  output.invariants = {
    hasCurrentDebt,
    debtMarketCount: debtMarkets.length,
    hasEnteredCollateral,
    collateralMarketCount: collateralMarkets.length,
    everyDebtMarketListed,
    everyCollateralMarketListed,
    everyRiskTupleSane,
    allActivePricesPositive,
    nativeLiquidityTupleExclusive,
    nativeStatusConsistent,
    finalized,
    sameChain,
    currentExposure,
    passed
  };
  output.status = passed ? "VENUS_CORE_ACCOUNT_EVIDENCE_PASS" : "VENUS_CORE_ACCOUNT_EVIDENCE_NOT_CURRENT_EXPOSURE";
  if (!passed) process.exitCode = 1;
} catch (error) {
  output.status = "VENUS_CORE_ACCOUNT_EVIDENCE_ERROR";
  output.errors.push(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(output, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2)}\n`, "utf8");
console.log(JSON.stringify(output, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2));
