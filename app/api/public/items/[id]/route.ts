import { NextResponse } from "next/server";
import { BackendNotConfiguredError, hashOwnerToken, supabaseRest, SupabaseRequestError } from "@/lib/tagfind-backend";

export const runtime = "nodejs";

type PublicItemRow = {
  id: string;
  name: string;
  category: string;
  owner_name: string;
  reward: string;
  message: string;
  offline_instructions: string;
  is_lost: boolean;
  contact: string;
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "Item not found." }, { status: 404 });
  }

  try {
    const query = new URLSearchParams({
      id: `eq.${id}`,
      select: "id,name,category,owner_name,reward,message,offline_instructions,is_lost,contact",
      limit: "1",
    });
    const rows = await supabaseRest<PublicItemRow[]>(`tag_items?${query}`);
    const item = rows[0];
    if (!item) return NextResponse.json({ error: "Item not found." }, { status: 404 });

    return NextResponse.json({
      id: item.id,
      name: item.name,
      category: item.category,
      owner: item.owner_name,
      reward: item.reward,
      message: item.message,
      offlineInstructions: item.offline_instructions,
      isLost: item.is_lost,
      contact: item.is_lost ? item.contact : "",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load this item.";
    const status = error instanceof BackendNotConfiguredError ? 503
      : error instanceof SupabaseRequestError ? error.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ownerToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "Item not found." }, { status: 404 });
  }
  if (!ownerToken || !/^[a-f0-9]{64}$/.test(ownerToken)) {
    return NextResponse.json({ error: "Owner authorization required." }, { status: 401 });
  }

  try {
    const query = new URLSearchParams({
      id: `eq.${id}`,
      owner_token_hash: `eq.${hashOwnerToken(ownerToken)}`,
    });
    const deleted = await supabaseRest<Array<{ id: string }>>(`tag_items?${query}`, {
      method: "DELETE",
      headers: { Prefer: "return=representation" },
    });
    if (!deleted.length) return NextResponse.json({ error: "Owner authorization failed." }, { status: 403 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not delete this cloud item.";
    const status = error instanceof BackendNotConfiguredError ? 503
      : error instanceof SupabaseRequestError ? error.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
