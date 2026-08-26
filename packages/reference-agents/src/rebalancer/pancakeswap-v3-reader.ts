import {
  createPublicClient,
  getAddress,
  http,
  type Address,
  type Hex
} from "viem";
import {
  defaultBscStateReadPolicy,
  type ChainSnapshot,
  type EvmBlockTag,
  type ObservationPurpose
} from "@kumo/chain-state";
import { PANCAKESWAP_V3_BSC } from "./pancakeswap-v3.js";

const POSITION_MANAGER_ABI = [
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
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "totalSupply", type: "uint256" }]
  },
  {
    type: "function",
    name: "tokenByIndex",
    stateMutability: "view",
    inputs: [{ name: "index", type: "uint256" }],
    outputs: [{ name: "tokenId", type: "uint256" }]
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

const POOL_ABI = [
  {
    type: "function",
    name: "slot0",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "observationIndex", type: "uint16" },
      { name: "observationCardinality", type: "uint16" },
      { name: "observationCardinalityNext", type: "uint16" },
      { name: "feeProtocol", type: "uint32" },
      { name: "unlocked", type: "bool" }
    ]
  },
  {
    type: "function",
    name: "liquidity",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "liquidity", type: "uint128" }]
  }
] as const;

const ERC20_METADATA_ABI = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "decimals", type: "uint8" }]
  }
] as const;

const BSC = {
  id: 56,
  name: "BNB Smart Chain",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: { default: { http: [] as string[] } }
} as const;

export interface PancakeV3ContractEvidence {
  address: Address;
  bytecodePresent: boolean;
  bytecodePrefix?: Hex;
}

export interface PancakeV3PositionDiscoveryEntry {
  tokenId: string;
  owner: Address;
  token0: Address;
  token1: Address;
  fee: number;
  liquidity: bigint;
}

export interface PancakeV3PositionDiscovery {
  snapshot: ChainSnapshot;
  totalSupply: string;
  scanned: number;
  positions: PancakeV3PositionDiscoveryEntry[];
}

export interface PancakeV3RawPositionSnapshot {
  chainId: 56;
  tokenId: string;
  owner: Address;
  operator: Address;
  token0: Address;
  token1: Address;
  token0Decimals: number;
  token1Decimals: number;
  fee: number;
  tickLower: number;
  tickUpper: number;
  positionLiquidity: bigint;
  feeGrowthInside0LastX128: bigint;
  feeGrowthInside1LastX128: bigint;
  tokensOwed0: bigint;
  tokensOwed1: bigint;
  pool: Address;
  sqrtPriceX96: bigint;
  currentTick: number;
  poolLiquidity: bigint;
  unlocked: boolean;
  blockNumber: bigint;
  blockHash: Hex;
  blockTimestamp: number;
  blockTag: EvmBlockTag;
  purpose: ObservationPurpose;
  snapshot: ChainSnapshot;
  observedAt: string;
}

export interface PancakeV3ReaderOptions {
  rpcUrl: string;
  rpcProviderId?: string;
  purpose?: ObservationPurpose;
  blockTag?: EvmBlockTag;
  factory?: Address;
  nonfungiblePositionManager?: Address;
  legacySmartRouter?: Address;
  v3UniversalRouter?: Address;
  permit2?: Address;
  clock?: () => string;
}

export class PancakeV3BscReader {
  readonly id = "pancakeswap-v3-bsc-reader";
  private readonly client;
  private readonly factory: Address;
  private readonly positionManager: Address;
  private readonly legacySmartRouter: Address;
  private readonly v3UniversalRouter: Address;
  private readonly permit2: Address;
  private readonly purpose: ObservationPurpose;
  private readonly blockTag: EvmBlockTag;
  private readonly rpcProviderId: string;
  private readonly clock: () => string;

  constructor(options: PancakeV3ReaderOptions) {
    if (!options.rpcUrl) throw new Error("BSC_RPC_URL_REQUIRED");
    this.factory = getAddress(options.factory ?? PANCAKESWAP_V3_BSC.factory);
    this.positionManager = getAddress(
      options.nonfungiblePositionManager ?? PANCAKESWAP_V3_BSC.nonfungiblePositionManager
    );
    this.legacySmartRouter = getAddress(options.legacySmartRouter ?? PANCAKESWAP_V3_BSC.legacySmartRouter);
    this.v3UniversalRouter = getAddress(options.v3UniversalRouter ?? PANCAKESWAP_V3_BSC.v3UniversalRouter);
    this.permit2 = getAddress(options.permit2 ?? PANCAKESWAP_V3_BSC.permit2);
    this.purpose = options.purpose ?? "evidence";
    this.blockTag = options.blockTag ?? defaultBscStateReadPolicy(this.purpose).blockTag;
    this.rpcProviderId = options.rpcProviderId ?? "bsc-rpc";
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.client = createPublicClient({ chain: BSC, transport: http(options.rpcUrl) });
  }

