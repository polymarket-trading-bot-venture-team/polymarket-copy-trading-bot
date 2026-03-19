const useColor =
  !process.env.NO_COLOR &&
  process.env.FORCE_COLOR !== "0" &&
  (process.env.FORCE_COLOR === "1" || process.stdout.isTTY);

function wrap(code: string, s: string): string {
  if (!useColor) return s;
  return `\u001b[${code}m${s}\u001b[0m`;
}

function rgb(r: number, g: number, b: number, s: string): string {
  if (!useColor) return s;
  return `\u001b[38;2;${r};${g};${b}m${s}\u001b[0m`;
}

export const term = {
  teal: (s: string) => rgb(79, 209, 197, s),
  amber: (s: string) => rgb(246, 173, 85, s),
  grey: (s: string) => rgb(113, 128, 150, s),
  white: (s: string) => wrap("37", s),
  green: (s: string) => wrap("32", s),
  red: (s: string) => wrap("31", s),
  bold: (s: string) => wrap("1", s),
  dim: (s: string) => wrap("2", s),
} as const;

export function ts(): string {
  const d = new Date();
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `[${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}]`;
}

function emit(kind: "log" | "warn" | "error", colored: string): void {
  if (kind === "log") console.log(colored);
  else if (kind === "warn") console.warn(colored);
  else console.error(colored);
}

export function shortTokenId(tokenId: string, head = 10, tail = 6): string {
  if (tokenId.length <= head + tail + 1) return tokenId;
  return `${tokenId.slice(0, head)}…${tokenId.slice(-tail)}`;
}

export function shortAddr(addr: string): string {
  const a = addr.trim();
  if (a.length <= 14) return a;
  return `${a.slice(0, 8)}…${a.slice(-4)}`;
}

export function printTerminalIntro(): void {
  const dotR = useColor ? "\u001b[31m●\u001b[0m" : "●";
  const dotY = useColor ? "\u001b[33m●\u001b[0m" : "●";
  const dotG = useColor ? "\u001b[32m●\u001b[0m" : "●";
  const title = term.grey("    POLYMARKET COPY BOT — LIVE TRADING TERMINAL");
  emit("log", ["", `${dotR}${dotY}${dotG}${title}`, ""].join("\n"));
}

export function logCopybotStatus(opts: {
  mempoolWss: boolean;
  leadersPreview: string;
  tradersExtra?: string;
  strategy: string;
  ratio: number;
  dryRun: boolean;
  copySide: string;
}): void {
  const lines = [
    "",
    `${term.grey("$")} ${term.white("copybot status")}`,
    `${term.teal("✓")} ${term.teal("Connected to Polymarket CLOB")}`,
    `${term.teal("✓")} ${
      opts.mempoolWss
        ? term.teal("Mempool monitor: ACTIVE")
        : term.grey("Mempool monitor: STANDBY (polling only)")
    }`,
    `${term.teal("✓")} ${term.teal("Watching leaders:")} ${term.white(opts.leadersPreview)}${
      opts.tradersExtra ? term.grey(opts.tradersExtra) : ""
    }`,
    `  ${term.grey("Strategy")} ${term.white(opts.strategy)} ${term.grey("· ratio")} ${term.white(String(opts.ratio))} ${term.grey("· sides")} ${term.white(opts.copySide)} ${term.grey("·")} ${
      opts.dryRun ? term.amber("DRY RUN") : term.teal("LIVE")
    }`,
    "",
  ];
  emit("log", lines.join("\n"));
}

export function logClobAuthLine(line: string): void {
  emit("log", `  ${term.grey(line)}`);
}

export interface SignalPayload {
  side: string;
  size: number;
  price: number;
  outcome: string;
  leader?: string;
}

export function logSignalDetected(p: SignalPayload): void {
  const side = p.side.toUpperCase();
  const sideCol = side === "BUY" ? term.green : term.red;
  const leaderBit = p.leader ? ` ${term.grey("←")} ${term.grey(shortAddr(p.leader))}` : "";
  emit(
    "log",
    `${term.grey(ts())} ${term.grey("Signal detected:")} ${sideCol(side)} ${term.white(String(p.size))} ${term.grey("@")} ${term.white(p.price.toFixed(3))} ${term.grey("(")}${term.white(
      p.outcome.slice(0, 48) + (p.outcome.length > 48 ? "…" : "")
    )}${term.grey(")")}${leaderBit}`
  );
}

export function logDryRunNoOrder(): void {
  emit("log", `${term.grey(ts())} ${term.amber("DRY RUN — mirror only (no CLOB order)")}`);
}

export function logOrderPlacedMs(ms: number): void {
  emit("log", `${term.grey(ts())} ${term.amber(`Order placed in ${ms}ms`)}`);
}

export function logFillConfirmed(size: number, price: number, extra?: string): void {
  const tail = extra ? ` ${term.grey(extra)}` : "";
  emit(
    "log",
    `${term.grey(ts())} ${term.teal(`Fill confirmed: ${size.toFixed(2)} @ ${price.toFixed(3)}`)}${tail}`
  );
}

export function logWatchPrompt(leadersShort: string): void {
  emit("log", [`${term.grey("$")} ${term.white(`copybot watch ${leadersShort}`)}`, ""].join("\n"));
}

export function logCopyDryRun(trade: {
  side: string;
  assetId: string;
  price: number;
  size: number;
  notional: number;
  outcome?: string;
  leader?: string;
}): void {
  logSignalDetected({
    side: trade.side,
    size: trade.size,
    price: trade.price,
    outcome: trade.outcome ?? shortTokenId(trade.assetId),
    leader: trade.leader,
  });
  logDryRunNoOrder();
  emit("log", "");
}

export function logTradeBlockGap(): void {
  emit("log", "");
}

export function logSkipNoOrderbook(tokenId: string, err: string): void {
  emit(
    "warn",
    `${term.grey(ts())} ${term.amber("Skip")} ${term.grey("— no CLOB book")} ${term.white(shortTokenId(tokenId))} ${term.grey(err)}`
  );
}

export function logOrderRejected(err: string): void {
  emit("warn", `${term.grey(ts())} ${term.red("Order rejected:")} ${term.grey(err)}`);
}

export function logOrderWarn(msg: string): void {
  emit("warn", `${term.grey(ts())} ${term.amber(msg)}`);
}

export function logPollError(e: unknown): void {
  console.error(`${term.red(ts())} poll error`, e);
}

export function logCopyExecutionError(e: unknown): void {
  console.error(`${term.red(ts())} execution error`, e);
}

export function logFatal(e: unknown): void {
  console.error(term.red("Fatal:"), e);
}

export function logVerbose(msg: string): void {
  emit("log", `${term.grey(ts())} ${term.dim(msg)}`);
}

export function logPollHeartbeat(opts: {
  tradesFetched: number;
  pollIntervalMs: number;
  seenTradesCount: number;
}): void {
  emit(
    "log",
    `${term.grey(ts())} ${term.grey("poll")} ${term.white(String(opts.tradesFetched))} trades · ${term.grey(
      `${opts.pollIntervalMs}ms`
    )} · ${term.grey("seen")} ${term.white(String(opts.seenTradesCount))}`
  );
}

export function logStateSaved(filePath: string, seenTradesCount: number): void {
  emit(
    "log",
    `${term.grey(ts())} ${term.grey("state")} ${term.white(filePath)} ${term.grey("seen=" + String(seenTradesCount))}`
  );
}
