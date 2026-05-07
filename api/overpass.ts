// Vercel Edge function — proxy to overpass-api.de
// Bypasses CORS so the client-side Overpass queries work in production.
// In dev, vite.config.ts handles the proxy directly.

export const config = {
  runtime: "edge",
};

const UPSTREAM = "https://overpass-api.de/api/interpreter";

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const body = await req.text();

    const upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    const data = await upstream.text();

    return new Response(data, {
      status: upstream.status,
      headers: {
        "Content-Type": "application/json",
        // Light caching — Overpass data is slow-moving and the client also caches by bbox.
        "Cache-Control": "public, max-age=300, s-maxage=300",
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "overpass_proxy_failed", detail: String(err) }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }
}
