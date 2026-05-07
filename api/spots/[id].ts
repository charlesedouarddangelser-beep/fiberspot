import { supabaseAdmin } from "../_lib/supabase";
import { getUserFromRequest } from "../_lib/auth";
import { fail, json } from "../_lib/json";

export const config = { runtime: "edge" };

const VALID_TYPES = new Set([
  "Cafe",
  "Library",
  "Coworking",
  "Hotel",
  "Restaurant",
  "Park",
  "Other",
]);

interface PatchBody {
  name?: unknown;
  type?: unknown;
  address?: unknown;
  tags?: unknown;
}

function extractId(req: Request): string | null {
  // /api/spots/<id> — path looks like "/api/spots/<id>"
  const path = new URL(req.url).pathname;
  const match = path.match(/\/api\/spots\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

export default async function handler(req: Request) {
  if (req.method !== "PATCH" && req.method !== "DELETE") {
    return fail("Method not allowed", 405);
  }

  const id = extractId(req);
  if (!id || id.length < 10 || id.length > 100) return fail("Invalid spot id");

  const user = await getUserFromRequest(req);
  if (!user) return fail("Sign in required", 401);

  // Ownership check.
  const { data: spot, error: spotErr } = await supabaseAdmin
    .from("spots")
    .select("id, author_id")
    .eq("id", id)
    .single();
  if (spotErr || !spot) return fail("Spot not found", 404);
  if (spot.author_id !== user.id) return fail("Not your spot", 403);

  if (req.method === "DELETE") {
    const { error } = await supabaseAdmin.from("spots").delete().eq("id", id);
    if (error) {
      console.error("Delete spot failed:", error);
      return fail("Failed to delete spot", 500);
    }
    return json({ ok: true }, 200);
  }

  // PATCH: validate the partial body and apply only the provided fields.
  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return fail("Invalid JSON");
  }

  const update: Record<string, unknown> = {};

  if (body.name !== undefined) {
    if (typeof body.name !== "string" || body.name.trim().length === 0 || body.name.length > 200)
      return fail("Invalid name");
    update.name = body.name.trim();
  }
  if (body.type !== undefined) {
    if (typeof body.type !== "string" || !VALID_TYPES.has(body.type))
      return fail("Invalid type");
    update.type = body.type;
  }
  if (body.address !== undefined) {
    if (body.address === null || (typeof body.address === "string" && body.address.trim().length === 0)) {
      update.address = null;
    } else if (typeof body.address === "string" && body.address.length <= 500) {
      update.address = body.address.trim();
    } else {
      return fail("Invalid address");
    }
  }
  if (body.tags !== undefined) {
    if (body.tags === null) {
      update.tags = null;
    } else if (Array.isArray(body.tags) && body.tags.length <= 20) {
      if (body.tags.some((t) => typeof t !== "string" || t.length === 0 || t.length > 50))
        return fail("Invalid tag");
      update.tags = body.tags;
    } else {
      return fail("Invalid tags");
    }
  }

  if (Object.keys(update).length === 0) return fail("No fields to update");

  const { data, error } = await supabaseAdmin
    .from("spots")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error || !data) {
    console.error("Patch spot failed:", error);
    return fail("Failed to update spot", 500);
  }

  return json({ spot: data }, 200);
}
