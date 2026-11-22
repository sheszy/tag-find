import { NextResponse } from "next/server";
import { BackendNotConfiguredError, getSupabaseConfig } from "@/lib/Locatelly-backend";

export const runtime = "nodejs";

type AuthRequest = {
  action?: unknown;
  email?: unknown;
  password?: unknown;
  refreshToken?: unknown;
  accessToken?: unknown;
  codeChallenge?: unknown;
  redirectTo?: unknown;
  code?: unknown;
  codeVerifier?: unknown;
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

  const isPasswordAction = body.action === "signup" || body.action === "signin";
  if (
    !["signup", "signin", "refresh", "signout", "oauth-url", "oauth-exchange"].includes(String(body.action)) ||
    (isPasswordAction &&
      (typeof body.email !== "string" || body.email.length > 254 ||
        typeof body.password !== "string" || body.password.length < 8 || body.password.length > 128)) ||
    (body.action === "refresh" &&
      (typeof body.refreshToken !== "string" || body.refreshToken.length < 20 || body.refreshToken.length > 4096)) ||
    (body.action === "signout" &&
      (typeof body.accessToken !== "string" || body.accessToken.length < 20 || body.accessToken.length > 8192)) ||
    (body.action === "oauth-url" &&
      (typeof body.codeChallenge !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(body.codeChallenge) ||
        typeof body.redirectTo !== "string" || body.redirectTo.length > 2048)) ||
    (body.action === "oauth-exchange" &&
      (typeof body.code !== "string" || body.code.length < 10 || body.code.length > 2048 ||
        typeof body.codeVerifier !== "string" || !/^[A-Za-z0-9._~-]{43,128}$/.test(body.codeVerifier)))
  ) {
    return NextResponse.json({ error: "Invalid authentication request." }, { status: 400 });
  }

  try {
    const { url } = getSupabaseConfig();
    if (body.action === "oauth-url") {
      const callbackUrl = new URL(body.redirectTo as string);
      const appOrigin = process.env.NEXT_PUBLIC_APP_URL
        ? new URL(process.env.NEXT_PUBLIC_APP_URL).origin
        : new URL(request.url).origin;
      if (
        callbackUrl.origin !== appOrigin ||
        callbackUrl.pathname !== "/auth/callback" ||
        callbackUrl.search ||
        callbackUrl.hash
      ) {
        return NextResponse.json({ error: "Invalid OAuth callback URL." }, { status: 400 });
      }

      const authorizationUrl = new URL("/auth/v1/authorize", url);
      authorizationUrl.searchParams.set("provider", "google");
      authorizationUrl.searchParams.set("redirect_to", callbackUrl.toString());
      authorizationUrl.searchParams.set("code_challenge", body.codeChallenge as string);
      authorizationUrl.searchParams.set("code_challenge_method", "s256");
      return NextResponse.json({ authorizationUrl: authorizationUrl.toString() });
    }

    const anonKey =
      process.env.SUPABASE_ANON_KEY ||
      process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!anonKey) throw new BackendNotConfiguredError();

    let endpoint: string;
    let payload: Record<string, unknown>;
    switch (body.action) {
      case "signup":
        endpoint = "signup";
        payload = { email: (body.email as string).trim(), password: body.password };
        break;
      case "signin":
        endpoint = "token?grant_type=password";
        payload = { email: (body.email as string).trim(), password: body.password };
        break;
      case "refresh":
        endpoint = "token?grant_type=refresh_token";
        payload = { refresh_token: body.refreshToken };
        break;
      case "oauth-exchange":
        endpoint = "token?grant_type=pkce";
        payload = { auth_code: body.code, code_verifier: body.codeVerifier };
        break;
      case "signout":
        endpoint = "logout";
        payload = {};
        break;
      default:
        return NextResponse.json({ error: "Unsupported authentication action." }, { status: 400 });
    }
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
