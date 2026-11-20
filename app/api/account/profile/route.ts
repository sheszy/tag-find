import { NextResponse } from "next/server";
import {
  BackendNotConfiguredError,
  requireSupabaseUser,
  supabaseRest,
  SupabaseRequestError,
} from "@/lib/tagfind-backend";

export const runtime = "nodejs";

type ProfileRow = {
  user_id: string;
  coins: number;
  unlocked_items: string[];
  customizations: Record<string, string>;
};

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Could not load your Locatelly profile.";
  const status = error instanceof BackendNotConfiguredError ? 503
    : error instanceof SupabaseRequestError ? error.status : 502;
  return NextResponse.json({ error: message }, { status });
}

async function loadProfile(userId: string): Promise<ProfileRow> {
  const query = new URLSearchParams({
    user_id: `eq.${userId}`,
    select: "user_id,coins,unlocked_items,customizations",
    limit: "1",
  });
  const rows = await supabaseRest<ProfileRow[]>(`tag_profiles?${query}`);
  if (rows[0]) return rows[0];

  const created = await supabaseRest<ProfileRow[]>("tag_profiles?on_conflict=user_id", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify({ user_id: userId }),
  });
  if (created[0]) return created[0];
  const reloaded = await supabaseRest<ProfileRow[]>(`tag_profiles?${query}`);
  if (!reloaded[0]) throw new Error("Your Locatelly profile could not be created.");
  return reloaded[0];
}

export async function GET(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    const profile = await loadProfile(user.id);
    return NextResponse.json({ user, profile });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  let body: { action?: unknown; cosmeticId?: unknown };
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
    !["purchase", "equip"].includes(String(body.action)) ||
    typeof body.cosmeticId !== "string" ||
    !/^[a-z0-9-]{2,64}$/.test(body.cosmeticId)
  ) {
    return NextResponse.json({ error: "Choose a valid cosmetic." }, { status: 400 });
  }

  try {
    const user = await requireSupabaseUser(request);
    const rpc = body.action === "purchase" ? "purchase_tag_cosmetic" : "equip_tag_cosmetic";
    const result = await supabaseRest<Array<{
      purchased?: boolean;
      equipped?: boolean;
      coins?: number;
      unlocked_items?: string[];
      customizations?: Record<string, string>;
    }>>(`rpc/${rpc}`, {
      method: "POST",
      body: JSON.stringify({
        p_user_id: user.id,
        p_cosmetic_id: body.cosmeticId,
      }),
    });
    const row = result[0];
    if (!row) throw new Error("Supabase returned no cosmetic result.");

    if (body.action === "purchase") {
      const unlockedItems = row.unlocked_items ?? [];
      if (!row.purchased && !unlockedItems.includes(body.cosmeticId)) {
        return NextResponse.json({ error: "You do not have enough coins for this cosmetic.", profile: row }, { status: 409 });
      }
    } else if (!row.equipped) {
      return NextResponse.json({ error: "Unlock this cosmetic before equipping it." }, { status: 403 });
    }

    const profile = body.action === "purchase"
      ? { coins: row.coins, unlocked_items: row.unlocked_items }
      : { customizations: row.customizations };
    return NextResponse.json({ profile, alreadyUnlocked: body.action === "purchase" && !row.purchased });
  } catch (error) {
    return errorResponse(error);
  }
}
