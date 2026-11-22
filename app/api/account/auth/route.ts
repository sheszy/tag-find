import { NextResponse } from "next/server";
import { BackendNotConfiguredError, getSupabaseConfig } from "@/lib/Locatelly-backend";

export const runtime = "nodejs";

type AuthRequest = {
  action?: unknown;
  email?: unknown;
  password?: unknown;
  refreshToken?: unknown;
  accessToken?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export async function POST(request: Request) {
  let body: AuthRequest;
  try {
    const parsed: unknown = await request.json();
    if (!isRecord(parsed)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    body = parsed;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (
    !["signup", "signin", "refresh", "signout"].includes(String(body.action)) ||
    (body.action !== "refresh" && body.action !== "signout" &&
      (typeof body.email !== "string" || body.email.length > 254 ||
        typeof body.password !== "string" || body.password.length < 8 || body.password.length > 128)) ||
    (body.action === "refresh" &&
      (typeof body.refreshToken !== "string" || body.refreshToken.length < 20 || body.refreshToken.length > 4096)) ||
    (body.action === "signout" &&
      (typeof body.accessToken !== "string" || body.accessToken.length < 20 || body.accessToken.length > 8192))
  ) {
    return NextResponse.json({ error: "Provide a valid email and password (at least 8 characters)." }, { status: 400 });
  }

  try {
    const { url } = getSupabaseConfig();
    const anonKey =
      process.env.SUPABASE_ANON_KEY ||
      process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!anonKey) throw new BackendNotConfiguredError();

    const endpoint = body.action === "signup"
      ? "signup"
      : body.action === "signin"
        ? "token?grant_type=password"
        : body.action === "refresh"
          ? "token?grant_type=refresh_token"
          : "logout";
    const payload = body.action === "refresh"
      ? { refresh_token: body.refreshToken }
      : body.action === "signout"
        ? {}
        : { email: (body.email as string).trim(), password: body.password };
    const response = await fetch(`${url}/auth/v1/${endpoint}`, {
      method: "POST",
      cache: "no-store",
      headers: {
        apikey: anonKey,
        "Content-Type": "application/json",
        ...(body.action === "signout" ? { Authorization: `Bearer ${body.accessToken}` } : {}),
      },
      body: JSON.stringify(payload),
    });
    if (body.action === "signout" && response.ok) {
      return NextResponse.json({ signedOut: true });
    }
    const result: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = isRecord(result)
        ? result.message ?? result.msg ?? result.error_description ?? result.error
        : null;
      const message = typeof detail === "string" && detail.length < 240
        ? detail
        : "Could not authenticate with Supabase.";
      return NextResponse.json({ error: message }, { status: response.status === 429 ? 429 : 400 });
    }

    if (!isRecord(result)) {
      return NextResponse.json({ error: "Supabase returned an invalid account response." }, { status: 502 });
    }
    const user = result.user;
    return NextResponse.json({
      user: isRecord(user) ? { id: user.id, email: user.email } : null,
      session: typeof result.access_token === "string" && typeof result.refresh_token === "string"
        ? {
            accessToken: result.access_token,
            refreshToken: result.refresh_token,
            expiresIn: result.expires_in,
          }
        : null,
      requiresEmailConfirmation: body.action === "signup" && typeof result.access_token !== "string",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not authenticate with Supabase.";
    const status = error instanceof BackendNotConfiguredError ? 503 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
