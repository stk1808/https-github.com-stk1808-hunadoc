// Real XRPL Testnet integration.
// Generates a deterministic test wallet on first run and broadcasts a Memo-bearing
// Payment transaction (1 drop self-payment) carrying the SHA-256 of the document.
import { Client, Wallet, xrpToDrops } from "xrpl";
import crypto from "crypto";
import fs from "fs";
import path from "path";

const TESTNET_WS = "wss://s.altnet.rippletest.net:51233";
const EXPLORER_BASE = "https://testnet.xrpl.org";
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const WALLET_FILE = path.join(DATA_DIR, "xrpl-wallet.json");
const PAYER_WALLET_FILE = path.join(DATA_DIR, "xrpl-payer-wallet.json");

let cachedWallet: Wallet | null = null;
let cachedPayerWallet: Wallet | null = null;
let client: Client | null = null;

async function getClient(): Promise<Client> {
  if (client && client.isConnected()) return client;
  client = new Client(TESTNET_WS);
  await client.connect();
  return client;
}

async function getWallet(): Promise<Wallet> {
  if (cachedWallet) return cachedWallet;

  // 1) Prefer env var (for production hosts like Render where there's no
  //    persistent disk by default). Set XRPL_WALLET_SEED in the host's env.
  const envSeed = process.env.XRPL_WALLET_SEED;
  if (envSeed && envSeed.trim().length > 0) {
    cachedWallet = Wallet.fromSeed(envSeed.trim());
    console.log(`[XRPL] Loaded wallet from env: ${cachedWallet.address}`);
    return cachedWallet;
  }

  // 2) Load persisted seed from disk (local dev convenience)
  if (fs.existsSync(WALLET_FILE)) {
    const data = JSON.parse(fs.readFileSync(WALLET_FILE, "utf-8"));
    cachedWallet = Wallet.fromSeed(data.seed);
    return cachedWallet;
  }

  // 3) First run: fund a new testnet wallet via faucet
  const c = await getClient();
  const fundResult = await c.fundWallet();
  cachedWallet = fundResult.wallet;

  try {
    fs.mkdirSync(path.dirname(WALLET_FILE), { recursive: true });
    fs.writeFileSync(
      WALLET_FILE,
      JSON.stringify({ seed: cachedWallet.seed, address: cachedWallet.address }, null, 2)
    );
  } catch (e) {
    // Read-only filesystem (e.g. Render without disk) — fine, fall through
    console.warn(`[XRPL] Could not persist wallet to disk: ${(e as Error).message}`);
  }
  console.log(`[XRPL] Funded new testnet wallet ${cachedWallet.address}`);
  console.log(`[XRPL] Seed: ${cachedWallet.seed}  (save this as XRPL_WALLET_SEED env var)`);
  return cachedWallet;
}

/**
 * Second wallet that acts as the SIMULATED PBM payer for T0 settlements.
 * Real XRPL Testnet wallet — sends real Payment transactions to the pharmacy wallet.
 */
async function getPayerWallet(): Promise<Wallet> {
  if (cachedPayerWallet) return cachedPayerWallet;

  const envSeed = process.env.XRPL_PAYER_SEED;
  if (envSeed && envSeed.trim().length > 0) {
    cachedPayerWallet = Wallet.fromSeed(envSeed.trim());
    console.log(`[XRPL payer] Loaded payer wallet from env: ${cachedPayerWallet.address}`);
    return cachedPayerWallet;
  }

  if (fs.existsSync(PAYER_WALLET_FILE)) {
    const data = JSON.parse(fs.readFileSync(PAYER_WALLET_FILE, "utf-8"));
    cachedPayerWallet = Wallet.fromSeed(data.seed);
    return cachedPayerWallet;
  }

  const c = await getClient();
  const fundResult = await c.fundWallet();
  cachedPayerWallet = fundResult.wallet;
  try {
    fs.mkdirSync(path.dirname(PAYER_WALLET_FILE), { recursive: true });
    fs.writeFileSync(
      PAYER_WALLET_FILE,
      JSON.stringify({ seed: cachedPayerWallet.seed, address: cachedPayerWallet.address }, null, 2)
    );
  } catch (e) {
    console.warn(`[XRPL payer] Could not persist payer wallet to disk: ${(e as Error).message}`);
  }
  console.log(`[XRPL payer] Funded new testnet payer wallet ${cachedPayerWallet.address}`);
  console.log(`[XRPL payer] Seed: ${cachedPayerWallet.seed}  (save this as XRPL_PAYER_SEED env var)`);
  return cachedPayerWallet;
}

export interface SettlementResult {
  txHash: string;
  ledgerSequence: number;
  documentHash: string;
  explorerUrl: string;
  network: "testnet";
  payerAddress: string;
  pharmacyAddress: string;
  amountXrp: number;
}

/**
 * Send a real XRPL Testnet Payment transaction from the SIMULATED PBM payer wallet
 * to the pharmacy's HunaDoc wallet, anchoring the claim/settlement memo on chain.
 *
 * The PBM adjudication itself is mocked, but the on-chain payment is a real Testnet tx.
 */
