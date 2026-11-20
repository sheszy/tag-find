import { NextResponse } from "next/server";
import {
  BackendNotConfiguredError,
  getBearerToken,
  getSupabaseUser,
  hashOwnerToken,
  hasValidOwnerToken,
  supabaseRest,
  SupabaseRequestError,
} from "@/lib/tagfind-backend";

export const runtime = "nodejs";

type ClaimRow = {
  id: string;
  item_id: string;
  finder_user_id: string;
  closed_at: string | null;
};

type MessageRow = {
  id: string;
  claim_session_id: string;
  sender_user_id: string | null;
  sender_role: "owner" | "finder";
  body: string;
  created_at: string;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function authorizeClaim(request: Request, itemId: string, claimId: string) {
  const token = getBearerToken(request);
  if (!token) throw new SupabaseRequestError("Sign in or provide item owner access to open this chat.", 401);

  const claimQuery = new URLSearchParams({
    id: `eq.${claimId}`,
    item_id: `eq.${itemId}`,
    select: "id,item_id,finder_user_id,closed_at",
    limit: "1",
  });
  const claims = await supabaseRest<ClaimRow[]>(`tag_claim_sessions?${claimQuery}`);
  const claim = claims[0];
  if (!claim) throw new SupabaseRequestError("Claim not found.", 404);

  if (hasValidOwnerToken(token)) {
    const ownerQuery = new URLSearchParams({
      id: `eq.${itemId}`,
      owner_token_hash: `eq.${hashOwnerToken(token)}`,
      select: "id",
      limit: "1",
    });
    const owners = await supabaseRest<Array<{ id: string }>>(`tag_items?${ownerQuery}`);
    if (!owners.length) throw new SupabaseRequestError("Owner authorization failed.", 403);
    return { claim, senderRole: "owner" as const, senderUserId: null };
  }

  const user = await getSupabaseUser(token);
  if (claim.finder_user_id !== user.id) {
    throw new SupabaseRequestError("This chat belongs to another finder account.", 403);
  }
  return { claim, senderRole: "finder" as const, senderUserId: user.id };
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Could not access this chat.";
  const status = error instanceof BackendNotConfiguredError ? 503
    : error instanceof SupabaseRequestError ? error.status : 502;
  return NextResponse.json({ error: message }, { status });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; claimId: string }> },
) {
  const { id, claimId } = await params;
  if (!uuidPattern.test(id) || !uuidPattern.test(claimId)) {
    return NextResponse.json({ error: "Claim not found." }, { status: 404 });
  }

  try {
    const { claim } = await authorizeClaim(request, id, claimId);
    const itemQuery = new URLSearchParams({
      id: `eq.${id}`,
      select: "is_lost",
      limit: "1",
    });
    const items = await supabaseRest<Array<{ is_lost: boolean }>>(`tag_items?${itemQuery}`);
    const closed = !items[0]?.is_lost || claim.closed_at !== null;
    if (closed) return NextResponse.json({ closed: true, messages: [] });

    const messagesQuery = new URLSearchParams({
      claim_session_id: `eq.${claimId}`,
      select: "id,claim_session_id,sender_user_id,sender_role,body,created_at",
      order: "created_at.asc",
      limit: "200",
    });
    const messages = await supabaseRest<MessageRow[]>(`messages?${messagesQuery}`);
    return NextResponse.json({ closed: false, messages });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; claimId: string }> },
) {
  const { id, claimId } = await params;
  if (!uuidPattern.test(id) || !uuidPattern.test(claimId)) {
    return NextResponse.json({ error: "Claim not found." }, { status: 404 });
  }

  let body: { message?: unknown };
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }
    body = parsed as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (typeof body.message !== "string" || body.message.trim().length < 1 || body.message.length > 4000) {
    return NextResponse.json({ error: "Enter a message of at most 4,000 characters." }, { status: 400 });
  }

  try {
    const { claim, senderRole, senderUserId } = await authorizeClaim(request, id, claimId);
    if (claim.closed_at) {
      return NextResponse.json({ error: "This chat is closed because the item was returned." }, { status: 410 });
    }
    const result = await supabaseRest<MessageRow[]>("rpc/send_tag_message", {
      method: "POST",
      body: JSON.stringify({
        p_item_id: id,
        p_claim_session_id: claimId,
        p_sender_role: senderRole,
        p_sender_user_id: senderUserId,
        p_body: body.message.trim(),
      }),
    });
    if (!result[0]) throw new Error("Supabase returned no saved message.");
    return NextResponse.json({ message: result[0] }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
