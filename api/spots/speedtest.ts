import { supabaseAdmin } from "../_lib/supabase";
import { getUserFromRequest } from "../_lib/auth";
import { checkRateLimit, getClientIP } from "../_lib/ratelimit";
import { haversineMeters } from "../_lib/geo";
import { fail, json } from "../_lib/json";

export const config = { runtime: "edge" };

const MAX_DOWNLOAD_MBPS = 5000;
const MAX_UPLOAD_MBPS = 2000;
const MIN_PING_MS = 1;
const MAX_PING_MS = 5000;
const MAX_DISTANCE_M = 100;

interface SpeedtestBody {
  spot_id?: unknown;
  lat?: unknown;
  lng?: unknown;
  download?: unknown;
  upload?: unknown;
  ping?: unknown;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export default async function handler(req: Request) {
  if (req.method !== "POST") return fail("Method not allowed", 405);

  let body: SpeedtestBody;
  try {
    body = (await req.json()) as SpeedtestBody;
  } catch {
    return fail("Invalid JSON");
  }

  if (typeof body.spot_id !== "string" || body.spot_id.length < 10 || body.spot_id.length > 100)
    return fail("Invalid spot_id");
  if (!isFiniteNumber(body.lat) || body.lat < -90 || body.lat > 90)
    return fail("Invalid lat");
  if (!isFiniteNumber(body.lng) || body.lng < -180 || body.lng > 180)
    return fail("Invalid lng");
  if (!isFiniteNumber(body.download) || body.download < 0 || body.download > MAX_DOWNLOAD_MBPS)
    return fail("download out of range");
  if (!isFiniteNumber(body.upload) || body.upload < 0 || body.upload > MAX_UPLOAD_MBPS)
    return fail("upload out of range");
  if (!isFiniteNumber(body.ping) || body.ping < MIN_PING_MS || body.ping > MAX_PING_MS)
    return fail("ping out of range");

  const { data: spot, error: spotErr } = await supabaseAdmin
    .from("spots")
    .select("id, lat, lng")
    .eq("id", body.spot_id)
    .single();
  if (spotErr || !spot) return fail("Spot not found", 404);

  const dist = haversineMeters(body.lat, body.lng, spot.lat, spot.lng);
  if (dist > MAX_DISTANCE_M) {
    return fail(
      `Too far from spot (${Math.round(dist)}m, max ${MAX_DISTANCE_M}m)`,
      403
    );
  }

  const user = await getUserFromRequest(req);
  const ip = getClientIP(req);

  const rate = await checkRateLimit({
    ip,
    userId: user?.id ?? null,
    action: "submit_speedtest",
    windowMinutes: 60,
    maxAnon: 5,
    maxAuthed: 20,
  });
  if (!rate.ok) return fail("Rate limit exceeded — try again later", 429);

  // Append the test to the history table; an after-insert trigger
  // recomputes spots.avg_* and spots.last_tested_at from the rolling
  // history. The denormalised fields on `spots` are a cache, not a
  // source of truth.
  const { error: insertErr } = await supabaseAdmin
    .from("speed_tests")
    .insert({
      spot_id: body.spot_id,
      user_id: user?.id ?? null,
      download: body.download,
      upload: body.upload,
      ping: body.ping,
      lat: body.lat,
      lng: body.lng,
    });

  if (insertErr) {
    console.error("Speedtest insert failed:", insertErr);
    return fail("Failed to save speedtest", 500);
  }

  // Re-read the spot so the client gets the freshly recomputed averages.
  const { data: updated, error: readErr } = await supabaseAdmin
    .from("spots")
    .select()
    .eq("id", body.spot_id)
    .single();

  if (readErr || !updated) {
    console.error("Speedtest re-read failed:", readErr);
    return fail("Saved but could not refresh spot", 500);
  }

  return json({ spot: updated }, 200);
}
