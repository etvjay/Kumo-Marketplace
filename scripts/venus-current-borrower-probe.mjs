import fs from "node:fs/promises";
import path from "node:path";
import {
  VenusCorePoolReader,
  deriveVenusNativeLiquidationBuffer,
  reconstructVenusAccountLiquidity
} from "../packages/reference-agents/dist/health/index.js";

const rpcUrl = process.env.BSC_RPC_URL || "https://bsc-dataseed.bnbchain.org";
const outputPath = process.env.KUMO_EVIDENCE_PATH || "evidence/live/venus-current-borrower-probe.json";
const rpcProviderId = new URL(rpcUrl).hostname;

const candidates = [
  {
    address: "0x59923741A09a85a390D2FD081e876D4384c2EEC3",
    sourceClass: "PUBLIC_DECODED_BORROW_EVENT",
    sourceRef: "bscscan:tx:0x668e4e9cf561e9acd763615bea40cf71aa2469c170792e81a6b03ca8e35e0b1d",
    historicalClaim: "Borrow event recorded 7 BNB with accountBorrows=7 BNB at that transaction."
  },
  {
    address: "0x234B55149E4795feE12019692D504cBb1FB6F3b7",
    sourceClass: "PUBLIC_DECODED_BORROW_EVENT",
    sourceRef: "bscscan:tx:0xfde829c87190b54afc82aefb557094bda91358d0ad0b6135486f537e6b408a75",
    historicalClaim: "Borrow event recorded 0.225 BNB with accountBorrows=0.225 BNB at that transaction."
  },
  {
    address: "0x1A35bD28EFD46CfC46c2136f878777D69ae16231",
    sourceClass: "PUBLIC_INCIDENT_REPRODUCTION_REFERENCE",
    sourceRef: "defihacklabs:2026-03:Venus_THE_exp.sol",
    historicalClaim: "Public incident reproduction identifies the account as carrying Venus debt after borrow-behalf activity; current state must be reverified."
  }
];

const reader = new VenusCorePoolReader({ rpcUrl, rpcProviderId, purpose: "evidence" });
const attempts = [];
let promoted = null;

for (const candidate of candidates) {
  try {
    const state = await reader.readAccount(candidate.address);
    const reconstruction = reconstructVenusAccountLiquidity(state);
    const liquidationBuffer = deriveVenusNativeLiquidationBuffer(reconstruction);
    const debtMarkets = state.activeMarkets.filter((market) => market.borrowBalance > 0n);
    const currentDebtObserved = debtMarkets.length > 0 && reconstruction.sumBorrowPlusEffectsMantissa > 0n;
    const attempt = {
      candidate,
      classification: currentDebtObserved ? "CURRENT_BORROWER_ONCHAIN_VERIFIED" : "HISTORICAL_CANDIDATE_NO_CURRENT_DEBT_OBSERVED",
      finalizedBlock: {
        number: state.snapshot.blockNumber,
        hash: state.snapshot.blockHash,
        timestamp: state.snapshot.blockTimestamp
      },
      currentDebtObserved,
      debtMarkets: debtMarkets.map((market) => ({
        vToken: market.vToken,
        underlyingSymbol: market.underlyingSymbol,
        borrowBalance: market.borrowBalance
      })),
      native: {
        liquidity: state.accountLiquidity,
        shortfall: state.accountShortfall,
        solvencyStatus: state.nativeSolvencyStatus
      },
      reconstruction,
      liquidationBuffer
    };
    attempts.push(attempt);
    if (currentDebtObserved && reconstruction.exactNativeMatch && liquidationBuffer.state !== "NO_DEBT") {
      promoted = attempt;
      break;
    }
  } catch (error) {
    attempts.push({
      candidate,
      classification: "CANDIDATE_READ_FAILED_NOT_PROMOTED",
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

const passed = promoted !== null
  && promoted.currentDebtObserved === true
  && promoted.reconstruction.exactNativeMatch === true
  && promoted.liquidationBuffer.state !== "NO_DEBT";

const output = {
  schemaVersion: "kumo-venus-current-borrower-probe-v1",
  generatedAt: new Date().toISOString(),
  classification: "LIVE_READ_ONLY_CURRENT_BORROWER_DISCOVERY_PROBE",
  ownershipClaim: "NONE_PUBLIC_CHAIN_ACCOUNTS_ONLY",
  promotionRule: "Historical candidate status is insufficient. CURRENT_BORROWER requires finalized onchain borrowBalance > 0, protocol-denominated borrow contribution > 0, and exact native-liquidity equivalence.",
  rpcProviderId,
  candidateCount: candidates.length,
  attempts,
  promoted,
  invariants: {
    currentBorrowerPromoted: promoted !== null,
    currentDebtObserved: promoted?.currentDebtObserved === true,
    exactNativeMatch: promoted?.reconstruction?.exactNativeMatch === true,
    borrowerBufferExists: promoted !== null && promoted.liquidationBuffer.state !== "NO_DEBT",
    passed
  }
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
const json = JSON.stringify(output, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2);
await fs.writeFile(outputPath, `${json}\n`, "utf8");
console.log(json);
if (!passed) process.exitCode = 1;
