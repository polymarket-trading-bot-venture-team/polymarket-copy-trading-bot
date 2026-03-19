import WebSocket from "ws";

const DATA_API_TRADES = "/trades";

export interface LeaderTrade {
  tradeId: string;
  transactionHash: string;
  conditionId: string;
  assetId: string;
  side: string;
  price: number;
  size: number;
  usdcSize: number;
  outcome: string;
  outcomeIndex: number;
  timestamp: number;
  proxyWallet: string;
}

interface RawTrade {
  asset?: string;
  conditionId?: string;
  side?: string;
  price?: number;
  size?: number;
  outcome?: string;
  outcomeIndex?: number;
  timestamp?: number;
  transactionHash?: string;
}

function tradeFromApi(raw: RawTrade & { proxyWallet?: string }, proxyWallet: string): LeaderTrade {
  const asset = raw.asset ?? "";
  const conditionId = raw.conditionId ?? "";
  const price = Number(raw.price ?? 0);
  const size = Number(raw.size ?? 0);
  const usdcSize = (raw as { usdcSize?: number }).usdcSize ?? size * price;
  return {
    tradeId: `${raw.timestamp ?? 0}_${raw.transactionHash ?? ""}`,
    transactionHash: raw.transactionHash ?? "",
    conditionId,
    assetId: asset,
    side: raw.side ?? "BUY",
    price,
    size,
    usdcSize,
    outcome: raw.outcome ?? "Yes",
    outcomeIndex: Number(raw.outcomeIndex ?? 0),
    timestamp: Number(raw.timestamp ?? 0),
    proxyWallet: (raw as { proxyWallet?: string }).proxyWallet ?? proxyWallet,
  };
}

export class TradesPoller {
  private seen = new Set<string>();

  constructor(
    private baseUrl: string,
    private copyTraders: string[],
    private pollIntervalMs: number = 500
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.copyTraders = copyTraders.map((a) => a.toLowerCase());
  }

  async fetchRecentTrades(): Promise<LeaderTrade[]> {
    const all: LeaderTrade[] = [];
    for (const trader of this.copyTraders) {
      const url = `${this.baseUrl}${DATA_API_TRADES}?user=${trader}&limit=50&takerOnly=true`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Trades API ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as RawTrade[];
      for (const item of data) {
        const t = tradeFromApi(item, trader);
        const key = t.transactionHash || `${t.timestamp}_${t.assetId}_${t.side}_${t.size}_${trader}`;
        if (!this.seen.has(key)) {
          this.seen.add(key);
          all.push(t);
        }
      }
    }
    return all.sort((a, b) => a.timestamp - b.timestamp);
  }

  async pollForever(onTrade: (t: LeaderTrade) => void | Promise<void>): Promise<never> {
    for (;;) {
      try {
        const newTrades = await this.fetchRecentTrades();
        for (const t of newTrades) {
          await onTrade(t);
        }
      } catch (e) {
        console.error("Trades poll error:", e);
      }
      await sleep(this.pollIntervalMs);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class MempoolWatcher {
  private leaderWallets: Set<string>;

  constructor(
    private wssUrl: string,
    leaderWallets: string[]
  ) {
    this.leaderWallets = new Set(leaderWallets.map((a) => a.toLowerCase()));
  }

  async watch(onPending: (txHash: string) => void): Promise<never> {
    for (;;) {
      try {
        const ws = new WebSocket(this.wssUrl);
        await new Promise<void>((resolve, reject) => {
          ws.on("open", () => resolve());
          ws.on("error", reject);
        });

        const sub = {
          jsonrpc: "2.0",
          id: 1,
          method: "eth_subscribe",
          params: [
            "alchemy_pendingTransactions",
            { fromAddress: [...this.leaderWallets], hashesOnly: false },
          ],
        };
        ws.send(JSON.stringify(sub));

        const subResult = await new Promise<string>((resolve, reject) => {
          ws.once("message", (data: Buffer | string) => resolve(data.toString()));
          ws.once("error", reject);
        });
        const parsed = JSON.parse(subResult);
        if (parsed.result) {
          console.info(`Mempool subscription active for ${this.leaderWallets.size} trader(s)`);
        }

        ws.on("message", (data: Buffer | string) => {
          try {
            const obj = JSON.parse(data.toString());
            const res = obj?.params?.result;
            if (res && typeof res === "object" && this.leaderWallets.has(res.from?.toLowerCase())) {
              const hash = res.hash;
              if (hash) onPending(hash);
            }
          } catch {}
        });

        await new Promise<void>((resolve) => {
          ws.on("close", () => resolve());
          ws.on("error", () => resolve());
        });
      } catch (e) {
        console.error("Mempool watcher error:", e);
      }
      await sleep(5000);
    }
  }
}
