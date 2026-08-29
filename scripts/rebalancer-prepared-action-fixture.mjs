import fs from "node:fs/promises";
import path from "node:path";
import {
  preparedActionSchema,
  validatePreparedActionForAuthorization
} from "../packages/financial-agent-kernel/dist/index.js";
import {
  PANCAKESWAP_V3_BSC,
  PancakeV3UnsignedTransactionPreparer,
  planRebalanceComposition
} from "../packages/reference-agents/dist/rebalancer/index.js";

const outputPath = process.env.KUMO_EVIDENCE_PATH || "evidence/fixtures/rebalancer-prepared-action.json";
const fixedNow = Date.parse("2026-08-29T05:00:00.000Z");
const originalDateNow = Date.now;
Date.now = () => fixedNow;

const USDT = "0x55d398326f99059fF775485246999027B3197955";
const WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
const OWNER = "0x35D497aD2e0870814C3fFe002C2e88D4c4Dd41E8";
const ALT_SIGNER = "0x0000000000000000000000000000000000000001";
const POOL = "0x172fcD41E0913e95784454622d1c3724f546f849";

const policy = {
  targetRangeWidthBps: 30, edgeBufferBps: 5, minDriftBps: 5, minExpectedNetBenefitUsd: 1,
  maxSlippageBps: 5, maxGasCostUsd: 1.5, maxTotalExecutionCostUsd: 5, maxPositionValueUsd: 100000,
  minPoolLiquidityUsd: 1000000, maxVolatilityAnnualized: 2.5, allowOutOfRangeImmediateRecenter: true,
  observationMaxAgeSeconds: 180, proposalTtlSeconds: 90, quoteTtlSeconds: 30
};

const snapshot = {
  chainId: 56, tokenId: "999001", owner: OWNER, operator: "0x0000000000000000000000000000000000000000",
  token0: USDT, token1: WBNB, token0Decimals: 18, token1Decimals: 18, fee: 100,
  tickLower: -64979, tickUpper: 887272, positionLiquidity: 3882124761380135480n,
  feeGrowthInside0LastX128: 0n, feeGrowthInside1LastX128: 0n, tokensOwed0: 1000000000000000n, tokensOwed1: 0n,
  pool: POOL, sqrtPriceX96: 3016472752945240429896451150n, currentTick: -65369,
  poolLiquidity: 119600319973320857700709n, unlocked: true, blockNumber: 118704833n,
  blockHash: "0xdf92b38e525fae003fe19fc4d6f417ae799e25814110a5b2bdfac6d198a71363",
  blockTimestamp: 1787978273, blockTag: "finalized", purpose: "evidence",
  snapshot: { chainId: 56, purpose: "evidence", blockTag: "finalized", blockNumber: "118704833", blockHash: "0xdf92b38e525fae003fe19fc4d6f417ae799e25814110a5b2bdfac6d198a71363", blockTimestamp: 1787978273, observedAt: "2026-08-29T04:37:55.553Z", rpcProviderId: "TEST_FIXTURE" },
  observedAt: "2026-08-29T04:37:55.553Z"
};

const prepared = {
  ok: true, tokenId: snapshot.tokenId, snapshot, token0Price: {}, token1Price: {},
  valuation: { principalAmount0Raw: 100000000000000000000n, principalAmount1Raw: 0n, principalAmount0: 100, principalAmount1: 0, principalValueUsd: 100, crystallizedFeesFloorUsd: 0, markedValueIncludingCrystallizedFeesUsd: 100 },
  baseline: {}, evidenceRefs: ["fixture:bsc:block:118704833", "fixture:pancakeswap-v3:position:999001"]
};

const proposal = {
  id: "proposal:fixture:rebalancer:999001", agentId: "kumo-rebalancer-reference-bsc-v1", category: "rebalancing", mode: "shadow",
  createdAt: "2026-08-29T04:59:59.000Z", expiresAt: "2026-08-29T05:00:20.000Z",
  objective: "TEST FIXTURE: exercise a complete unsigned V3 rebalance preparation", action: "TEST FIXTURE: recenter position 999001",
  disposition: "propose", rationale: "TEST_FIXTURE_ONLY — not derived from a live strategy verdict", expectedNetBenefit: 5, estimatedCost: 1,
  evidencePacketRef: "fixture:evidence", evidenceSnapshotRoot: "fixture:evidence-root:v1", marketSnapshotRoot: "fixture:market-root:v1", refusalReasons: []
};

