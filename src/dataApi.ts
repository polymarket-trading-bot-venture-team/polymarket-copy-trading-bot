export interface Position {
  asset: string;
  conditionId: string;
  size: number;
  curPrice?: number;
  avgPrice?: number;
  outcomeIndex?: number;
}

export class DataApiClient {
  constructor(private host: string) {
    this.host = host.replace(/\/$/, "");
  }

  async getPositions(user: string, limit = 200): Promise<Position[]> {
    const url = `${this.host}/positions?user=${user}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = (await res.json()) as Position[];
    return Array.isArray(data) ? data : [];
  }
}
