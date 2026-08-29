import fs from "node:fs/promises";
import path from "node:path";
import { AltanaSdkSessionRuntime } from "../packages/adapters/dist/index.js";
import { PancakeV3BscReader } from "../packages/reference-agents/dist/rebalancer/index.js";

const privateKey = process.env.KUMO_ALTANA_ADMIN_PRIVATE_KEY;
const rpcUrl = process.env.BSC_RPC_URL;
const positionId = process.env.KUMO_PANCAKE_POSITION_ID;
const expectedWalletAddress = process.env.KUMO_ALTANA_EXPECTED_WALLET_ADDRESS;
const outputPath = process.env.KUMO_EVIDENCE_PATH || "evidence/live/altana-wallet-preflight.json";

if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  throw new Error("KUMO_ALTANA_ADMIN_PRIVATE_KEY_REQUIRED_AS_32_BYTE_HEX");
}
if (positionId && !rpcUrl) throw new Error("BSC_RPC_URL_REQUIRED_WHEN_POSITION_ID_IS_SUPPLIED");

const runtime = new AltanaSdkSessionRuntime({
  adminPrivateKey: privateKey,
  network: "mainnet",
  ...(expectedWalletAddress ? { expectedWalletAddress } : {})
});
const walletAddress = await runtime.getWalletAddress();

const output = {
  schemaVersion: "kumo-altana-wallet-preflight-v1",
  generatedAt: new Date().toISOString(),
  classification: "LIVE_RUNTIME_PREFLIGHT_NOT_ONCHAIN_AUTHORITY_EVIDENCE",
  network: "BNB_MAINNET",
  chainId: runtime.executionChainId,
  walletAddress,
  privateKeyPersisted: false,
  position: undefined,
  ownership: positionId ? "PENDING" : "NOT_CHECKED_NO_POSITION_ID",
  status: positionId ? "WALLET_RESOLVED_POSITION_PENDING" : "WALLET_RESOLVED",
  limitations: [
    "Resolving an Altana wallet address is not proof that an on-chain session has been granted.",
    "No private key or session signer is written to this artifact.",
    "A Pancake V3 position is execution-eligible only if ownerOf(tokenId) equals this Altana wallet at a fresh finalized BSC block."
  ]
};

if (positionId) {
  const reader = new PancakeV3BscReader({
    rpcUrl,
    rpcProviderId: new URL(rpcUrl).hostname,
    purpose: "evidence"
  });
  const position = await reader.readPosition(positionId);
  const owned = position.owner.toLowerCase() === walletAddress.toLowerCase();
  output.position = {
    tokenId: position.tokenId,
    owner: position.owner,
    pool: position.pool,
    token0: position.token0,
    token1: position.token1,
    fee: position.fee,
    liquidity: position.positionLiquidity.toString(),
    blockNumber: position.blockNumber.toString(),
    blockHash: position.blockHash,
    observedAt: position.observedAt
  };
  output.ownership = owned ? "VERIFIED_OWNED_BY_ALTANA_WALLET" : "REJECTED_EXTERNAL_OWNER";
  output.status = owned ? "LIVE_POSITION_OWNERSHIP_PREFLIGHT_PASS" : "LIVE_POSITION_OWNERSHIP_PREFLIGHT_REJECT";
  if (!owned) process.exitCode = 2;
}

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify(output, null, 2));