export async function settleClaimOnXRPL(
  amountXrp: number,
  documentJson: object,
  entityRef: string
): Promise<SettlementResult> {
  const docString = JSON.stringify(documentJson, Object.keys(documentJson).sort());
  const documentHash = sha256(docString);
  const memoSummary = `HunaDoc:settlement:${entityRef}:pay`;

  const c = await getClient();
  const payer = await getPayerWallet();
  const pharmacy = await getWallet();

  const drops = xrpToDrops(amountXrp.toFixed(6));
  const prepared = await c.autofill({
    TransactionType: "Payment",
    Account: payer.address,
    Destination: pharmacy.address,
    Amount: drops,
    Memos: [
      {
        Memo: {
          MemoType: toMemoHex("hunadoc/v1"),
          MemoData: toMemoHex(documentHash),
          MemoFormat: toMemoHex(memoSummary),
        },
      },
    ],
  });

  const signed = payer.sign(prepared);
  const result = await c.submitAndWait(signed.tx_blob);
  const txHash = signed.hash;
  const ledgerSequence = (result.result as any).ledger_index ?? 0;

  const meta = (result.result.meta as any) ?? {};
  const txResult = meta.TransactionResult ?? "unknown";
  if (txResult !== "tesSUCCESS") {
    throw new Error(`XRPL settlement failed: ${txResult}`);
  }

  return {
    txHash,
    ledgerSequence,
    documentHash,
    explorerUrl: `${EXPLORER_BASE}/transactions/${txHash}`,
    network: "testnet",
    payerAddress: payer.address,
    pharmacyAddress: pharmacy.address,
    amountXrp,
  };
}

export async function getPayerWalletInfo() {
  const w = await getPayerWallet();
  const c = await getClient();
  try {
    const info = await c.request({
      command: "account_info",
      account: w.address,
      ledger_index: "validated",
    });
    return {
      address: w.address,
      balanceXRP: Number((info.result.account_data as any).Balance) / 1_000_000,
      sequence: (info.result.account_data as any).Sequence,
      explorerUrl: `${EXPLORER_BASE}/accounts/${w.address}`,
      network: "testnet",
    };
  } catch (e: any) {
    return { address: w.address, balanceXRP: 0, sequence: 0, explorerUrl: `${EXPLORER_BASE}/accounts/${w.address}`, network: "testnet", error: e.message };
  }
}

export function sha256(input: string | Buffer): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function toMemoHex(s: string): string {
  return Buffer.from(s, "utf-8").toString("hex").toUpperCase();
}

export interface BroadcastResult {
  txHash: string;
  ledgerSequence: number;
  documentHash: string;
  explorerUrl: string;
  network: "testnet";
}

/**
 * Broadcast a document fingerprint to the XRP Ledger Testnet.
 * The full document is NEVER sent to the ledger — only its SHA-256 hash inside a Memo.
 *
 * @param documentJson - The canonical document payload (will be hashed)
 * @param entityType - e.g. "prescription", "license", "shift", "visit"
 * @param entityRef - e.g. "Rx-29481" or "License-441"
 * @param action - "sign", "verify", "accept", "complete"
 */
export async function broadcastToXRPL(
  documentJson: object,
  entityType: string,
  entityRef: string,
  action: string
): Promise<BroadcastResult> {
  const docString = JSON.stringify(documentJson, Object.keys(documentJson).sort());
  const documentHash = sha256(docString);
  const memoSummary = `HunaDoc:${entityType}:${entityRef}:${action}`;

  const c = await getClient();
  const w = await getWallet();

  // Use AccountSet (a self-targeted no-op) so we can carry Memos without
  // needing a separate destination account. This avoids the temREDUNDANT
  // result that Payment-to-self triggers on XRPL.
  const prepared = await c.autofill({
    TransactionType: "AccountSet",
    Account: w.address,
    Memos: [
      {
        Memo: {
          MemoType: toMemoHex("hunadoc/v1"),
          MemoData: toMemoHex(documentHash),
          MemoFormat: toMemoHex(memoSummary),
        },
      },
    ],
  });

  const signed = w.sign(prepared);
  const result = await c.submitAndWait(signed.tx_blob);

  const meta = (result.result.meta as any) ?? {};
  const validated = (result.result as any).validated;
  const txHash = signed.hash;
  const ledgerSequence = (result.result as any).ledger_index ?? 0;

  return {
    txHash,
    ledgerSequence,
    documentHash,
    explorerUrl: `${EXPLORER_BASE}/transactions/${txHash}`,
    network: "testnet",
  };
}

/**
 * Get the test wallet's current state — for the operator dashboard.
 */
export async function getWalletInfo() {
  const w = await getWallet();
  const c = await getClient();
  try {
    const info = await c.request({
      command: "account_info",
      account: w.address,
      ledger_index: "validated",
    });
    return {
      address: w.address,
      balanceXRP: Number((info.result.account_data as any).Balance) / 1_000_000,
      sequence: (info.result.account_data as any).Sequence,
      explorerUrl: `${EXPLORER_BASE}/accounts/${w.address}`,
      network: "testnet",
    };
  } catch (e: any) {
    return { address: w.address, balanceXRP: 0, sequence: 0, explorerUrl: `${EXPLORER_BASE}/accounts/${w.address}`, network: "testnet", error: e.message };
  }
}

export async function disconnectXRPL() {
  if (client && client.isConnected()) await client.disconnect();
}
