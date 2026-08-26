const Q96 = 1n << 96n;
const Q32 = 1n << 32n;
const Q128 = 1n << 128n;
const MAX_UINT256 = (1n << 256n) - 1n;

export const V3_MIN_TICK = -887272;
export const V3_MAX_TICK = 887272;
export const V3_MIN_SQRT_RATIO = 4295128739n;
export const V3_MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342n;

/**
 * Exact integer port of the canonical V3 TickMath.getSqrtRatioAtTick algorithm.
 * Returns sqrt(1.0001^tick) * 2^96, rounded up exactly as the Solidity library.
 */
export function getSqrtRatioAtTick(tick: number): bigint {
  if (!Number.isInteger(tick) || tick < V3_MIN_TICK || tick > V3_MAX_TICK) {
    throw new Error(`V3_TICK_OUT_OF_RANGE:${tick}`);
  }

  const absTick = Math.abs(tick);
  let ratio = (absTick & 0x1) !== 0
    ? 0xfffcb933bd6fad37aa2d162d1a594001n
    : 0x100000000000000000000000000000000n;

  const factors: Array<[number, bigint]> = [
    [0x2, 0xfff97272373d413259a46990580e213an],
    [0x4, 0xfff2e50f5f656932ef12357cf3c7fdccn],
    [0x8, 0xffe5caca7e10e4e61c3624eaa0941cd0n],
    [0x10, 0xffcb9843d60f6159c9db58835c926644n],
    [0x20, 0xff973b41fa98c081472e6896dfb254c0n],
    [0x40, 0xff2ea16466c96a3843ec78b326b52861n],
    [0x80, 0xfe5dee046a99a2a811c461f1969c3053n],
    [0x100, 0xfcbe86c7900a88aedcffc83b479aa3a4n],
    [0x200, 0xf987a7253ac413176f2b074cf7815e54n],
    [0x400, 0xf3392b0822b70005940c7a398e4b70f3n],
    [0x800, 0xe7159475a2c29b7443b29c7fa6e889d9n],
    [0x1000, 0xd097f3bdfd2022b8845ad8f792aa5825n],
    [0x2000, 0xa9f746462d870fdf8a65dc1f90e061e5n],
    [0x4000, 0x70d869a156d2a1b890bb3df62baf32f7n],
    [0x8000, 0x31be135f97d08fd981231505542fcfa6n],
    [0x10000, 0x9aa508b5b7a84e1c677de54f3e99bc9n],
    [0x20000, 0x5d6af8dedb81196699c329225ee604n],
    [0x40000, 0x2216e584f5fa1ea926041bedfe98n],
    [0x80000, 0x48a170391f7dc42444e8fa2n]
  ];

  for (const [mask, factor] of factors) {
    if ((absTick & mask) !== 0) ratio = (ratio * factor) >> 128n;
  }

  if (tick > 0) ratio = MAX_UINT256 / ratio;

  const shifted = ratio >> 32n;
  return shifted + (ratio % Q32 === 0n ? 0n : 1n);
}

function orderSqrtRatios(a: bigint, b: bigint): [bigint, bigint] {
  return a <= b ? [a, b] : [b, a];
}

/** Principal token0 amount for a V3 liquidity interval, rounded down. */
export function getAmount0Delta(sqrtRatioAX96: bigint, sqrtRatioBX96: bigint, liquidity: bigint): bigint {
  if (liquidity < 0n) throw new Error("V3_NEGATIVE_LIQUIDITY");
  const [sqrtA, sqrtB] = orderSqrtRatios(sqrtRatioAX96, sqrtRatioBX96);
  if (sqrtA <= 0n) throw new Error("V3_ZERO_SQRT_RATIO");
  const numerator1 = liquidity << 96n;
  const numerator2 = sqrtB - sqrtA;
  return ((numerator1 * numerator2) / sqrtB) / sqrtA;
}

