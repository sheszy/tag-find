import { createHash, createHmac } from "node:crypto";

type SupabaseConfig = {
  url: string;
  serviceRoleKey: string;
};

export class BackendNotConfiguredError extends Error {
  constructor() {
    super("Cross-device reports need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY configured on the server.");
    this.name = "BackendNotConfiguredError";
  }
}

export class SupabaseRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "SupabaseRequestError";
  }
}

export function getSupabaseConfig(): SupabaseConfig {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new BackendNotConfiguredError();

  const parsedUrl = new URL(url);
  const isLocalhost = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsedUrl.hostname);
  if (parsedUrl.protocol !== "https:" && !isLocalhost) {
    throw new Error("SUPABASE_URL must use HTTPS.");
  }

  return { url, serviceRoleKey };
}

export async function supabaseRest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const { url, serviceRoleKey } = getSupabaseConfig();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error("Supabase request failed:", response.status, detail);
    if (detail.includes("rate limit exceeded")) {
      throw new SupabaseRequestError("Too many requests. Please wait and try again later.", 429);
    }
    if (response.status === 401) {
      throw new SupabaseRequestError("Supabase rejected the server key. Check SUPABASE_SERVICE_ROLE_KEY in .env.local.", 503);
    }
    throw new SupabaseRequestError("The cloud service could not complete the request.", 502);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function hashOwnerToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function hashRateLimitKey(value: string): string {
  const { serviceRoleKey } = getSupabaseConfig();
  return createHmac("sha256", serviceRoleKey).update(value).digest("hex");
}

export function hasValidOwnerToken(value: string | null): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
