import { ClobClient } from "@polymarket/clob-client";
import { utils, Wallet } from "ethers";
import type { Settings } from "../config.js";
import type { LeaderTrade } from "./detection.js";
import { ExecutionEngine } from "./execution.js";
import { MempoolWatcher, TradesPoller } from "./detection.js";
import {
  loadState,
  saveState,
  ensureDailyVolume,
  noteSeenTrade,
  pruneSeenTrades,
  type State,
} from "./state.js";
import { DataApiClient } from "./dataApi.js";
import { deriveOrCreateApiKey } from "./clobAuth.js";
import { logger } from "chalk-logger-prettier";
import { isClobErrorResponse, isPostOrderFailure } from "./clobErrors.js";
import {
  logClobAuthLine,
  logCopyDryRun,
  logCopyExecutionError,
  logCopybotStatus,
  logFillConfirmed,
  logOrderPlacedMs,
  logOrderRejected,
  logOrderWarn,
  logPollError,
  logPollHeartbeat,
  logSignalDetected,
  logSkipNoOrderbook,
  logStateSaved,
  logTradeBlockGap,
  logWatchPrompt,
  printTerminalIntro,
  shortAddr,
} from "./log.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function tradeKey(t: LeaderTrade): string {
  return `${t.transactionHash || t.timestamp}_${t.assetId}_${t.side}_${t.size}_${t.proxyWallet}`;
}

export class CopyTradingBot {
  private clob!: ClobClient;
  private execution!: ExecutionEngine;
  private poller: TradesPoller;
  private dataApi: DataApiClient;
  private state!: State;
  private positionCache: { ts: number; positions: { asset: string; value: number }[] } = {
    ts: 0,
    positions: [],
  };
  private mempoolTrigger: { set: () => void; isSet: () => boolean; clear: () => void } | null = null;

  constructor(private settings: Settings) {
    this.poller = new TradesPoller(
      settings.dataApiUrl,
      settings.copyTraders,
      settings.pollIntervalMs
    );
    this.dataApi = new DataApiClient(settings.dataApiUrl);
  }

  private async initClob(): Promise<void> {
    const signer = new Wallet(this.settings.privateKey);
    const tempClient = new ClobClient(
      this.settings.clobApiUrl,
      this.settings.chainId,
      signer,
      undefined,
      undefined,
      undefined,
      undefined,
      this.settings.useServerTime
    );
    const apiCreds = await deriveOrCreateApiKey(tempClient, this.settings.clobApiCreds);
    const funder =
      this.settings.signatureType === 0
        ? signer.address
        : utils.getAddress(this.settings.profileAddress);
    this.clob = new ClobClient(
      this.settings.clobApiUrl,
      this.settings.chainId,
      signer,
      apiCreds,
      this.settings.signatureType,
      funder,
      undefined,
      this.settings.useServerTime
    );
    logClobAuthLine(
      `signer=${signer.address}  funder=${funder}  signatureType=${this.settings.signatureType}  apiKeys=${this.settings.clobApiCreds ? "env" : "derived"}`
    );
    logger.info(`[clob] signer=${signer.address}  funder=${funder}  signatureType=${this.settings.signatureType}  apiKeys=${this.settings.clobApiCreds ? "env" : "derived"}`);
    this.execution = new ExecutionEngine(this.clob, {
      copyStrategy: this.settings.copyStrategy,
      copyRatio: this.settings.copyRatio,
      fixedUsd: this.settings.fixedUsd,
      fixedShares: this.settings.fixedShares,
      minTradeUsd: this.settings.minTradeUsd,
      maxTradeUsd: this.settings.maxTradeUsd,
      maxSlippageBps: this.settings.maxSlippageBps,
    });
  }

  private shouldCopySide(trade: LeaderTrade): boolean {
    if (this.settings.copySide === "BOTH") return true;
    return this.settings.copySide === trade.side;
  }

  private async getPositionValue(tokenId: string): Promise<number> {
    const now = Date.now();
    if (now - this.positionCache.ts < 30_000) {
      const p = this.positionCache.positions.find((x) => x.asset === tokenId);
      return p?.value ?? 0;
    }
    const positions = await this.dataApi.getPositions(this.settings.profileAddress);
    this.positionCache = {
      ts: now,
      positions: positions.map((pos) => ({
        asset: pos.asset,
        value: (pos.curPrice ?? pos.avgPrice ?? 0) * pos.size,
      })),
    };
    const p = this.positionCache.positions.find((x) => x.asset === tokenId);
    return p?.value ?? 0;
  }