let quoteCalls = 0;
const fixtureQuoteProvider = {
  id: "deterministic-fixture-quote-provider",
  async quoteExactInput(input) {
    quoteCalls += 1;
    const expectedAmountOut = input.tokenIn.toLowerCase() === USDT.toLowerCase() ? input.amountIn / 690n : input.amountIn * 689n;
    return {
      quoteId: `fixture-quote:${input.amountIn.toString()}`,
      quotedAt: "2026-08-29T05:00:00.000Z",
      expiresAt: input.expiresAt,
      router: PANCAKESWAP_V3_BSC.swapRouterV3,
      tokenIn: input.tokenIn,
      tokenOut: input.tokenOut,
      amountIn: input.amountIn,
      expectedAmountOut: expectedAmountOut > 0n ? expectedAmountOut : 1n,
      calldata: "0x414bf389", value: 0n, gasEstimate: 150000n,
      routeRef: "fixture:pancake-v3:quote", evidenceRefs: ["fixture:quote:evidence"]
    };
  }
};

const output = {
  schemaVersion: "kumo-rebalancer-prepared-action-fixture-v2",
  generatedAt: new Date(fixedNow).toISOString(),
  classification: "TEST_FIXTURE_NOT_LIVE_EVIDENCE",
  status: "STARTED",
  composition: undefined,
  preparedAction: undefined,
  authorizationValidation: undefined,
  mutationResults: undefined,
  invariants: undefined,
  errors: []
};

