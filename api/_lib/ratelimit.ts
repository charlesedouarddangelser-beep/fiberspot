import { supabaseAdmin } from "./supabase";

type Action = "create_spot" | "submit_speedtest";

interface RateLimitOpts {
  ip: string | null;
  userId: string | null;
  action: Action;
  windowMinutes: number;
  maxAnon: number;     // applied when userId is null
  maxAuthed: number;   // applied when userId is present
}

type RateLimitResult =
  | { ok: true }
  | { ok: false; reason: "rate_limit_user" | "rate_limit_ip" | "no_identity" };

export async function checkRateLimit(opts: RateLimitOpts): Promise<RateLimitResult> {
  const since = new Date(Date.now() - opts.windowMinutes * 60_000).toISOString();

  if (opts.userId) {
    const { count } = await supabaseAdmin
      .from("rate_limit_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", opts.userId)
      .eq("action", opts.action)
      .gte("created_at", since);
    if ((count ?? 0) >= opts.maxAuthed) return { ok: false, reason: "rate_limit_user" };
  } else if (opts.ip) {
    const { count } = await supabaseAdmin
      .from("rate_limit_events")
      .select("id", { count: "exact", head: true })
      .eq("ip", opts.ip)
      .eq("action", opts.action)
      .gte("created_at", since);
    if ((count ?? 0) >= opts.maxAnon) return { ok: false, reason: "rate_limit_ip" };
  } else {
    // Should not happen behind Vercel — every request has either a user or
    // an IP — but fail closed if it does.
    return { ok: false, reason: "no_identity" };
  }

  await supabaseAdmin.from("rate_limit_events").insert({
    ip: opts.ip,
    user_id: opts.userId,
    action: opts.action,
  });

  return { ok: true };
}

export function getClientIP(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    // First entry is the original client; rest are proxies.
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip");
}
