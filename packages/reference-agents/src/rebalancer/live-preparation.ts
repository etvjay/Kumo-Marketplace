import type { Address } from "viem";
import type { PancakeV3BscReader, PancakeV3RawPositionSnapshot } from "./pancakeswap-v3-reader.js";
import type {
  ChainlinkBscUsdPriceProvider,
  ChainlinkPriceEvidence
} from "./chainlink-price-provider.js";
import {
  valuePancakeV3Position,
  type PancakeV3PositionValuation
} from "./valuation.js";
import {
  freezeStaticV3Baseline,
  type StaticV3PositionBaseline
} from "./baseline.js";

export type PancakeV3LivePreparationFailureCode =
  | "POSITION_UNAVAILABLE"
  | "TOKEN0_PRICE_UNAVAILABLE"
  | "TOKEN1_PRICE_UNAVAILABLE"
  | "VALUATION_FAILED"
  | "BASELINE_FAILED";

export interface PancakeV3LivePreparationSuccess {
  ok: true;
  tokenId: string;
  snapshot: PancakeV3RawPositionSnapshot;
  token0Price: ChainlinkPriceEvidence;
  token1Price: ChainlinkPriceEvidence;
  valuation: PancakeV3PositionValuation;
  baseline: StaticV3PositionBaseline;
  evidenceRefs: string[];
}

export interface PancakeV3LivePreparationFailure {
  ok: false;
  tokenId: string;
  code: PancakeV3LivePreparationFailureCode;
  reason: string;
}

export type PancakeV3LivePreparationResult =
  | PancakeV3LivePreparationSuccess
  | PancakeV3LivePreparationFailure;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Builds the complete read-only preparation bundle required before the
 * Rebalancer is allowed to reason about one live PancakeSwap V3 position.
 *
 * Every price is read at the exact chain snapshot block returned by the V3
 * reader. No strategy decision, quote, authority or execution happens here.
 */
export async function preparePancakeV3LivePosition(input: {
  tokenId: string | bigint;
  reader: PancakeV3BscReader;
  priceProvider: ChainlinkBscUsdPriceProvider;
  valuedAt?: string;
}): Promise<PancakeV3LivePreparationResult> {
  const tokenId = input.tokenId.toString();

  let snapshot: PancakeV3RawPositionSnapshot;
  try {
    snapshot = await input.reader.readPosition(input.tokenId);
  } catch (error) {
    return {
      ok: false,
      tokenId,
      code: "POSITION_UNAVAILABLE",
      reason: errorMessage(error)
    };
  }

  let token0Price: ChainlinkPriceEvidence;
  try {
    token0Price = await input.priceProvider.getUsdPrice({
      token: snapshot.token0 as Address,
      snapshot: snapshot.snapshot
    });
  } catch (error) {
    return {
      ok: false,
      tokenId,
      code: "TOKEN0_PRICE_UNAVAILABLE",
      reason: errorMessage(error)
    };
  }

  let token1Price: ChainlinkPriceEvidence;
  try {
    token1Price = await input.priceProvider.getUsdPrice({
      token: snapshot.token1 as Address,
      snapshot: snapshot.snapshot
    });
  } catch (error) {
    return {
      ok: false,
      tokenId,
      code: "TOKEN1_PRICE_UNAVAILABLE",
      reason: errorMessage(error)
    };
  }

  let valuation: PancakeV3PositionValuation;
  try {
    valuation = valuePancakeV3Position({
      snapshot,
      token0Price,
      token1Price,
      valuedAt: input.valuedAt
    });
  } catch (error) {
    return {
      ok: false,
      tokenId,
      code: "VALUATION_FAILED",
      reason: errorMessage(error)
    };
  }

  let baseline: StaticV3PositionBaseline;
  try {
    baseline = freezeStaticV3Baseline({ snapshot, valuation });
  } catch (error) {
    return {
      ok: false,
      tokenId,
      code: "BASELINE_FAILED",
      reason: errorMessage(error)
    };
  }

  return {
    ok: true,
    tokenId,
    snapshot,
    token0Price,
    token1Price,
    valuation,
    baseline,
    evidenceRefs: [
      `bsc:block:${snapshot.blockNumber.toString()}:${snapshot.blockHash}`,
      `pancakeswap-v3:position:${snapshot.tokenId}:block:${snapshot.blockNumber.toString()}`,
      token0Price.evidenceRef,
      token1Price.evidenceRef
    ]
  };
}
