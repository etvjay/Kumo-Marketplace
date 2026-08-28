import {
  createPublicClient,
  getAddress,
  http,
  parseAbiItem,
  type Address,
  type Hash,
  type Hex
} from "viem";
import type { ChainSnapshot } from "@kumo/chain-state";
import { PANCAKESWAP_V3_BSC } from "./pancakeswap-v3.js";
import type { PancakeV3PositionDiscoveryEntry } from "./pancakeswap-v3-reader.js";

const POOL_MINT_EVENT = parseAbiItem(
  "event Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)"
);
const INCREASE_LIQUIDITY_EVENT = parseAbiItem(
  "event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)"
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

const FACTORY_ABI = [
  {
    type: "function",
    name: "getPool",
    stateMutability: "view",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
      { name: "fee", type: "uint24" }
    ],
    outputs: [{ name: "pool", type: "address" }]
  }
] as const;

const BSC = {
  id: 56,
  name: "BNB Smart Chain",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: { default: { http: [] as string[] } }
} as const;

type PoolMintLog = {
  blockNumber: bigint | null;
  logIndex: number | null;
  transactionHash: Hash | null;
};

type IncreaseLiquidityLog = {
  blockNumber: bigint | null;
  transactionHash: Hash | null;
  args: { tokenId?: bigint; liquidity?: bigint };
};

export interface PancakeV3PoolPositionDiscovery {
  snapshot: ChainSnapshot;
  pool: Address;
  fromBlock: string;
  toBlock: string;
  poolMintEvents: number;
  transactionsInspected: number;
  npmBlocksInspected: number;
  tokenIdsResolved: string[];
  survivingPositions: PancakeV3PositionDiscoveryEntry[];
}

export interface PancakeV3PoolPositionScannerOptions {
  rpcUrl: string;
  pool: Address | string;
  rpcProviderId?: string;
  nonfungiblePositionManager?: Address;
  factory?: Address;
  lookbackBlocks?: number;
  maxTransactions?: number;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
}

function isRangeLimit(error: unknown): boolean {
  const message = errorText(error);
  return message.includes("limit exceeded")
    || message.includes("too many results")
    || message.includes("query returned more than")
    || message.includes("response size exceeded");
}

/**
 * Pool-scoped position discovery avoids the global NPM Transfer firehose.
 * We find recent Pool.Mint transactions, query NPM IncreaseLiquidity logs for
 * those exact blocks, correlate by transaction hash, then revalidate each NFT
 * against the requested pool at the same finalized head.
 *
 * This deliberately avoids historical transaction-receipt APIs: some public
 * RPCs expose eth_getLogs but gate archive receipts behind credentials.
 */
