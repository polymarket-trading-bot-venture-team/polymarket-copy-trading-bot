import "dotenv/config";
import type { ApiKeyCreds } from "@polymarket/clob-client";
import { utils, Wallet } from "ethers";

export type CopyStrategy = "PERCENT_USD" | "PERCENT_SHARES" | "FIXED_USD" | "FIXED_SHARES";
export type CopySide = "BUY" | "SELL" | "BOTH";

export interface Settings {
  privateKey: string;
  profileAddress: string;
  copyTraders: string[];
  clobApiUrl: string;
  chainId: number;
  dataApiUrl: string;
  alchemyPolygonWss: string | null;
  signatureType: number;
  copyStrategy: CopyStrategy;
  copyRatio: number;
  fixedUsd: number;
  fixedShares: number;
  minTradeUsd: number;
  maxTradeUsd: number;
  maxDailyVolumeUsd: number;
  maxPositionSizeUsd: number;
  copySide: CopySide;
  maxSlippageBps: number;
  enableMempoolDetection: boolean;
  pollIntervalMs: number;
  tradeLookbackSec: number;
  stateFile: string;
  dryRun: boolean;
  maxSeenTradesAgeSec: number;
  useServerTime: boolean;
  clobApiCreds: ApiKeyCreds | null;
  verboseLog: boolean;
}

function getEnv(name: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v === "" ? undefined : v;
}

function requireEnv(name: string): string {
  const v = getEnv(name);
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

function parseNum(name: string, fallback?: number): number {
  const raw = getEnv(name);
  if (raw === undefined) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing env: ${name}`);
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Invalid number for ${name}: ${raw}`);
  return n;
}

function parseBool(name: string, def = false): boolean {
  const raw = getEnv(name);
  if (!raw) return def;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function parseList(name: string, fallback: string[] = []): string[] {
  const raw = getEnv(name);
  if (!raw) return fallback;
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function assertAddress(name: string, value?: string): string | undefined {
  if (!value) return undefined;
  try {
    return utils.getAddress(value);
  } catch {
    throw new Error(`Invalid address for ${name}: ${value}`);
  }
}

function normalizeStrategy(raw?: string): CopyStrategy {
  if (!raw) return "PERCENT_USD";
  const v = raw.toUpperCase();
  if (["PERCENT_USD", "PERCENT", "PCT_USD"].includes(v)) return "PERCENT_USD";
  if (["PERCENT_SHARES", "PCT_SHARES"].includes(v)) return "PERCENT_SHARES";
  if (["FIXED_USD", "FIXED", "FLAT_USD"].includes(v)) return "FIXED_USD";
  if (["FIXED_SHARES", "FLAT_SHARES"].includes(v)) return "FIXED_SHARES";
  throw new Error(`Unsupported COPY_STRATEGY: ${raw}`);
}

function normalizeSide(raw?: string): CopySide {
  if (!raw) return "BOTH";
  const v = raw.toUpperCase();
  if (v === "BUY" || v === "SELL") return v;
  if (v === "BOTH" || v === "ALL") return "BOTH";
  throw new Error(`Unsupported COPY_SIDE: ${raw}`);
}

export function loadSettings(): Settings {
  const privateKey = requireEnv("PRIVATE_KEY");
  const profileRaw = assertAddress("PROFILE_ADDRESS", getEnv("PROFILE_ADDRESS"));
  const leaderWallet = getEnv("LEADER_WALLET");
  const copyTradersRaw = parseList("COPY_TRADERS");
  const copyTraders = copyTradersRaw.length > 0
    ? copyTradersRaw
    : leaderWallet
      ? [leaderWallet.toLowerCase()]
      : [];
  if (copyTraders.length === 0) throw new Error("COPY_TRADERS or LEADER_WALLET is required");
  for (const t of copyTraders) assertAddress("COPY_TRADERS", t);

  const derivedAddress = new Wallet(privateKey).address.toLowerCase();
  const signatureType = parseNum("SIGNATURE_TYPE", 1);

  if (signatureType === 1 || signatureType === 2) {
    if (!profileRaw) {
      throw new Error(
        "PROFILE_ADDRESS is required when SIGNATURE_TYPE is 1 (Magic/email) or 2 (browser proxy). Copy the wallet from polymarket.com/settings."
      );
    }
    if (profileRaw.toLowerCase() === derivedAddress) {
      throw new Error(
        "PROFILE_ADDRESS must be your Polymarket proxy wallet, not the same as the address derived from PRIVATE_KEY. For Magic login, export the key from reveal.magic.link/polymarket and use the proxy address shown on Polymarket."
      );
    }
  }

  const profileAddress = (profileRaw ?? derivedAddress)?.toLowerCase() ?? derivedAddress;

  const k = getEnv("CLOB_API_KEY");
  const s = getEnv("CLOB_API_SECRET") ?? getEnv("CLOB_SECRET");
  const pass = getEnv("CLOB_API_PASSPHRASE") ?? getEnv("CLOB_PASSPHRASE");
  let clobApiCreds: ApiKeyCreds | null = null;
  if (k && s && pass) {
    clobApiCreds = { key: k, secret: s, passphrase: pass };
  } else if (k || s || pass) {
    throw new Error(
      "Set all three: CLOB_API_KEY, CLOB_API_SECRET (or CLOB_SECRET), CLOB_API_PASSPHRASE (or CLOB_PASSPHRASE), or omit all to auto-derive API keys."
    );
  }

  return {
    privateKey,
    profileAddress,
    copyTraders,
    clobApiUrl: getEnv("CLOB_API_URL") ?? "https://clob.polymarket.com",
    chainId: parseNum("CHAIN_ID", 137),
    dataApiUrl: getEnv("DATA_API_URL") ?? "https://data-api.polymarket.com",
    alchemyPolygonWss: getEnv("ALCHEMY_POLYGON_WSS") ?? null,
    signatureType,
    copyStrategy: normalizeStrategy(getEnv("COPY_STRATEGY")),
    copyRatio: parseNum("COPY_RATIO", 0.7),
    fixedUsd: parseNum("FIXED_TRADE_USD", 10),
    fixedShares: parseNum("FIXED_TRADE_SHARES", 1),
    minTradeUsd: parseNum("MIN_TRADE_USD", 1),
    maxTradeUsd: parseNum("MAX_TRADE_USD", 1000),
    maxDailyVolumeUsd: parseNum("MAX_DAILY_VOLUME_USD", 10000),
    maxPositionSizeUsd: parseNum("MAX_POSITION_SIZE_USD", 5000),
    copySide: normalizeSide(getEnv("COPY_SIDE")),
    maxSlippageBps: parseNum("MAX_SLIPPAGE_BPS", 100),
    enableMempoolDetection: parseBool("ENABLE_MEMPOOL_DETECTION", false),
    pollIntervalMs: parseNum("POLL_INTERVAL_MS", 500),
    tradeLookbackSec: parseNum("TRADE_LOOKBACK_SEC", 300),
    stateFile: getEnv("STATE_FILE") ?? "./data/state.json",
    dryRun: parseBool("DRY_RUN", false),
    maxSeenTradesAgeSec: parseNum("MAX_SEEN_TRADES_AGE_SEC", 604800),
    useServerTime: parseBool("USE_SERVER_TIME", true),
    clobApiCreds,
    verboseLog: parseBool("VERBOSE_LOG", false),
  };
}
