export function isClobErrorResponse(res: unknown): res is { error: string; status?: number } {
  if (!res || typeof res !== "object") return false;
  const o = res as Record<string, unknown>;
  return typeof o.error === "string" && !("asset_id" in o);
}

export function isPostOrderFailure(res: unknown): boolean {
  if (!res || typeof res !== "object") return true;
  const o = res as Record<string, unknown>;
  if (typeof o.error === "string" && o.error.length > 0) return true;
  if (typeof o.status === "number" && o.status >= 400) return true;
  return false;
}