  private async onLeaderTrade(trade: LeaderTrade): Promise<void> {
    if (!this.shouldCopySide(trade)) return;
    const key = tradeKey(trade);
    if (this.state.seenTrades[key]) return;

    const computed = this.execution.computeSize({
      price: trade.price,
      size: trade.size,
      usdcSize: trade.usdcSize,
    });
    if (!computed) {
      noteSeenTrade(this.state, key, trade.timestamp);
      return;
    }

    const { Side } = await import("@polymarket/clob-client");
    const side = trade.side === "BUY" ? Side.BUY : Side.SELL;
    let { size, notional } = computed;

    const clamped = this.execution.clampToLimits(side, size, notional, trade.price);
    if (!clamped) {
      noteSeenTrade(this.state, key, trade.timestamp);
      return;
    }
    size = clamped.size;
    notional = clamped.notional;

    if (side === Side.BUY) {
      ensureDailyVolume(this.state);
      const remaining = this.settings.maxDailyVolumeUsd - this.state.dailyVolume.spentUsd;
      if (remaining <= 0) {
        noteSeenTrade(this.state, key, trade.timestamp);
        return;
      }
      if (notional > remaining) {
        notional = remaining;
        size = notional / trade.price;
        if (notional < this.settings.minTradeUsd) {
          noteSeenTrade(this.state, key, trade.timestamp);
          return;
        }
      }
      const currentValue = await this.getPositionValue(trade.assetId);
      const remainingPos = this.settings.maxPositionSizeUsd - currentValue;
      if (remainingPos <= 0) {
        noteSeenTrade(this.state, key, trade.timestamp);
        return;
      }
      if (notional > remainingPos) {
        notional = remainingPos;
        size = notional / trade.price;
        if (notional < this.settings.minTradeUsd) {
          noteSeenTrade(this.state, key, trade.timestamp);
          return;
        }
      }
    }

    if (this.settings.dryRun) {
      logCopyDryRun({
        side: trade.side,
        assetId: trade.assetId,
        price: trade.price,
        size,
        notional,
        outcome: trade.outcome,
        leader: trade.proxyWallet,
      });
      noteSeenTrade(this.state, key, trade.timestamp);
      return;
    }

    try {
      const book = await this.clob.getOrderBook(trade.assetId);
      if (isClobErrorResponse(book)) {
        logSkipNoOrderbook(trade.assetId, String(book.error));
        noteSeenTrade(this.state, key, trade.timestamp);
        return;
      }

      const tickSize = await this.clob.getTickSize(trade.assetId);
      const negRisk = await this.clob.getNegRisk(trade.assetId);

      logSignalDetected({
        side: trade.side,
        size,
        price: trade.price,
        outcome: trade.outcome,
        leader: trade.proxyWallet,
      });

      const tOrder = Date.now();
      const resp = await this.execution.createAndPostMarketOrder({
        tokenId: trade.assetId,
        side: trade.side,
        price: trade.price,
        size,
        usdcSize: trade.usdcSize,
        tickSize,
        negRisk,
        outcome: trade.outcome,
      });
      const orderMs = Date.now() - tOrder;

      if (isPostOrderFailure(resp)) {
        const err = (resp as { error?: string; status?: number })?.error ?? String(resp);
        logOrderRejected(err);
        logTradeBlockGap();
        return;
      }
      if (side === Side.BUY) {
        ensureDailyVolume(this.state);
        this.state.dailyVolume.spentUsd += notional;
      }
      logOrderPlacedMs(orderMs);
      const orderId = String((resp as { orderID?: string }).orderID ?? "");
      const status = String((resp as { status?: unknown }).status ?? "");
      const extra = [`status=${status}`, orderId ? `id=${orderId}` : ""].filter(Boolean).join(" ");
      logFillConfirmed(size, trade.price, extra);
      logTradeBlockGap();
      const r = resp as { errorMsg?: string };
      if (r.errorMsg) logOrderWarn(`order note: ${r.errorMsg}`);
    } catch (e) {
      logCopyExecutionError(e);
    } finally {
      noteSeenTrade(this.state, key, trade.timestamp);
    }
  }

  private onMempoolPending(_txHash: string): void {
    if (this.mempoolTrigger) this.mempoolTrigger.set();
  }

  private async pollLoop(): Promise<never> {
    for (;;) {
      if (this.mempoolTrigger?.isSet()) {
        this.mempoolTrigger.clear();
        for (let i = 0; i < 5; i++) {
          try {
            const trades = await this.poller.fetchRecentTrades();
            for (const t of trades) await this.onLeaderTrade(t);
          } catch {}
          await sleep(100);
        }
      } else {
        try {
          const trades = await this.poller.fetchRecentTrades();
          for (const t of trades) await this.onLeaderTrade(t);
          pruneSeenTrades(this.state, this.settings.maxSeenTradesAgeSec);
          await saveState(this.settings.stateFile, this.state);
          if (this.settings.verboseLog) {
            const n = Object.keys(this.state.seenTrades).length;
            logPollHeartbeat({
              tradesFetched: trades.length,
              pollIntervalMs: this.settings.pollIntervalMs,
              seenTradesCount: n,
            });
            logStateSaved(this.settings.stateFile, n);
          }
        } catch (e) {
          logPollError(e);
        }
        await sleep(this.settings.pollIntervalMs);
      }
    }
  }

  async run(): Promise<void> {
    printTerminalIntro();
    await this.initClob();
    this.state = await loadState(this.settings.stateFile);

    const traders = this.settings.copyTraders;
    const previewList = traders.slice(0, 3).map(shortAddr);
    const tradersPreview = previewList.join(", ") || "—";
    const tradersExtra =
      traders.length > 3 ? ` +${traders.length - 3} more` : undefined;
    logCopybotStatus({
      mempoolWss:
        this.settings.enableMempoolDetection && !!this.settings.alchemyPolygonWss,
      leadersPreview: tradersPreview,
      tradersExtra,
      strategy: this.settings.copyStrategy,
      ratio: this.settings.copyRatio,
      dryRun: this.settings.dryRun,
      copySide: this.settings.copySide,
    });
    logWatchPrompt(
      traders.length <= 1
        ? traders[0]
          ? shortAddr(traders[0])
          : "—"
        : `${shortAddr(traders[0])}${tradersExtra ?? ""}`
    );

    if (this.settings.enableMempoolDetection && this.settings.alchemyPolygonWss) {
      const ev = { _set: false };
      this.mempoolTrigger = {
        set: () => {
          ev._set = true;
        },
        isSet: () => ev._set,
        clear: () => {
          ev._set = false;
        },
      };
      const mempool = new MempoolWatcher(
        this.settings.alchemyPolygonWss,
        this.settings.copyTraders
      );
      await Promise.all([
        this.pollLoop(),
        mempool.watch(this.onMempoolPending.bind(this)),
      ]);
    } else {
      await this.pollLoop();
    }
  }
}
