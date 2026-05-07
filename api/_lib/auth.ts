import { supabaseAdmin } from "./supabase";

export interface AuthedUser {
  id: string;
  email: string | null;
}

// Reads the optional `Authorization: Bearer <jwt>` header and resolves it to
// a Supabase user. Returns null if no header, invalid token, or expired.
// Anon callers are accepted (returns null) — endpoints decide whether to
// require auth or fall back to anon rate limits.
export async function getUserFromRequest(req: Request): Promise<AuthedUser | null> {
  const auth = req.headers.get("authorization");
  if (!auth?.toLowerCase().startsWith("bearer ")) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}
