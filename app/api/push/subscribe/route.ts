import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { BackendNotConfiguredError, hashRateLimitKey, supabaseRest, SupabaseRequestError } from "@/lib/tagfind-backend";

export const runtime = "nodejs";

type SubscriptionBody = {
  subscription?: {
    endpoint?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown };
  };
  latitude?: unknown;
  longitude?: unknown;
};

function getValidEndpoint(value: unknown): URL | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const endpoint = new URL(value);
    const supportedHost = [
      "fcm.googleapis.com",
      "updates.push.services.mozilla.com",
      "web.push.apple.com",
    ].includes(endpoint.hostname) || endpoint.hostname.endsWith(".notify.windows.com");
    return endpoint.protocol === "https:" && !endpoint.username && !endpoint.password &&
      (!endpoint.port || endpoint.port === "443") && supportedHost
      ? endpoint
      : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  let body: SubscriptionBody;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }
    body = parsed as SubscriptionBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { subscription, latitude, longitude } = body;
  const endpoint = getValidEndpoint(subscription?.endpoint);
  if (
    !endpoint || typeof subscription?.endpoint !== "string" ||
    typeof subscription.keys?.p256dh !== "string" || !/^[A-Za-z0-9_-]{80,100}$/.test(subscription.keys.p256dh) ||
    typeof subscription.keys.auth !== "string" || !/^[A-Za-z0-9_-]{20,30}$/.test(subscription.keys.auth) ||
    typeof latitude !== "number" || !Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
    typeof longitude !== "number" || !Number.isFinite(longitude) || Math.abs(longitude) > 180
  ) {
    return NextResponse.json({ error: "A valid push subscription and location are required." }, { status: 400 });
  }

  try {
    const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const clientAddress = request.headers.get("x-real-ip") || forwardedFor || "unknown";
    await supabaseRest<boolean>("rpc/check_tag_push_subscription_rate_limit", {
      method: "POST",
      body: JSON.stringify({ p_ip_hash: hashRateLimitKey(`push-subscribe:${clientAddress}`) }),
    });
    const endpointHash = createHash("sha256").update(subscription.endpoint).digest("hex");
    await supabaseRest("tag_push_subscriptions?on_conflict=endpoint_hash", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        endpoint_hash: endpointHash,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        latitude: Math.round(latitude * 100) / 100,
        longitude: Math.round(longitude * 100) / 100,
      }),
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save your notification subscription.";
    const status = error instanceof BackendNotConfiguredError ? 503
      : error instanceof SupabaseRequestError ? error.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(request: Request) {
  let endpointValue: unknown;
  try {
    const body: unknown = await request.json();
    endpointValue = body && typeof body === "object" && !Array.isArray(body)
      ? (body as { endpoint?: unknown }).endpoint
      : undefined;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const endpoint = getValidEndpoint(endpointValue);
  if (!endpoint || typeof endpointValue !== "string") {
    return NextResponse.json({ error: "A valid push endpoint is required." }, { status: 400 });
  }
  try {
    const endpointHash = createHash("sha256").update(endpointValue).digest("hex");
    await supabaseRest(
      `tag_push_subscriptions?endpoint_hash=eq.${endpointHash}`,
      { method: "DELETE" },
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not remove your notification subscription.";
    const status = error instanceof BackendNotConfiguredError ? 503
      : error instanceof SupabaseRequestError ? error.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
