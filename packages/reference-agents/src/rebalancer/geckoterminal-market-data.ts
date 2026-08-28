import { getAddress, type Address } from "viem";

const DEFAULT_BASE_URL = "https://api.geckoterminal.com/api/v2";

export interface GeckoTerminalPoolSnapshot {
  network: "bsc";
  poolAddress: Address;
  name: string;
  dexId: string;
  reserveUsd: number;
  volume24hUsd: number;
  baseTokenPriceUsd?: number;
  quoteTokenPriceUsd?: number;
  priceChange24hPct?: number;
  buys24h?: number;
  sells24h?: number;
  fetchedAt: string;
  sourceRef: string;
  evidenceRef: string;
}

export interface GeckoTerminalOhlcvCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeUsd: number;
}

export interface GeckoTerminalOhlcvSnapshot {
  network: "bsc";
  poolAddress: Address;
  timeframe: "hour";
  aggregate: 1;
  candles: GeckoTerminalOhlcvCandle[];
  fetchedAt: string;
  sourceRef: string;
  evidenceRef: string;
}

export interface GeckoTerminalMarketDataOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

type RecordLike = Record<string, unknown>;

function record(value: unknown): RecordLike | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RecordLike
    : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function requiredPositive(value: unknown, code: string): number {
  const parsed = finiteNumber(value);
  if (parsed === undefined || parsed <= 0) throw new Error(code);
  return parsed;
}

function requiredNonNegative(value: unknown, code: string): number {
  const parsed = finiteNumber(value);
  if (parsed === undefined || parsed < 0) throw new Error(code);
  return parsed;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export class GeckoTerminalBscMarketDataProvider {
  readonly id = "geckoterminal-bsc-market-data-v1";
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: GeckoTerminalMarketDataOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async getPoolSnapshot(poolAddressInput: Address | string): Promise<GeckoTerminalPoolSnapshot> {
    const poolAddress = getAddress(poolAddressInput);
    const sourceRef = `${this.baseUrl}/networks/bsc/pools/${poolAddress}`;
    const fetchedAt = new Date().toISOString();
    const payload = await this.request(sourceRef);
    const data = record(record(payload)?.data);
    const attributes = record(data?.attributes);
    const relationships = record(data?.relationships);
    const dex = record(record(relationships?.dex)?.data);
    if (!attributes) throw new Error("GECKOTERMINAL_POOL_ATTRIBUTES_MISSING");

    const address = getAddress(text(attributes.address) ?? poolAddress);
    if (address !== poolAddress) throw new Error("GECKOTERMINAL_POOL_ADDRESS_MISMATCH");

    const volume = record(attributes.volume_usd);
    const priceChange = record(attributes.price_change_percentage);
    const transactions = record(record(attributes.transactions)?.h24);
    const dexId = text(dex?.id) ?? "unknown";

    return {
      network: "bsc",
      poolAddress,
      name: text(attributes.name) ?? poolAddress,
      dexId,
      reserveUsd: requiredPositive(attributes.reserve_in_usd, "GECKOTERMINAL_RESERVE_USD_INVALID"),
      volume24hUsd: requiredNonNegative(volume?.h24, "GECKOTERMINAL_VOLUME_24H_INVALID"),
      baseTokenPriceUsd: finiteNumber(attributes.base_token_price_usd),
      quoteTokenPriceUsd: finiteNumber(attributes.quote_token_price_usd),
      priceChange24hPct: finiteNumber(priceChange?.h24),
      buys24h: finiteNumber(transactions?.buys),
      sells24h: finiteNumber(transactions?.sells),
      fetchedAt,
      sourceRef,
      evidenceRef: `geckoterminal:bsc:pool:${poolAddress}:${Date.parse(fetchedAt)}`
    };
  }

  async getHourlyOhlcv(
    poolAddressInput: Address | string,
    limit = 48
  ): Promise<GeckoTerminalOhlcvSnapshot> {
    const poolAddress = getAddress(poolAddressInput);
    const safeLimit = Math.max(3, Math.min(168, Math.floor(limit)));
    const sourceRef = `${this.baseUrl}/networks/bsc/pools/${poolAddress}/ohlcv/hour?aggregate=1&limit=${safeLimit}&currency=usd`;
    const fetchedAt = new Date().toISOString();
    const payload = await this.request(sourceRef);
    const data = record(record(payload)?.data);
    const attributes = record(data?.attributes);
    const raw = attributes?.ohlcv_list;
    if (!Array.isArray(raw)) throw new Error("GECKOTERMINAL_OHLCV_LIST_MISSING");

    const candles: GeckoTerminalOhlcvCandle[] = [];
    for (const item of raw) {
      if (!Array.isArray(item) || item.length < 6) continue;
      const timestamp = finiteNumber(item[0]);
      const open = finiteNumber(item[1]);
      const high = finiteNumber(item[2]);
      const low = finiteNumber(item[3]);
      const close = finiteNumber(item[4]);
      const volumeUsd = finiteNumber(item[5]);
      if (
        timestamp === undefined || open === undefined || high === undefined
        || low === undefined || close === undefined || volumeUsd === undefined
        || open <= 0 || high <= 0 || low <= 0 || close <= 0 || volumeUsd < 0
      ) continue;
      candles.push({ timestamp, open, high, low, close, volumeUsd });
    }

    candles.sort((a, b) => a.timestamp - b.timestamp);
    if (candles.length < 3) throw new Error("GECKOTERMINAL_OHLCV_INSUFFICIENT_CANDLES");

    return {
      network: "bsc",
      poolAddress,
      timeframe: "hour",
      aggregate: 1,
      candles,
      fetchedAt,
      sourceRef,
      evidenceRef: `geckoterminal:bsc:ohlcv:${poolAddress}:${candles[0].timestamp}:${candles.at(-1)?.timestamp ?? 0}`
    };
  }

  private async request(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        headers: { accept: "application/json" },
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`GECKOTERMINAL_HTTP_${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Annualized sample volatility of hourly log returns. This is an inference
 * over sourced OHLCV, not a protocol fact and not a forward volatility oracle.
 */
export function realizedHourlyVolatilityAnnualized(candles: GeckoTerminalOhlcvCandle[]): number {
  const ordered = [...candles].sort((a, b) => a.timestamp - b.timestamp);
  const returns: number[] = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1].close;
    const current = ordered[index].close;
    if (previous > 0 && current > 0) returns.push(Math.log(current / previous));
  }
  if (returns.length < 2) throw new Error("REALIZED_VOLATILITY_INSUFFICIENT_RETURNS");

  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(Math.max(0, variance)) * Math.sqrt(24 * 365);
}

/** Gross pool fee APR proxy before LP concentration, incentives, or costs. */
export function grossPoolFeeApr(input: {
  volume24hUsd: number;
  reserveUsd: number;
  feeTier: number;
}): number {
  if (input.reserveUsd <= 0) throw new Error("POOL_RESERVE_REQUIRED_FOR_FEE_APR");
  const feeRate = input.feeTier / 1_000_000;
  return input.volume24hUsd * feeRate * 365 / input.reserveUsd;
}
