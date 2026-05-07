import { supabase } from "./supabase";
import type { Spot, SpotInsert } from "../types/spot";

// All writes go through Vercel /api/* edge functions. The functions use
// the Supabase service-role key and bypass RLS. The browser only ever
// reads from supabase-js directly (RLS allows public select).

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Server returned non-JSON response (${res.status})`);
  }
  if (!res.ok) {
    const msg =
      (data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : null) ?? `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

export async function createSpot(spot: SpotInsert): Promise<Spot> {
  const { spot: created } = await postJson<{ spot: Spot }>("/api/spots/create", spot);
  return created;
}

export async function submitSpeedtest(args: {
  spot_id: string;
  lat: number;
  lng: number;
  download: number;
  upload: number;
  ping: number;
}): Promise<Spot> {
  const { spot } = await postJson<{ spot: Spot }>("/api/spots/speedtest", args);
  return spot;
}
