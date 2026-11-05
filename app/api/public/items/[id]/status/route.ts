import { NextResponse } from "next/server";
import { BackendNotConfiguredError, hashOwnerToken, hasValidOwnerToken, supabaseRest, SupabaseRequestError } from "@/lib/tagfind-backend";
import { sendNearbyTagPush } from "@/lib/tagfind-push";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ownerToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "Item not found." }, { status: 404 });
  }
  if (!hasValidOwnerToken(ownerToken)) {
    return NextResponse.json({ error: "Owner authorization required." }, { status: 401 });
  }

  let body: { isLost?: unknown; coords?: unknown };
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }
    body = parsed as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const coordinates = typeof body.coords === "string" ? body.coords.trim() : "";
  const coordinateMatch = /^(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)$/.exec(coordinates);
  const latitude = coordinateMatch ? Number(coordinateMatch[1]) : NaN;
  const longitude = coordinateMatch ? Number(coordinateMatch[2]) : NaN;
  if (
    typeof body.isLost !== "boolean" ||
    (coordinates !== "" && (!coordinateMatch || Math.abs(latitude) > 90 || Math.abs(longitude) > 180))
  ) {
    return NextResponse.json({ error: "A valid lost status and optional coordinates are required." }, { status: 400 });
  }

  try {
    const query = new URLSearchParams({
      id: `eq.${id}`,
      owner_token_hash: `eq.${hashOwnerToken(ownerToken)}`,
      select: "id,is_lost,name,lost_at",
    });
    const owned = await supabaseRest<Array<{ id: string; is_lost: boolean; name: string; lost_at: string | null }>>(
      `tag_items?${query}`,
    );
    if (!owned.length) return NextResponse.json({ error: "Owner authorization failed." }, { status: 403 });

    if (!body.isLost && owned[0].is_lost) {
      const auditQuery = new URLSearchParams({
        item_id: `eq.${id}`,
        event_type: "eq.verified_return",
        select: "id",
        limit: "1",
      });
      const verified = await supabaseRest<Array<{ id: string }>>(`tag_handoff_audit?${auditQuery}`);
      const challengeQuery = new URLSearchParams({
        item_id: `eq.${id}`,
        used_at: "not.is.null",
        select: "item_id",
        limit: "1",
      });
      const usedChallenge = await supabaseRest<Array<{ item_id: string }>>(
        `tag_handoff_challenges?${challengeQuery}`,
      );
      if (!verified.length || !usedChallenge.length) {
        return NextResponse.json({ error: "Verify the one-time handoff code before marking this item returned." }, { status: 409 });
      }
    }

    if (body.isLost && !owned[0].is_lost) {
      await supabaseRest(`tag_handoff_challenges?item_id=eq.${id}`, { method: "DELETE" });
    }

    const updated = await supabaseRest<Array<{ id: string }>>(`tag_items?${query}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        is_lost: body.isLost,
        ...(body.isLost && !owned[0].is_lost ? { lost_at: new Date().toISOString() } : {}),
      }),
    });
    if (!updated.length) return NextResponse.json({ error: "Owner authorization failed." }, { status: 403 });

    if (body.isLost && coordinates) {
      try {
        const push = await sendNearbyTagPush(latitude, longitude, owned[0].name, `/?scan_id=${encodeURIComponent(id)}`);
        return NextResponse.json({ ok: true, push });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Nearby alerts could not be sent.";
        console.error("Nearby lost-item push failed:", message);
        return NextResponse.json({ ok: true, pushError: message });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update item status.";
    const status = error instanceof BackendNotConfiguredError ? 503
      : error instanceof SupabaseRequestError ? error.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
