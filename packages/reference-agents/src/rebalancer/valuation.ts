import { formatUnits, getAddress, type Address } from "viem";
import type { PancakeV3RawPositionSnapshot } from "./pancakeswap-v3-reader.js";
import {
  assertCanonicalV3MathVectors,
  getV3PositionPrincipalAmounts,
  sqrtPriceX96ToToken1PerToken0
} from "./v3-math.js";

export interface TokenUsdPriceEvidence {
  token: Address;
  priceUsd: number;
  observedAt: string;
  sourceRef: string;
  evidenceRef: string;
  blockNumber?: string;
}

export interface PancakeV3PositionValuation {
  chainId: 56;
  positionId: string;
  blockNumber: string;
  blockHash: string;
  token0: Address;
  token1: Address;
  token0Decimals: number;
  token1Decimals: number;
  principalAmount0Raw: bigint;
  principalAmount1Raw: bigint;
  principalAmount0: number;
  principalAmount1: number;
  crystallizedFees0Raw: bigint;
  crystallizedFees1Raw: bigint;
  crystallizedFees0: number;
  crystallizedFees1: number;
  token0PriceUsd: number;
  token1PriceUsd: number;
  principalValueUsd: number;
  crystallizedFeesFloorUsd: number;
  markedValueIncludingCrystallizedFeesUsd: number;
  spotToken1PerToken0: number;
  priceRegion: "BELOW_RANGE" | "IN_RANGE" | "ABOVE_RANGE";
  priceEvidenceRefs: string[];
  valuationRuleVersion: "kumo-pancake-v3-valuation-v1";
  valuedAt: string;
}

function checkedPrice(expected: Address, price: TokenUsdPriceEvidence): number {
  if (getAddress(price.token) !== getAddress(expected)) throw new Error("TOKEN_PRICE_ADDRESS_MISMATCH");
  if (!Number.isFinite(price.priceUsd) || price.priceUsd <= 0) throw new Error("TOKEN_PRICE_INVALID");
  return price.priceUsd;
}

function amount(raw: bigint, decimals: number): number {
  const value = Number(formatUnits(raw, decimals));
  if (!Number.isFinite(value)) throw new Error("TOKEN_AMOUNT_NUMBER_OVERFLOW");
  return value;
}

export function valuePancakeV3Position(input: {
  snapshot: PancakeV3RawPositionSnapshot;
  token0Price: TokenUsdPriceEvidence;
  token1Price: TokenUsdPriceEvidence;
  valuedAt?: string;
}): PancakeV3PositionValuation {
  assertCanonicalV3MathVectors();
  const { snapshot } = input;
  const token0PriceUsd = checkedPrice(snapshot.token0, input.token0Price);
  const token1PriceUsd = checkedPrice(snapshot.token1, input.token1Price);

  const principal = getV3PositionPrincipalAmounts({
    liquidity: snapshot.positionLiquidity,
    tickLower: snapshot.tickLower,
    tickUpper: snapshot.tickUpper,
    currentTick: snapshot.currentTick,
    sqrtPriceX96: snapshot.sqrtPriceX96
  });

  const principalAmount0 = amount(principal.amount0Raw, snapshot.token0Decimals);
  const principalAmount1 = amount(principal.amount1Raw, snapshot.token1Decimals);
  const crystallizedFees0 = amount(snapshot.tokensOwed0, snapshot.token0Decimals);
  const crystallizedFees1 = amount(snapshot.tokensOwed1, snapshot.token1Decimals);

  const principalValueUsd = principalAmount0 * token0PriceUsd + principalAmount1 * token1PriceUsd;
  const crystallizedFeesFloorUsd = crystallizedFees0 * token0PriceUsd + crystallizedFees1 * token1PriceUsd;

  return {
    chainId: 56,
    positionId: snapshot.tokenId,
    blockNumber: snapshot.blockNumber.toString(),
    blockHash: snapshot.blockHash,
    token0: snapshot.token0,
    token1: snapshot.token1,
    token0Decimals: snapshot.token0Decimals,
    token1Decimals: snapshot.token1Decimals,
    principalAmount0Raw: principal.amount0Raw,
    principalAmount1Raw: principal.amount1Raw,
    principalAmount0,
    principalAmount1,
    crystallizedFees0Raw: snapshot.tokensOwed0,
    crystallizedFees1Raw: snapshot.tokensOwed1,
    crystallizedFees0,
    crystallizedFees1,
    token0PriceUsd,
    token1PriceUsd,
    principalValueUsd,
    crystallizedFeesFloorUsd,
    markedValueIncludingCrystallizedFeesUsd: principalValueUsd + crystallizedFeesFloorUsd,
    spotToken1PerToken0: sqrtPriceX96ToToken1PerToken0({
      sqrtPriceX96: snapshot.sqrtPriceX96,
      token0Decimals: snapshot.token0Decimals,
      token1Decimals: snapshot.token1Decimals
    }),
    priceRegion: principal.priceRegion,
    priceEvidenceRefs: [input.token0Price.evidenceRef, input.token1Price.evidenceRef],
    valuationRuleVersion: "kumo-pancake-v3-valuation-v1",
    valuedAt: input.valuedAt ?? new Date().toISOString()
  };
}
