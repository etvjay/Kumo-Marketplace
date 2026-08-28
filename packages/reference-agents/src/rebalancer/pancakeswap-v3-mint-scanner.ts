import {
  createPublicClient,
  getAddress,
  http,
  parseAbiItem,
  type Address,
  type Hex
} from "viem";
import type { ChainSnapshot } from "@kumo/chain-state";
import { PANCAKESWAP_V3_BSC } from "./pancakeswap-v3.js";
import type { PancakeV3PositionDiscoveryEntry } from "./pancakeswap-v3-reader.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"
);

const POSITION_MANAGER_READ_ABI = [
  {
    type: "function",
    name: "positions",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      { name: "nonce", type: "uint96" },
      { name: "operator", type: "address" },
      { name: "token0", type: "address" },
      { name: "token1", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "tickLower", type: "int24" },
      { name: "tickUpper", type: "int24" },
      { name: "liquidity", type: "uint128" },
      { name: "feeGrowthInside0LastX128", type: "uint256" },
      { name: "feeGrowthInside1LastX128", type: "uint256" },
      { name: "tokensOwed0", type: "uint128" },
      { name: "tokensOwed1", type: "uint128" }
    ]
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "owner", type: "address" }]
  }
] as const;

const BSC = {
  id: 56,
  name: "BNB Smart Chain",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: { default: { http: [] as string[] } }
} as const;

export interface PancakeV3MintDiscovery {
  snapshot: ChainSnapshot;
  fromBlock: string;
  toBlock: string;
  chunksScanned: number;
  adaptiveSplits: number;
  mintEventsSeen: number;
  survivingPositions: PancakeV3PositionDiscoveryEntry[];
}

export interface PancakeV3MintScannerOptions {
  rpcUrl: string;
  rpcProviderId?: string;
  nonfungiblePositionManager?: Address;
  lookbackBlocks?: number;
  chunkSize?: number;
  maxMintEvents?: number;
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    return `${error.message}\n${cause ? errorText(cause) : ""}`.toLowerCase();
  }
  return String(error).toLowerCase();
}

function isLogRangeLimitError(error: unknown): boolean {
  const message = errorText(error);
  return message.includes("limit exceeded")
    || message.includes("query returned more than")
    || message.includes("response size exceeded")
    || message.includes("too many results")
    || message.includes("block range") && message.includes("limit")
    || message.includes("eth_getlogs") && message.includes("limit");
}

function compareLogs(a: { blockNumber: bigint | null; logIndex: number | null }, b: { blockNumber: bigint | null; logIndex: number | null }): number {
  const blockA = a.blockNumber ?? 0n;
  const blockB = b.blockNumber ?? 0n;
  if (blockA < blockB) return -1;
  if (blockA > blockB) return 1;
  return (a.logIndex ?? 0) - (b.logIndex ?? 0);
}

/**
 * Finds recent NPM mints from finalized Transfer(0x0 -> owner, tokenId) logs,
 * then revalidates each token with ownerOf/positions at the same finalized head.
 * Burned NFTs are dropped rather than treated as live supply.
 */