try {
  const composition = planRebalanceComposition({ prepared, policy });
  const preparer = new PancakeV3UnsignedTransactionPreparer(fixtureQuoteProvider);
  const first = await preparer.prepare({ prepared, proposal, policy });
  const second = await preparer.prepare({ prepared, proposal, policy });
  preparedActionSchema.parse(first);
  preparedActionSchema.parse(second);

  const kernelQuote = {
    id: first.quoteId,
    proposalId: proposal.id,
    quotedAt: first.createdAt,
    expiresAt: first.expiresAt,
    chainId: 56,
    venue: "pancakeswap-v3",
    totalCost: 1,
    slippageBps: 5,
    marketSnapshotRoot: proposal.marketSnapshotRoot
  };
  const noDrift = { drifted: false, reasons: [], evidenceRefs: ["fixture:semantic-refresh:pass"] };
  const notSimulated = validatePreparedActionForAuthorization({ action: first, proposal, quote: kernelQuote, marketDrift: noDrift, now: "2026-08-29T05:00:01.000Z" });
  const simulated = { ...first, simulationStatus: "PASSED" };
  const ready = validatePreparedActionForAuthorization({ action: simulated, proposal, quote: kernelQuote, marketDrift: noDrift, now: "2026-08-29T05:00:01.000Z" });

  const mutations = {
    signer: validatePreparedActionForAuthorization({ action: { ...simulated, signer: ALT_SIGNER }, proposal, quote: kernelQuote, marketDrift: noDrift, now: "2026-08-29T05:00:01.000Z" }),
    chain: validatePreparedActionForAuthorization({ action: { ...simulated, executionChainId: 1 }, proposal, quote: kernelQuote, marketDrift: noDrift, now: "2026-08-29T05:00:01.000Z" }),
    quoteId: validatePreparedActionForAuthorization({ action: { ...simulated, quoteId: "fixture-quote:tampered" }, proposal, quote: kernelQuote, marketDrift: noDrift, now: "2026-08-29T05:00:01.000Z" }),
    spendBound: validatePreparedActionForAuthorization({ action: { ...simulated, spendBounds: simulated.spendBounds.map((bound, index) => index === 0 ? { ...bound, maxAmount: (BigInt(bound.maxAmount) + 1n).toString() } : bound) }, proposal, quote: kernelQuote, marketDrift: noDrift, now: "2026-08-29T05:00:01.000Z" }),
    marketDrift: validatePreparedActionForAuthorization({ action: simulated, proposal, quote: kernelQuote, marketDrift: { drifted: true, reasons: ["SPOT_PRICE_DRIFT_BPS:9.0000"] }, now: "2026-08-29T05:00:01.000Z" })
  };

  const kinds = first.calls.map((call) => call.kind);
  const labels = first.calls.map((call) => call.label);
  const ordersContiguous = first.calls.every((call, index) => call.order === index);
  const exactExecutionCommitmentReproducible = first.executionCommitment === second.executionCommitment;
  const exactAuthorizationCommitmentReproducible = first.authorizationCommitment === second.authorizationCommitment;
  const hasRemove = labels.some((label) => label.startsWith("Remove all liquidity"));
  const hasCollect = labels.some((label) => label.startsWith("Collect principal"));
  const hasSwap = kinds.includes("swap");
  const hasMint = labels.some((label) => label.startsWith("Mint replacement"));
  const hasExactApprovals = kinds.includes("approval-reset") && kinds.includes("approval") && kinds.includes("approval-revoke");
  const noAuthority = first.signingStatus === "UNSIGNED" && first.simulationStatus === "NOT_RUN";
  const nonAtomicDeclared = first.atomic === false;
  const executionCommitmentShape = /^0x[0-9a-fA-F]{64}$/.test(first.executionCommitment);
  const authorizationCommitmentShape = /^0x[0-9a-fA-F]{64}$/.test(first.authorizationCommitment);
  const simulationRequired = !notSimulated.eligibleForAuthorization && notSimulated.reasons.includes("SIMULATION_REQUIRED");
  const simulatedReady = ready.eligibleForAuthorization;
  const signerMutationCaught = mutations.signer.reasons.includes("AUTHORIZATION_COMMITMENT_MISMATCH");
  const chainMutationCaught = mutations.chain.reasons.includes("AUTHORIZATION_COMMITMENT_MISMATCH") && mutations.chain.reasons.includes("QUOTE_CHAIN_MISMATCH");
  const quoteMutationCaught = mutations.quoteId.reasons.includes("AUTHORIZATION_COMMITMENT_MISMATCH") && mutations.quoteId.reasons.includes("QUOTE_ID_MISMATCH");
  const spendMutationCaught = mutations.spendBound.reasons.includes("AUTHORIZATION_COMMITMENT_MISMATCH") && mutations.spendBound.reasons.some((reason) => reason.startsWith("SPEND_BOUND_APPROVAL_MISMATCH:"));
  const driftCaught = mutations.marketDrift.reasons.includes("MARKET_DRIFT:SPOT_PRICE_DRIFT_BPS:9.0000");

  const passed = ordersContiguous && exactExecutionCommitmentReproducible && exactAuthorizationCommitmentReproducible
    && hasRemove && hasCollect && hasSwap && hasMint && hasExactApprovals && noAuthority && nonAtomicDeclared
    && executionCommitmentShape && authorizationCommitmentShape && simulationRequired && simulatedReady
    && signerMutationCaught && chainMutationCaught && quoteMutationCaught && spendMutationCaught && driftCaught
    && quoteCalls === 2;

  output.composition = { targetTickLower: composition.targetTickLower, targetTickUpper: composition.targetTickUpper, swapDirection: composition.swapDirection, swapAmountInRaw: composition.swapAmountInRaw };
  output.preparedAction = first;
  output.authorizationValidation = { notSimulated, simulatedReady: ready };
  output.mutationResults = mutations;
  output.invariants = {
    ordersContiguous, exactExecutionCommitmentReproducible, exactAuthorizationCommitmentReproducible,
    hasRemove, hasCollect, hasSwap, hasMint, hasExactApprovals, noAuthority, nonAtomicDeclared,
    executionCommitmentShape, authorizationCommitmentShape, simulationRequired, simulatedReady,
    signerMutationCaught, chainMutationCaught, quoteMutationCaught, spendMutationCaught, driftCaught,
    quoteCalls, passed
  };
  output.status = passed ? "PREPARED_ACTION_AUTHORIZATION_FIXTURE_PASS" : "PREPARED_ACTION_AUTHORIZATION_FIXTURE_FAIL";
  if (!passed) process.exitCode = 1;
} catch (error) {
  output.status = "PREPARED_ACTION_AUTHORIZATION_FIXTURE_ERROR";
  output.errors.push(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  Date.now = originalDateNow;
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(output, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2)}\n`, "utf8");
  console.log(JSON.stringify(output, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2));
}