  async verifyConfiguredContracts(): Promise<{
    snapshot: ChainSnapshot;
    contracts: {
      factory: PancakeV3ContractEvidence;
      nonfungiblePositionManager: PancakeV3ContractEvidence;
      legacySmartRouter: PancakeV3ContractEvidence;
      v3UniversalRouter: PancakeV3ContractEvidence;
      permit2: PancakeV3ContractEvidence;
    };
  }> {
    const frozen = await this.freezeBlock();
    const [factoryCode, managerCode, legacyRouterCode, universalRouterCode, permit2Code] = await Promise.all([
      this.client.getBytecode({ address: this.factory, blockNumber: frozen.blockNumber }),
      this.client.getBytecode({ address: this.positionManager, blockNumber: frozen.blockNumber }),
      this.client.getBytecode({ address: this.legacySmartRouter, blockNumber: frozen.blockNumber }),
      this.client.getBytecode({ address: this.v3UniversalRouter, blockNumber: frozen.blockNumber }),
      this.client.getBytecode({ address: this.permit2, blockNumber: frozen.blockNumber })
    ]);

    return {
      snapshot: frozen.snapshot,
      contracts: {
        factory: this.codeEvidence(this.factory, factoryCode),
        nonfungiblePositionManager: this.codeEvidence(this.positionManager, managerCode),
        legacySmartRouter: this.codeEvidence(this.legacySmartRouter, legacyRouterCode),
        v3UniversalRouter: this.codeEvidence(this.v3UniversalRouter, universalRouterCode),
        permit2: this.codeEvidence(this.permit2, permit2Code)
      }
    };
  }

  /**
   * Enumerates the newest currently existing ERC-721 positions at one frozen
   * block. This is discovery only; a selected NFT must still be re-read through
   * readPosition before it becomes economic evidence.
   */
  async discoverRecentPositions(maxCandidates = 32): Promise<PancakeV3PositionDiscovery> {
    if (!Number.isInteger(maxCandidates) || maxCandidates <= 0 || maxCandidates > 256) {
      throw new Error("PANCAKE_DISCOVERY_LIMIT_INVALID");
    }

    const frozen = await this.freezeBlock();
    const totalSupply = await this.client.readContract({
      address: this.positionManager,
      abi: POSITION_MANAGER_ABI,
      functionName: "totalSupply",
      blockNumber: frozen.blockNumber
    });

    const count = Number(totalSupply < BigInt(maxCandidates) ? totalSupply : BigInt(maxCandidates));
    const start = totalSupply - BigInt(count);
    const indices = Array.from({ length: count }, (_, offset) => start + BigInt(offset));
    const tokenIds = await Promise.all(indices.map((index) => this.client.readContract({
      address: this.positionManager,
      abi: POSITION_MANAGER_ABI,
      functionName: "tokenByIndex",
      args: [index],
      blockNumber: frozen.blockNumber
    })));

    const positions = await Promise.all(tokenIds.reverse().map(async (tokenId) => {
      const [position, owner] = await Promise.all([
        this.client.readContract({
          address: this.positionManager,
          abi: POSITION_MANAGER_ABI,
          functionName: "positions",
          args: [tokenId],
          blockNumber: frozen.blockNumber
        }),
        this.client.readContract({
          address: this.positionManager,
          abi: POSITION_MANAGER_ABI,
          functionName: "ownerOf",
          args: [tokenId],
          blockNumber: frozen.blockNumber
        })
      ]);

      return {
        tokenId: tokenId.toString(),
        owner: getAddress(owner),
        token0: getAddress(position[2]),
        token1: getAddress(position[3]),
        fee: position[4],
        liquidity: position[7]
      } satisfies PancakeV3PositionDiscoveryEntry;
    }));

    return {
      snapshot: frozen.snapshot,
      totalSupply: totalSupply.toString(),
      scanned: positions.length,
      positions
    };
  }