export async function discoverRecentSurvivingPancakeV3Mints(
  options: PancakeV3MintScannerOptions
): Promise<PancakeV3MintDiscovery> {
  if (!options.rpcUrl) throw new Error("BSC_RPC_URL_REQUIRED");
  const lookbackBlocks = Math.max(100, Math.min(100_000, options.lookbackBlocks ?? 20_000));
  const chunkSize = Math.max(16, Math.min(5_000, options.chunkSize ?? 2_000));
  const maxMintEvents = Math.max(1, Math.min(512, options.maxMintEvents ?? 192));
  const positionManager = getAddress(
    options.nonfungiblePositionManager ?? PANCAKESWAP_V3_BSC.nonfungiblePositionManager
  );
  const rpcProviderId = options.rpcProviderId ?? "bsc-rpc";
  const client = createPublicClient({ chain: BSC, transport: http(options.rpcUrl) });

  const chainId = await client.getChainId();
  if (chainId !== 56) throw new Error(`WRONG_CHAIN:${chainId}`);
  const head = await client.getBlock({ blockTag: "finalized" });
  if (head.number === null || head.hash === null) throw new Error("BSC_FINALIZED_BLOCK_IDENTITY_UNAVAILABLE");

  const oldest = head.number > BigInt(lookbackBlocks)
    ? head.number - BigInt(lookbackBlocks)
    : 0n;
  const tokenIds: bigint[] = [];
  const seen = new Set<string>();
  let chunksScanned = 0;
  let adaptiveSplits = 0;
  let mintEventsSeen = 0;

  async function readMintLogs(fromBlock: bigint, toBlock: bigint): Promise<Awaited<ReturnType<typeof client.getLogs>>> {
    chunksScanned += 1;
    try {
      return await client.getLogs({
        address: positionManager,
        event: TRANSFER_EVENT,
        args: { from: ZERO_ADDRESS },
        fromBlock,
        toBlock
      });
    } catch (error) {
      if (!isLogRangeLimitError(error)) throw error;
      if (fromBlock >= toBlock) {
        throw new Error(`PANCAKE_MINT_LOG_SINGLE_BLOCK_LIMIT:${fromBlock.toString()}:${errorText(error)}`);
      }
      adaptiveSplits += 1;
      const midpoint = fromBlock + (toBlock - fromBlock) / 2n;
      const [left, right] = await Promise.all([
        readMintLogs(fromBlock, midpoint),
        readMintLogs(midpoint + 1n, toBlock)
      ]);
      return [...left, ...right].sort(compareLogs);
    }
  }

  let cursorTo = head.number;
  while (cursorTo >= oldest && tokenIds.length < maxMintEvents) {
    const proposedFrom = cursorTo >= BigInt(chunkSize - 1)
      ? cursorTo - BigInt(chunkSize - 1)
      : 0n;
    const cursorFrom = proposedFrom < oldest ? oldest : proposedFrom;
    const logs = await readMintLogs(cursorFrom, cursorTo);
    mintEventsSeen += logs.length;

    for (const log of [...logs].reverse()) {
      const tokenId = log.args.tokenId;
      if (tokenId === undefined) continue;
      const key = tokenId.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      tokenIds.push(tokenId);
      if (tokenIds.length >= maxMintEvents) break;
    }

    if (cursorFrom === 0n || cursorFrom === oldest) break;
    cursorTo = cursorFrom - 1n;
  }

  const survivingPositions: PancakeV3PositionDiscoveryEntry[] = [];
  for (const tokenId of tokenIds) {
    try {
      const [position, owner] = await Promise.all([
        client.readContract({
          address: positionManager,
          abi: POSITION_MANAGER_READ_ABI,
          functionName: "positions",
          args: [tokenId],
          blockNumber: head.number
        }),
        client.readContract({
          address: positionManager,
          abi: POSITION_MANAGER_READ_ABI,
          functionName: "ownerOf",
          args: [tokenId],
          blockNumber: head.number
        })
      ]);
      const liquidity = position[7];
      if (liquidity === 0n) continue;
      survivingPositions.push({
        tokenId: tokenId.toString(),
        owner: getAddress(owner),
        token0: getAddress(position[2]),
        token1: getAddress(position[3]),
        fee: position[4],
        liquidity
      });
    } catch {
      // Burned/nonexistent token: correctly excluded from live supply.
    }
  }

  const observedAt = new Date().toISOString();
  const snapshot: ChainSnapshot = {
    chainId: 56,
    purpose: "evidence",
    blockTag: "finalized",
    blockNumber: head.number.toString(),
    blockHash: head.hash as Hex,
    blockTimestamp: Number(head.timestamp),
    observedAt,
    rpcProviderId
  };

  return {
    snapshot,
    fromBlock: oldest.toString(),
    toBlock: head.number.toString(),
    chunksScanned,
    adaptiveSplits,
    mintEventsSeen,
    survivingPositions
  };
}
