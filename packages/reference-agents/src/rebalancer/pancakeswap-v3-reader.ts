import {
  createPublicClient,
  getAddress,
  http,
  type Address,
  type Hex
} from "viem";
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

export interface PancakeV3RawPositionSnapshot {
  chainId: 56;
  tokenId: string;
  owner: Address;
  operator: Address;
  token0: Address;
  token1: Address;
  fee: number;
  tickLower: number;
  tickUpper: number;
  positionLiquidity: bigint;
  tokensOwed0: bigint;
  tokensOwed1: bigint;
  pool: Address;
  sqrtPriceX96: bigint;
  currentTick: number;
  poolLiquidity: bigint;
  unlocked: boolean;
  blockNumber: bigint;
  observedAt: string;
}

export interface PancakeV3ReaderOptions {
  rpcUrl: string;
  factory?: Address;
  nonfungiblePositionManager?: Address;
  smartRouter?: Address;
  clock?: () => string;
}

export class PancakeV3BscReader {
  readonly id = "pancakeswap-v3-bsc-reader";
  private readonly client;
  private readonly factory: Address;
  private readonly positionManager: Address;
  private readonly smartRouter: Address;
  private readonly clock: () => string;

  constructor(options: PancakeV3ReaderOptions) {
    if (!options.rpcUrl) throw new Error("BSC_RPC_URL_REQUIRED");
    this.factory = getAddress(options.factory ?? PANCAKESWAP_V3_BSC.factory);
    this.positionManager = getAddress(
      options.nonfungiblePositionManager ?? PANCAKESWAP_V3_BSC.nonfungiblePositionManager
    );
    this.smartRouter = getAddress(options.smartRouter ?? PANCAKESWAP_V3_BSC.smartRouter);
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.client = createPublicClient({
      chain: BSC,
      transport: http(options.rpcUrl)
    });
  }

  async verifyConfiguredContracts(): Promise<{
    chainId: number;
    checkedAt: string;
    contracts: {
      factory: PancakeV3ContractEvidence;
      nonfungiblePositionManager: PancakeV3ContractEvidence;
      smartRouter: PancakeV3ContractEvidence;
    };
  }> {
    const [chainId, factoryCode, managerCode, routerCode] = await Promise.all([
      this.client.getChainId(),
      this.client.getBytecode({ address: this.factory }),
      this.client.getBytecode({ address: this.positionManager }),
      this.client.getBytecode({ address: this.smartRouter })
    ]);

    if (chainId !== PANCAKESWAP_V3_BSC.chainId) {
      throw new Error(`WRONG_CHAIN:${chainId}`);
    }

    return {
      chainId,
      checkedAt: this.clock(),
      contracts: {
        factory: this.codeEvidence(this.factory, factoryCode),
        nonfungiblePositionManager: this.codeEvidence(this.positionManager, managerCode),
        smartRouter: this.codeEvidence(this.smartRouter, routerCode)
      }
    };
  }

  async readPosition(tokenIdInput: string | bigint): Promise<PancakeV3RawPositionSnapshot> {
    const tokenId = BigInt(tokenIdInput);
    const [position, owner, blockNumber] = await Promise.all([
      this.client.readContract({
        address: this.positionManager,
        abi: POSITION_MANAGER_ABI,
        functionName: "positions",
        args: [tokenId]
      }),
      this.client.readContract({
        address: this.positionManager,
        abi: POSITION_MANAGER_ABI,
        functionName: "ownerOf",
        args: [tokenId]
      }),
      this.client.getBlockNumber()
    ]);

    const [
      ,
      operator,
      token0,
      token1,
      fee,
      tickLower,
      tickUpper,
      positionLiquidity,
      ,
      ,
      tokensOwed0,
      tokensOwed1
    ] = position;

    const pool = await this.client.readContract({
      address: this.factory,
      abi: FACTORY_ABI,
      functionName: "getPool",
      args: [token0, token1, fee]
    });

    if (pool === "0x0000000000000000000000000000000000000000") {
      throw new Error("PANCAKESWAP_POOL_NOT_FOUND");
    }

    const [slot0, poolLiquidity, poolCode] = await Promise.all([
      this.client.readContract({
        address: pool,
        abi: POOL_ABI,
        functionName: "slot0"
      }),
      this.client.readContract({
        address: pool,
        abi: POOL_ABI,
        functionName: "liquidity"
      }),
      this.client.getBytecode({ address: pool })
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
      fee,
      tickLower,
      tickUpper,
      positionLiquidity,
      tokensOwed0,
      tokensOwed1,
      pool: getAddress(pool),
      sqrtPriceX96,
      currentTick,
      poolLiquidity,
      unlocked,
      blockNumber,
      observedAt: this.clock()
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
