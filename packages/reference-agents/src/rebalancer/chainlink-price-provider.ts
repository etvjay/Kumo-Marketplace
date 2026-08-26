import {
  createPublicClient,
  formatUnits,
  getAddress,
  http,
  type Address,
  type Hex
} from "viem";
import type { ChainSnapshot } from "@kumo/chain-state";
import type { TokenUsdPriceEvidence } from "./valuation.js";

const BSC = {
  id: 56,
  name: "BNB Smart Chain",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: { default: { http: [] as string[] } }
} as const;

const AGGREGATOR_V3_ABI = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "decimals", type: "uint8" }]
  },
  {
    type: "function",
    name: "description",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "description", type: "string" }]
  },
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" }
    ]
  }
] as const;

export interface ChainlinkBscFeedConfig {
  token: Address;
  symbol: string;
  feed: Address;
  feedLabel: string;
  sourceUrl: string;
}

export const CHAINLINK_BSC_CORE_USD_FEEDS: readonly ChainlinkBscFeedConfig[] = [
  {
    token: getAddress("0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"),
    symbol: "WBNB",
    feed: getAddress("0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE"),
    feedLabel: "BNB / USD",
    sourceUrl: "https://data.chain.link/feeds/bsc/mainnet/bnb-usd"
  },
  {
    token: getAddress("0x55d398326f99059fF775485246999027B3197955"),
    symbol: "USDT",
    feed: getAddress("0xB97Ad0e74fa7d920791E90258A6E2085088b4320"),
    feedLabel: "USDT / USD",
    sourceUrl: "https://data.chain.link/feeds/bsc/mainnet/usdt-usd"
  },
  {
    token: getAddress("0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d"),
    symbol: "USDC",
    feed: getAddress("0x51597f405303C4377E36123cBc172b13269EA163"),
    feedLabel: "USDC / USD",
    sourceUrl: "https://data.chain.link/feeds/bsc/mainnet/usdc-usd"
  }
] as const;

export interface ChainlinkBscUsdPriceProviderOptions {
  rpcUrl: string;
  rpcProviderId?: string;
  maxFeedAgeSeconds?: number;
  feeds?: readonly ChainlinkBscFeedConfig[];
}

export interface ChainlinkPriceEvidence extends TokenUsdPriceEvidence {
  chainId: 56;
  snapshotBlockHash: Hex;
  feed: Address;
  feedLabel: string;
  feedDescription: string;
  feedDecimals: number;
  roundId: string;
  answeredInRound: string;
  startedAt: number;
  updatedAt: number;
  feedBytecodePresent: boolean;
  sourceUrl: string;
}

/**
 * Same-block USD price evidence for the small set of BSC assets whose Chainlink
 * feeds we have explicitly source-registered. Unsupported tokens fail closed.
 */
export class ChainlinkBscUsdPriceProvider {
  readonly id = "chainlink-bsc-usd-price-provider-v1";
  private readonly client;
  private readonly feeds: Map<string, ChainlinkBscFeedConfig>;
  private readonly maxFeedAgeSeconds: number;
  private readonly rpcProviderId: string;

  constructor(options: ChainlinkBscUsdPriceProviderOptions) {
    if (!options.rpcUrl) throw new Error("BSC_RPC_URL_REQUIRED");
    this.client = createPublicClient({ chain: BSC, transport: http(options.rpcUrl) });
    this.feeds = new Map(
      (options.feeds ?? CHAINLINK_BSC_CORE_USD_FEEDS).map((feed) => [
        getAddress(feed.token).toLowerCase(),
        {
          ...feed,
          token: getAddress(feed.token),
          feed: getAddress(feed.feed)
        }
      ])
    );
    this.maxFeedAgeSeconds = options.maxFeedAgeSeconds ?? 7_200;
    this.rpcProviderId = options.rpcProviderId ?? "bsc-rpc";
  }

  supports(token: Address): boolean {
    return this.feeds.has(getAddress(token).toLowerCase());
  }

  async getUsdPrice(input: {
    token: Address;
    snapshot: ChainSnapshot;
  }): Promise<ChainlinkPriceEvidence> {
    if (input.snapshot.chainId !== 56) throw new Error(`CHAINLINK_WRONG_SNAPSHOT_CHAIN:${input.snapshot.chainId}`);

    const chainId = await this.client.getChainId();
    if (chainId !== 56) throw new Error(`CHAINLINK_WRONG_RPC_CHAIN:${chainId}`);

    const config = this.feeds.get(getAddress(input.token).toLowerCase());
    if (!config) throw new Error(`CHAINLINK_USD_FEED_UNSUPPORTED:${getAddress(input.token)}`);

    const blockNumber = BigInt(input.snapshot.blockNumber);
    const block = await this.client.getBlock({ blockNumber });
    if (!block.hash || block.hash.toLowerCase() !== input.snapshot.blockHash.toLowerCase()) {
      throw new Error("CHAINLINK_PRICE_BLOCK_HASH_MISMATCH");
    }

    const [feedDecimals, feedDescription, roundData, feedCode] = await Promise.all([
      this.client.readContract({
        address: config.feed,
        abi: AGGREGATOR_V3_ABI,
        functionName: "decimals",
        blockNumber
      }),
      this.client.readContract({
        address: config.feed,
        abi: AGGREGATOR_V3_ABI,
        functionName: "description",
        blockNumber
      }),
      this.client.readContract({
        address: config.feed,
        abi: AGGREGATOR_V3_ABI,
        functionName: "latestRoundData",
        blockNumber
      }),
      this.client.getBytecode({ address: config.feed, blockNumber })
    ]);

    const [roundId, answer, startedAt, updatedAt, answeredInRound] = roundData;
    if (!feedCode || feedCode === "0x") throw new Error("CHAINLINK_FEED_CODE_MISSING");
    if (answer <= 0n) throw new Error("CHAINLINK_NON_POSITIVE_ANSWER");
    if (updatedAt === 0n) throw new Error("CHAINLINK_ROUND_INCOMPLETE");
    if (answeredInRound < roundId) throw new Error("CHAINLINK_STALE_ROUND");

    const feedAge = Number(block.timestamp - updatedAt);
    if (feedAge < 0) throw new Error("CHAINLINK_PRICE_FROM_FUTURE");
    if (feedAge > this.maxFeedAgeSeconds) {
      throw new Error(`CHAINLINK_PRICE_STALE:${feedAge}s`);
    }

    const priceUsd = Number(formatUnits(answer, feedDecimals));
    if (!Number.isFinite(priceUsd) || priceUsd <= 0) throw new Error("CHAINLINK_PRICE_NUMBER_INVALID");

    return {
      token: config.token,
      priceUsd,
      observedAt: new Date(Number(updatedAt) * 1000).toISOString(),
      sourceRef: `chainlink:bsc:${config.feedLabel}:${config.feed}`,
      evidenceRef: `chainlink:bsc:${config.feed}:${roundId.toString()}:block:${blockNumber.toString()}`,
      blockNumber: blockNumber.toString(),
      chainId: 56,
      snapshotBlockHash: block.hash,
      feed: config.feed,
      feedLabel: config.feedLabel,
      feedDescription,
      feedDecimals,
      roundId: roundId.toString(),
      answeredInRound: answeredInRound.toString(),
      startedAt: Number(startedAt),
      updatedAt: Number(updatedAt),
      feedBytecodePresent: true,
      sourceUrl: config.sourceUrl
    };
  }
}
