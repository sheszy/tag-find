import { createHash, randomInt } from "node:crypto";
import { NextResponse } from "next/server";
import {
  BackendNotConfiguredError,
  hashOwnerToken,
  hashRateLimitKey,
  hasValidOwnerToken,
  requireSupabaseUser,
  supabaseRest,
  SupabaseRequestError,
} from "@/lib/Locatelly-backend";

export const runtime = "nodejs";

function isValidItemId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isValidItemId(id)) return NextResponse.json({ error: "Item not found." }, { status: 404 });

  let body: { action?: unknown; pin?: unknown };
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }
    body = parsed as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  try {
    if (body.action === "generate") {
      const ownerToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
      if (!hasValidOwnerToken(ownerToken)) {
        return NextResponse.json({ error: "Owner authorization required." }, { status: 401 });
      }
      const pin = String(randomInt(1000, 10000));
      const pinHash = createHash("sha256").update(pin).digest("hex");
      const result = await supabaseRest<Array<{ expires_at: string }>>(
        "rpc/issue_tag_handoff_challenge",
        {
          method: "POST",
          body: JSON.stringify({
            p_item_id: id,
            p_owner_token_hash: hashOwnerToken(ownerToken),
            p_pin_hash: pinHash,
          }),
        },
      );
      return NextResponse.json({ pin, expiresAt: result[0]?.expires_at }, { status: 201 });
    }

    if (body.action === "verify") {
      if (typeof body.pin !== "string" || !/^\d{4}$/.test(body.pin)) {
        return NextResponse.json({ error: "Enter the 4-digit handoff code." }, { status: 400 });
      }
      const finder = await requireSupabaseUser(request);
      const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
      const clientAddress = request.headers.get("x-real-ip") || forwardedFor || "unknown";
      await supabaseRest<boolean>("rpc/check_tag_handoff_verify_rate_limit", {
        method: "POST",
        body: JSON.stringify({ p_ip_hash: hashRateLimitKey(`handoff-verify:${clientAddress}`) }),
      });
      const pinHash = createHash("sha256").update(body.pin).digest("hex");
      const result = await supabaseRest<Array<{
        verified: boolean;
        coins_awarded: number;
        coins_balance: number | null;
      }>>("rpc/complete_tag_handoff", {
        method: "POST",
        body: JSON.stringify({
          p_item_id: id,
          p_pin_hash: pinHash,
          p_finder_user_id: finder.id,
        }),
      });
      if (!result[0]?.verified) {
        return NextResponse.json(
          { error: "The code is incorrect, expired, or already used. Ask the owner for a new code." },
          { status: 400 },
        );
      }
      return NextResponse.json({
        verified: true,
        coinsAwarded: result[0].coins_awarded,
        coinsBalance: result[0].coins_balance,
      });
    }

    return NextResponse.json({ error: "A valid handoff action is required." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not complete the secure handoff.";
    const status = error instanceof BackendNotConfiguredError ? 503
      : error instanceof SupabaseRequestError ? error.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
