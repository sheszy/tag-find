import { NextResponse } from "next/server";
import { BackendNotConfiguredError, getBearerToken, getSupabaseUser, hashOwnerToken, hashRateLimitKey, hasValidOwnerToken, supabaseRest, SupabaseRequestError } from "@/lib/Locatelly-backend";

export const runtime = "nodejs";

type ReportRow = {
  id: string;
  item_id: string;
  notes: string;
  coords: string;
  claim_session_id: string | null;
  created_at: string;
};

function isValidCoordinates(value: string): boolean {
  const match = /^(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)$/.exec(value);
  if (!match) return false;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  return Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "Item not found." }, { status: 404 });
  }

  let body: { notes?: unknown; coords?: unknown };
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }
    body = parsed as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (
    typeof body.notes !== "string" || body.notes.trim().length < 2 ||
    body.notes.length > 1000 ||
    (body.coords !== undefined && (typeof body.coords !== "string" || (body.coords !== "" && !isValidCoordinates(body.coords))))
  ) {
    return NextResponse.json({ error: "Add a short message and valid optional coordinates." }, { status: 400 });
  }

  try {
    const accessToken = getBearerToken(request);
    const finder = accessToken ? await getSupabaseUser(accessToken) : null;
    const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const clientAddress = forwardedFor || request.headers.get("x-real-ip") || "unknown";
    const reports = await supabaseRest<ReportRow[]>("rpc/submit_finder_report", {
      method: "POST",
      body: JSON.stringify({
        p_item_id: id,
        p_notes: body.notes.trim(),
        p_coords: typeof body.coords === "string" ? body.coords.trim() : "",
        p_ip_hash: hashRateLimitKey(`finder-report:${clientAddress}`),
        p_finder_user_id: finder?.id ?? null,
      }),
    });
    return NextResponse.json({ report: reports[0] }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not send this finder report.";
    const status = error instanceof BackendNotConfiguredError ? 503
      : error instanceof SupabaseRequestError ? error.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "Item not found." }, { status: 404 });
  }

  const ownerToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!hasValidOwnerToken(ownerToken)) {
    return NextResponse.json({ error: "Owner authorization required." }, { status: 401 });
  }

  try {
    const ownerQuery = new URLSearchParams({
      id: `eq.${id}`,
      owner_token_hash: `eq.${hashOwnerToken(ownerToken)}`,
      select: "id",
      limit: "1",
    });
    const ownedItems = await supabaseRest<Array<{ id: string }>>(`tag_items?${ownerQuery}`);
    if (!ownedItems.length) {
      return NextResponse.json({ error: "Owner authorization failed." }, { status: 403 });
    }

    const reportsQuery = new URLSearchParams({
      item_id: `eq.${id}`,
      select: "id,item_id,notes,coords,claim_session_id,created_at",
      order: "created_at.desc",
      limit: "100",
    });
    const reports = await supabaseRest<ReportRow[]>(`finder_reports?${reportsQuery}`);
    return NextResponse.json({ reports });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load finder reports.";
    const status = error instanceof BackendNotConfiguredError ? 503
      : error instanceof SupabaseRequestError ? error.status : 502;
    return NextResponse.json({ error: message }, { status });
  }

}
