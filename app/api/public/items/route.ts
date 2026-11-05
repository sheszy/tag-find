import { NextResponse } from "next/server";
import { BackendNotConfiguredError, hashOwnerToken, hashRateLimitKey, supabaseRest, SupabaseRequestError } from "@/lib/tagfind-backend";

export const runtime = "nodejs";

type NewItemBody = {
  ownerToken?: string;
  name?: string;
  category?: string;
  owner?: string;
  contact?: string;
  reward?: string;
  message?: string;
  offlineInstructions?: string;
  isLost?: boolean;
};

const textWithin = (value: unknown, limit: number): value is string =>
  typeof value === "string" && value.length <= limit;

export async function POST(request: Request) {
  let body: NewItemBody;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }
    body = parsed as NewItemBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (
    !textWithin(body.name, 120) || !body.name.trim() ||
    !textWithin(body.category, 60) ||
    !textWithin(body.owner, 120) || !body.owner.trim() ||
    !textWithin(body.contact, 240) ||
    !textWithin(body.reward, 120) ||
    !textWithin(body.message, 500) ||
    !textWithin(body.offlineInstructions, 240) ||
    typeof body.isLost !== "boolean" ||
    typeof body.ownerToken !== "string" ||
    !/^[a-f0-9]{64}$/.test(body.ownerToken)
  ) {
    return NextResponse.json({ error: "Item details are missing or exceed allowed limits." }, { status: 400 });
  }

  try {
    const id = crypto.randomUUID();
    const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const clientAddress = request.headers.get("x-real-ip") || forwardedFor || "unknown";
    await supabaseRest<boolean>("rpc/check_tag_creation_rate_limit", {
      method: "POST",
      body: JSON.stringify({ p_ip_hash: hashRateLimitKey(`tag-create:${clientAddress}`) }),
    });
    await supabaseRest("tag_items", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        id,
        owner_token_hash: hashOwnerToken(body.ownerToken),
        name: body.name.trim(),
        category: body.category,
        owner_name: body.owner.trim(),
        contact: body.contact,
        reward: body.reward,
        message: body.message,
        offline_instructions: body.offlineInstructions,
        is_lost: body.isLost,
      }),
    });

    return NextResponse.json({ publicId: id }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not publish this item.";
    const status = error instanceof BackendNotConfiguredError ? 503
      : error instanceof SupabaseRequestError ? error.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