/** Principal token1 amount for a V3 liquidity interval, rounded down. */
export function getAmount1Delta(sqrtRatioAX96: bigint, sqrtRatioBX96: bigint, liquidity: bigint): bigint {
  if (liquidity < 0n) throw new Error("V3_NEGATIVE_LIQUIDITY");
  const [sqrtA, sqrtB] = orderSqrtRatios(sqrtRatioAX96, sqrtRatioBX96);
  return (liquidity * (sqrtB - sqrtA)) / Q96;
}

export interface V3PositionPrincipalAmounts {
  amount0Raw: bigint;
  amount1Raw: bigint;
  sqrtLowerX96: bigint;
  sqrtUpperX96: bigint;
  priceRegion: "BELOW_RANGE" | "IN_RANGE" | "ABOVE_RANGE";
}

/**
 * Reconstructs the token amounts represented by position liquidity at the
 * supplied pool price. Fees are deliberately excluded.
 */
export function getV3PositionPrincipalAmounts(input: {
  liquidity: bigint;
  tickLower: number;
  tickUpper: number;
  currentTick: number;
  sqrtPriceX96: bigint;
}): V3PositionPrincipalAmounts {
  if (input.tickLower >= input.tickUpper) throw new Error("V3_INVALID_TICK_RANGE");
  if (input.sqrtPriceX96 < V3_MIN_SQRT_RATIO || input.sqrtPriceX96 >= V3_MAX_SQRT_RATIO) {
    throw new Error("V3_SQRT_PRICE_OUT_OF_RANGE");
  }

  const sqrtLowerX96 = getSqrtRatioAtTick(input.tickLower);
  const sqrtUpperX96 = getSqrtRatioAtTick(input.tickUpper);

  if (input.currentTick < input.tickLower) {
    return {
      amount0Raw: getAmount0Delta(sqrtLowerX96, sqrtUpperX96, input.liquidity),
      amount1Raw: 0n,
      sqrtLowerX96,
      sqrtUpperX96,
      priceRegion: "BELOW_RANGE"
    };
  }

  if (input.currentTick < input.tickUpper) {
    return {
      amount0Raw: getAmount0Delta(input.sqrtPriceX96, sqrtUpperX96, input.liquidity),
      amount1Raw: getAmount1Delta(sqrtLowerX96, input.sqrtPriceX96, input.liquidity),
      sqrtLowerX96,
      sqrtUpperX96,
      priceRegion: "IN_RANGE"
    };
  }

  return {
    amount0Raw: 0n,
    amount1Raw: getAmount1Delta(sqrtLowerX96, sqrtUpperX96, input.liquidity),
    sqrtLowerX96,
    sqrtUpperX96,
    priceRegion: "ABOVE_RANGE"
  };
}

export function sqrtPriceX96ToToken1PerToken0(input: {
  sqrtPriceX96: bigint;
  token0Decimals: number;
  token1Decimals: number;
}): number {
  const sqrt = Number(input.sqrtPriceX96) / Number(Q96);
  return sqrt * sqrt * 10 ** (input.token0Decimals - input.token1Decimals);
}

/** Cheap runtime vectors for accidental algorithm drift. */
export function assertCanonicalV3MathVectors(): void {
  if (getSqrtRatioAtTick(0) !== Q96) throw new Error("V3_TICKMATH_VECTOR_ZERO_FAILED");
  if (getSqrtRatioAtTick(V3_MIN_TICK) !== V3_MIN_SQRT_RATIO) {
    throw new Error("V3_TICKMATH_VECTOR_MIN_FAILED");
  }
  if (getSqrtRatioAtTick(V3_MAX_TICK) !== V3_MAX_SQRT_RATIO) {
    throw new Error("V3_TICKMATH_VECTOR_MAX_FAILED");
  }
  if (Q128 <= Q96) throw new Error("V3_INTERNAL_Q_CONSTANT_FAILED");
}
