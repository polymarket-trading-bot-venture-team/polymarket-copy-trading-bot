import { promises as fs } from "fs";
import path from "path";

export interface State {
  lastSeen: Record<string, number>;
  seenTrades: Record<string, number>;
  dailyVolume: { day: string; spentUsd: number };
}

const defaultState = (): State => ({
  lastSeen: {},
  seenTrades: {},
  dailyVolume: { day: "", spentUsd: 0 },
});

const dayKeyUtc = (date = new Date()): string => {
  const y = date.getUTCFullYear();
  const m = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const d = `${date.getUTCDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
};

export const loadState = async (filePath: string): Promise<State> => {
  try {
    const raw = (await fs.readFile(filePath, "utf-8")).trim();
    if (!raw) {
      console.warn(`[state] ${filePath} is empty — starting fresh`);
      return defaultState();
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      if (e instanceof SyntaxError) {
        console.warn(
          `[state] ${filePath} is not valid JSON — starting fresh (${e.message})`
        );
        return defaultState();
      }
      throw e;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      console.warn(`[state] ${filePath} must be a JSON object — starting fresh`);
      return defaultState();
    }
    const p = parsed as Partial<State>;
    return {
      ...defaultState(),
      ...p,
      lastSeen: p.lastSeen ?? {},
      seenTrades: p.seenTrades ?? {},
      dailyVolume: p.dailyVolume ?? { day: "", spentUsd: 0 },
    };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return defaultState();
    throw err;
  }
};

export const saveState = async (filePath: string, state: State): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(state, null, 2));
};

export const ensureDailyVolume = (state: State, now = new Date()): void => {
  const key = dayKeyUtc(now);
  if (state.dailyVolume.day !== key) {
    state.dailyVolume.day = key;
    state.dailyVolume.spentUsd = 0;
  }
};

export const noteSeenTrade = (state: State, tradeKey: string, timestamp: number): void => {
  state.seenTrades[tradeKey] = timestamp;
};

export const pruneSeenTrades = (state: State, maxAgeSec: number): void => {
  const cutoff = Math.floor(Date.now() / 1000) - maxAgeSec;
  for (const [key, ts] of Object.entries(state.seenTrades)) {
    if (ts < cutoff) delete state.seenTrades[key];
  }
};