export async function discoverRecentPancakeV3PositionsForPool(
  options: PancakeV3PoolPositionScannerOptions
): Promise<PancakeV3PoolPositionDiscovery> {
  if (!options.rpcUrl) throw new Error("BSC_RPC_URL_REQUIRED");
  const pool = getAddress(options.pool);
  const positionManager = getAddress(
    options.nonfungiblePositionManager ?? PANCAKESWAP_V3_BSC.nonfungiblePositionManager
  );
  const factory = getAddress(options.factory ?? PANCAKESWAP_V3_BSC.factory);
  const lookbackBlocks = Math.max(100, Math.min(200_000, options.lookbackBlocks ?? 50_000));
  const maxTransactions = Math.max(1, Math.min(256, options.maxTransactions ?? 96));
  const rpcProviderId = options.rpcProviderId ?? "bsc-rpc";
  const client = createPublicClient({ chain: BSC, transport: http(options.rpcUrl) });

  const chainId = await client.getChainId();
  if (chainId !== 56) throw new Error(`WRONG_CHAIN:${chainId}`);
  const head = await client.getBlock({ blockTag: "finalized" });
  if (head.number === null || head.hash === null) throw new Error("BSC_FINALIZED_BLOCK_IDENTITY_UNAVAILABLE");
  const oldest = head.number > BigInt(lookbackBlocks) ? head.number - BigInt(lookbackBlocks) : 0n;

  async function readPoolMints(fromBlock: bigint, toBlock: bigint): Promise<PoolMintLog[]> {
    try {
      const logs = await client.getLogs({
        address: pool,
        event: POOL_MINT_EVENT,
        fromBlock,
        toBlock
      });
      return logs as PoolMintLog[];
    } catch (error) {
      if (!isRangeLimit(error)) throw error;
      if (fromBlock >= toBlock) {
        throw new Error(`PANCAKE_POOL_MINT_SINGLE_BLOCK_LIMIT:${fromBlock.toString()}:${errorText(error)}`);
      }
      const middle = fromBlock + (toBlock - fromBlock) / 2n;
      const [left, right] = await Promise.all([
        readPoolMints(fromBlock, middle),
        readPoolMints(middle + 1n, toBlock)
      ]);
      return [...left, ...right];
    }
  }

  const mintLogs = await readPoolMints(oldest, head.number);
  mintLogs.sort((a, b) => {
    const blockA = a.blockNumber ?? 0n;
    const blockB = b.blockNumber ?? 0n;
    if (blockA < blockB) return 1;
    if (blockA > blockB) return -1;
    return (b.logIndex ?? 0) - (a.logIndex ?? 0);
  });

  const selectedMints: Array<{ transactionHash: Hash; blockNumber: bigint }> = [];
  const seenTransactions = new Set<string>();
  for (const log of mintLogs) {
    if (!log.transactionHash || log.blockNumber === null || seenTransactions.has(log.transactionHash)) continue;
    seenTransactions.add(log.transactionHash);
    selectedMints.push({ transactionHash: log.transactionHash, blockNumber: log.blockNumber });
    if (selectedMints.length >= maxTransactions) break;
  }

  const targetTransactionsByBlock = new Map<string, Set<string>>();
  for (const mint of selectedMints) {
    const key = mint.blockNumber.toString();
    const set = targetTransactionsByBlock.get(key) ?? new Set<string>();
    set.add(mint.transactionHash.toLowerCase());
    targetTransactionsByBlock.set(key, set);
  }

  const tokenIds: bigint[] = [];
  const seenTokenIds = new Set<string>();
  for (const [blockKey, targetTransactions] of targetTransactionsByBlock) {
    const blockNumber = BigInt(blockKey);
    const increaseLogs = await client.getLogs({
      address: positionManager,
      event: INCREASE_LIQUIDITY_EVENT,
      fromBlock: blockNumber,
      toBlock: blockNumber
    }) as IncreaseLiquidityLog[];

    for (const log of increaseLogs) {
      if (!log.transactionHash || !targetTransactions.has(log.transactionHash.toLowerCase())) continue;
      const tokenId = log.args.tokenId;
      if (tokenId === undefined) continue;
      const key = tokenId.toString();
      if (!seenTokenIds.has(key)) {
        seenTokenIds.add(key);
        tokenIds.push(tokenId);
      }
    }
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
      if (position[7] === 0n) continue;
      const resolvedPool = await client.readContract({
        address: factory,
        abi: FACTORY_ABI,
        functionName: "getPool",
        args: [position[2], position[3], position[4]],
        blockNumber: head.number
      });
      if (getAddress(resolvedPool) !== pool) continue;
      survivingPositions.push({
        tokenId: tokenId.toString(),
        owner: getAddress(owner),
        token0: getAddress(position[2]),
        token1: getAddress(position[3]),
        fee: position[4],
        liquidity: position[7]
      });
    } catch {
      // Burned or otherwise no longer a live position at the finalized head.
    }
  }

  const observedAt = new Date().toISOString();
  return {
    snapshot: {
      chainId: 56,
      purpose: "evidence",
      blockTag: "finalized",
      blockNumber: head.number.toString(),
      blockHash: head.hash as Hex,
      blockTimestamp: Number(head.timestamp),
      observedAt,
      rpcProviderId
    },
    pool,
    fromBlock: oldest.toString(),
    toBlock: head.number.toString(),
    poolMintEvents: mintLogs.length,
    transactionsInspected: selectedMints.length,
    npmBlocksInspected: targetTransactionsByBlock.size,
    tokenIdsResolved: tokenIds.map((tokenId) => tokenId.toString()),
    survivingPositions
  };
}