  async readPosition(tokenIdInput: string | bigint): Promise<PancakeV3RawPositionSnapshot> {
    const tokenId = BigInt(tokenIdInput);
    const frozen = await this.freezeBlock();

    const [position, owner] = await Promise.all([
      this.client.readContract({
        address: this.positionManager,
        abi: POSITION_MANAGER_ABI,
        functionName: "positions",
        args: [tokenId],
        blockNumber: frozen.blockNumber
      }),
      this.client.readContract({
        address: this.positionManager,
        abi: POSITION_MANAGER_ABI,
        functionName: "ownerOf",
        args: [tokenId],
        blockNumber: frozen.blockNumber
      })
    ]);

    const [
      , operator, token0, token1, fee, tickLower, tickUpper, positionLiquidity,
      feeGrowthInside0LastX128, feeGrowthInside1LastX128, tokensOwed0, tokensOwed1
    ] = position;

    const pool = await this.client.readContract({
      address: this.factory,
      abi: FACTORY_ABI,
      functionName: "getPool",
      args: [token0, token1, fee],
      blockNumber: frozen.blockNumber
    });

    if (pool === "0x0000000000000000000000000000000000000000") {
      throw new Error("PANCAKESWAP_POOL_NOT_FOUND");
    }

    const [slot0, poolLiquidity, poolCode, token0Decimals, token1Decimals] = await Promise.all([
      this.client.readContract({
        address: pool,
        abi: POOL_ABI,
        functionName: "slot0",
        blockNumber: frozen.blockNumber
      }),
      this.client.readContract({
        address: pool,
        abi: POOL_ABI,
        functionName: "liquidity",
        blockNumber: frozen.blockNumber
      }),
      this.client.getBytecode({ address: pool, blockNumber: frozen.blockNumber }),
      this.client.readContract({
        address: token0,
        abi: ERC20_METADATA_ABI,
        functionName: "decimals",
        blockNumber: frozen.blockNumber
      }),
      this.client.readContract({
        address: token1,
        abi: ERC20_METADATA_ABI,
        functionName: "decimals",
        blockNumber: frozen.blockNumber
      })
    ]);

    if (!poolCode || poolCode === "0x") throw new Error("PANCAKESWAP_POOL_CODE_MISSING");

    const [sqrtPriceX96, currentTick, , , , , unlocked] = slot0;

    return {
      chainId: 56,
      tokenId: tokenId.toString(),
      owner: getAddress(owner),
      operator: getAddress(operator),
      token0: getAddress(token0),
      token1: getAddress(token1),
      token0Decimals,
      token1Decimals,
      fee,
      tickLower,
      tickUpper,
      positionLiquidity,
      feeGrowthInside0LastX128,
      feeGrowthInside1LastX128,
      tokensOwed0,
      tokensOwed1,
      pool: getAddress(pool),
      sqrtPriceX96,
      currentTick,
      poolLiquidity,
      unlocked,
      blockNumber: frozen.blockNumber,
      blockHash: frozen.blockHash,
      blockTimestamp: frozen.snapshot.blockTimestamp,
      blockTag: frozen.snapshot.blockTag,
      purpose: frozen.snapshot.purpose,
      snapshot: frozen.snapshot,
      observedAt: frozen.snapshot.observedAt
    };
  }

  private async freezeBlock(): Promise<{
    blockNumber: bigint;
    blockHash: Hex;
    snapshot: ChainSnapshot;
  }> {
    const chainId = await this.client.getChainId();
    if (chainId !== PANCAKESWAP_V3_BSC.chainId) throw new Error(`WRONG_CHAIN:${chainId}`);

    const block = await this.client.getBlock({ blockTag: this.blockTag });
    if (block.number === null || block.hash === null) throw new Error("BSC_BLOCK_IDENTITY_UNAVAILABLE");

    const observedAt = this.clock();
    return {
      blockNumber: block.number,
      blockHash: block.hash,
      snapshot: {
        chainId,
        purpose: this.purpose,
        blockTag: this.blockTag,
        blockNumber: block.number.toString(),
        blockHash: block.hash,
        blockTimestamp: Number(block.timestamp),
        observedAt,
        rpcProviderId: this.rpcProviderId
      }
    };
  }

  private codeEvidence(address: Address, bytecode: Hex | undefined): PancakeV3ContractEvidence {
    const present = Boolean(bytecode && bytecode !== "0x");
    return {
      address,
      bytecodePresent: present,
      bytecodePrefix: present && bytecode ? (`${bytecode.slice(0, 18)}` as Hex) : undefined
    };
  }
}
