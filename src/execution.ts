import type { ClobClient } from "@polymarket/clob-client";
import { OrderType, Side } from "@polymarket/clob-client";
import type { CopyStrategy } from "../config.js";

export interface CopyOrderParams {
  tokenId: string;
  side: string;
  price: number;
  size: number;
  usdcSize: number;
  tickSize: string;
  negRisk: boolean;
  outcome: string;
}

export interface TradeForSize {
  price: number;
  size: number;
  usdcSize: number;
}

export interface ExecutionConfig {
  copyStrategy: CopyStrategy;
  copyRatio: number;
  fixedUsd: number;
  fixedShares: number;
  minTradeUsd: number;
  maxTradeUsd: number;
  maxSlippageBps: number;
}

export interface OrderResponse {
  orderID?: string;
  status?: string;
  errorMsg?: string;
  [k: string]: unknown;
}

export class ExecutionEngine {
  constructor(
    private client: ClobClient,
    private config: ExecutionConfig
  ) {}

  computeSize(trade: TradeForSize): { size: number; notional: number } | null {
    const ratio = this.config.copyRatio;
    const price = trade.price;
    if (!(Number.isFinite(price) && price > 0)) return null;

    let size = 0;
    let notional = 0;

    switch (this.config.copyStrategy) {
      case "PERCENT_USD":
        notional = trade.usdcSize * ratio;
        size = notional / price;
        break;
      case "PERCENT_SHARES":
        size = trade.size * ratio;
        notional = size * price;
        break;
      case "FIXED_USD":
        notional = this.config.fixedUsd;
        size = notional / price;
        break;
      case "FIXED_SHARES":
        size = this.config.fixedShares;
        notional = size * price;
        break;
      default:
        return null;
    }

    if (!(size > 0 && notional > 0)) return null;
    return { size, notional };
  }

  clampToLimits(
    side: Side,
    size: number,
    notional: number,
    price: number
  ): { size: number; notional: number } | null {
    if (notional < this.config.minTradeUsd) return null;
    if (notional > this.config.maxTradeUsd) {
      notional = this.config.maxTradeUsd;
      size = notional / price;
    }
    if (!(size > 0 && notional > 0)) return null;
    return { size, notional };
  }

  private slippagePrice(price: number, side: string): number {
    const bps = this.config.maxSlippageBps / 10_000;
    if (side.toUpperCase() === "BUY") return Math.min(1, price * (1 + bps));
    return Math.max(0, price * (1 - bps));
  }

  async createAndPostMarketOrder(params: CopyOrderParams): Promise<OrderResponse> {
    const worstPrice = this.slippagePrice(params.price, params.side);
    const side = params.side.toUpperCase() === "BUY" ? Side.BUY : Side.SELL;
    const amount = side === Side.SELL ? params.size : params.size * params.price;

    const order = await this.client.createMarketOrder(
      {
        tokenID: params.tokenId,
        side,
        amount,
        price: worstPrice,
      },
      { tickSize: params.tickSize as "0.1" | "0.01" | "0.001" | "0.0001", negRisk: params.negRisk }
    );

    return this.client.postOrder(order, OrderType.FOK);
  }
}
