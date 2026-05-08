import { supabaseAdmin } from "../_lib/supabase";
import { getUserFromRequest } from "../_lib/auth";
import { checkRateLimit, getClientIP } from "../_lib/ratelimit";
import { haversineMeters } from "../_lib/geo";
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
const MAX_DOWNLOAD_MBPS = 5000;
const MAX_UPLOAD_MBPS = 2000;
const MIN_PING_MS = 1;
const MAX_PING_MS = 5000;
const SPEEDTEST_MAX_DISTANCE_M = 200;

interface CreateBody {
  name?: unknown;
  type?: unknown;
  address?: unknown;
  lat?: unknown;
  lng?: unknown;
  avg_download?: unknown;
  avg_upload?: unknown;
  avg_ping?: unknown;
  tags?: unknown;
  wifi_ssid?: unknown;
  wifi_password?: unknown;
  // User's lat/lng at the moment they ran the initial speedtest.
  // Required when avg_download is present so we can verify the test
  // wasn't run hundreds of metres away from the spot.
  test_lat?: unknown;
  test_lng?: unknown;
}

const WIFI_SSID_MAX = 64;       // 32-byte SSID + UTF-8 buffer
const WIFI_PASSWORD_MAX = 128;  // WPA passphrase max is 63, gives slack

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export default async function handler(req: Request) {
  if (req.method !== "POST") return fail("Method not allowed", 405);

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return fail("Invalid JSON");
  }

  if (typeof body.name !== "string" || body.name.trim().length === 0 || body.name.length > 200)
    return fail("Invalid name");
  if (typeof body.type !== "string" || !VALID_TYPES.has(body.type))
    return fail("Invalid type");
  if (!isFiniteNumber(body.lat) || body.lat < -90 || body.lat > 90)
    return fail("Invalid lat");
  if (!isFiniteNumber(body.lng) || body.lng < -180 || body.lng > 180)
    return fail("Invalid lng");

  if (body.address != null) {
    if (typeof body.address !== "string" || body.address.length > 500)
      return fail("Invalid address");
  }

  if (body.avg_download != null) {
    if (!isFiniteNumber(body.avg_download) || body.avg_download < 0 || body.avg_download > MAX_DOWNLOAD_MBPS)
      return fail("avg_download out of range");
  }
  if (body.avg_upload != null) {
    if (!isFiniteNumber(body.avg_upload) || body.avg_upload < 0 || body.avg_upload > MAX_UPLOAD_MBPS)
      return fail("avg_upload out of range");
  }
  if (body.avg_ping != null) {
    if (!isFiniteNumber(body.avg_ping) || body.avg_ping < MIN_PING_MS || body.avg_ping > MAX_PING_MS)
      return fail("avg_ping out of range");
  }

  if (body.tags != null) {
    if (!Array.isArray(body.tags) || body.tags.length > 20) return fail("Invalid tags");
    if (body.tags.some((t) => typeof t !== "string" || t.length === 0 || t.length > 50))
      return fail("Invalid tag");
  }

  if (body.wifi_ssid != null) {
    if (typeof body.wifi_ssid !== "string" || body.wifi_ssid.length > WIFI_SSID_MAX)
      return fail("Invalid wifi_ssid");
  }
  if (body.wifi_password != null) {
    if (typeof body.wifi_password !== "string" || body.wifi_password.length > WIFI_PASSWORD_MAX)
      return fail("Invalid wifi_password");
  }

  // If the request bundles an initial speedtest, the user must have run
  // it physically at the spot. Reject creates that try to attach a test
  // taken hundreds of metres away — the data would be misleading.
  const hasInitialTest =
    typeof body.avg_download === "number" &&
    typeof body.avg_upload === "number" &&
    typeof body.avg_ping === "number";

  if (hasInitialTest) {
    if (!isFiniteNumber(body.test_lat) || body.test_lat < -90 || body.test_lat > 90)
      return fail("Speedtest requires test_lat");
    if (!isFiniteNumber(body.test_lng) || body.test_lng < -180 || body.test_lng > 180)
      return fail("Speedtest requires test_lng");
    const dist = haversineMeters(body.test_lat, body.test_lng, body.lat, body.lng);
    if (dist > SPEEDTEST_MAX_DISTANCE_M) {
      return fail(
        `Speedtest must be run at the spot (you were ${Math.round(dist)}m away, max ${SPEEDTEST_MAX_DISTANCE_M}m)`,
        403
      );
    }
  }

  const user = await getUserFromRequest(req);
  const ip = getClientIP(req);

  const rate = await checkRateLimit({
    ip,
    userId: user?.id ?? null,
    action: "create_spot",
    windowMinutes: 60,
    maxAnon: 3,
    maxAuthed: 10,
  });
  if (!rate.ok) return fail("Rate limit exceeded — try again later", 429);

  // Insert the spot first with no avg_* — those fields are now a
  // denormalised cache populated by the speed_tests trigger.
  const { data: created, error: createErr } = await supabaseAdmin
    .from("spots")
    .insert({
      name: body.name.trim(),
      type: body.type,
      address: typeof body.address === "string" && body.address.trim().length > 0
        ? body.address.trim()
        : null,
      lat: body.lat,
      lng: body.lng,
      tags: (body.tags as string[] | null | undefined) ?? null,
      wifi_ssid: typeof body.wifi_ssid === "string" && body.wifi_ssid.trim().length > 0
        ? body.wifi_ssid.trim()
        : null,
      wifi_password: typeof body.wifi_password === "string" && body.wifi_password.length > 0
        ? body.wifi_password
        : null,
      author_id: user?.id ?? null,
    })
    .select()
    .single();

  if (createErr || !created) {
    console.error("Create spot failed:", createErr);
    return fail("Failed to save spot", 500);
  }

  // If the form included a speedtest, append it to the history. The
  // trigger fills in spots.avg_* and last_tested_at.
  const hasTest =
    typeof body.avg_download === "number" &&
    typeof body.avg_upload === "number" &&
    typeof body.avg_ping === "number";

  if (hasTest) {
    const { error: testErr } = await supabaseAdmin
      .from("speed_tests")
      .insert({
        spot_id: created.id,
        user_id: user?.id ?? null,
        download: body.avg_download,
        upload: body.avg_upload,
        ping: body.avg_ping,
        // Record the actual location where the test ran (verified to
        // be within 200m of the spot above), not the spot itself.
        lat: typeof body.test_lat === "number" ? body.test_lat : body.lat,
        lng: typeof body.test_lng === "number" ? body.test_lng : body.lng,
      });

    if (testErr) {
      // The spot is created; just log the test failure and return what
      // we have. The user can re-test later.
      console.error("Initial speedtest insert failed:", testErr);
    } else {
      // Re-read so the response includes the recomputed averages.
      const { data: refreshed } = await supabaseAdmin
        .from("spots")
        .select()
        .eq("id", created.id)
        .single();
      if (refreshed) return json({ spot: refreshed }, 201);
    }
  }

  return json({ spot: created }, 201);
}
