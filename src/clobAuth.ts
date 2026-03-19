import type { ApiKeyCreds, ClobClient } from "@polymarket/clob-client";

export function isValidCreds(c: unknown): c is ApiKeyCreds {
  if (!c || typeof c !== "object") return false;
  const x = c as ApiKeyCreds;
  return Boolean(x.key && x.secret && x.passphrase);
}

export async function deriveOrCreateApiKey(
  client: ClobClient,
  manual: ApiKeyCreds | null
): Promise<ApiKeyCreds> {
  if (manual && isValidCreds(manual)) return manual;
  try {
    const derived = await client.deriveApiKey();
    if (isValidCreds(derived)) return derived;
  } catch {}
  const created = await client.createApiKey();
  if (isValidCreds(created)) return created;
  const again = await client.deriveApiKey();
  if (isValidCreds(again)) return again;
  throw new Error(
    "Could not derive or create API keys. Log in to polymarket.com once with this wallet, then retry."
  );
}
