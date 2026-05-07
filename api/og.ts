import { supabaseAdmin } from "./_lib/supabase";

export const config = { runtime: "edge" };

const SITE_URL = "https://fiberspot.vercel.app";
const DEFAULT_IMAGE = `${SITE_URL}/og-default.png`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtSpeed(value: number | null, unit: string): string | null {
  if (value === null) return null;
  return `${Math.round(value)} ${unit}`;
}

function buildDescription(spot: {
  type: string;
  address: string | null;
  avg_download: number | null;
  avg_ping: number | null;
}): string {
  const speed = fmtSpeed(spot.avg_download, "Mbps");
  const ping = fmtSpeed(spot.avg_ping, "ms");
  const speedPart =
    speed && ping ? `${speed} download · ${ping} ping`
    : speed ? `${speed} download`
    : "Not yet tested";
  const place = spot.address ? ` — ${spot.address}` : "";
  return `${spot.type} · ${speedPart}${place}`;
}

function ogHtml(args: {
  title: string;
  description: string;
  url: string;
  image: string;
}): string {
  const { title, description, url, image } = args;
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${t}</title>
<meta name="description" content="${d}">

<meta property="og:type" content="website">
<meta property="og:site_name" content="Fiberspot">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${d}">
<meta property="og:url" content="${escapeHtml(url)}">
<meta property="og:image" content="${escapeHtml(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${t}">
<meta name="twitter:description" content="${d}">
<meta name="twitter:image" content="${escapeHtml(image)}">
</head>
<body>
<h1>${t}</h1>
<p>${d}</p>
<p><a href="${escapeHtml(url)}">Open on Fiberspot</a></p>
</body>
</html>`;
}

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  // Sensible fallback if the function is hit without an id.
  if (!id || id.length < 10 || id.length > 100) {
    return new Response(
      ogHtml({
        title: "Fiberspot — Find Wi-Fi spots near you",
        description:
          "Community-driven map of Wi-Fi spots. Find a fast connection nearby, contribute the ones you know, test them on the spot.",
        url: SITE_URL,
        image: DEFAULT_IMAGE,
      }),
      { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
    );
  }

  const { data: spot } = await supabaseAdmin
    .from("spots")
    .select("name, type, address, avg_download, avg_ping")
    .eq("id", id)
    .single();

  if (!spot) {
    return new Response(
      ogHtml({
        title: "Spot not found — Fiberspot",
        description: "This Wi-Fi spot doesn't exist anymore.",
        url: `${SITE_URL}/spot/${id}`,
        image: DEFAULT_IMAGE,
      }),
      { status: 404, headers: { "content-type": "text/html; charset=utf-8" } }
    );
  }

  return new Response(
    ogHtml({
      title: `${spot.name} on Fiberspot`,
      description: buildDescription(spot),
      url: `${SITE_URL}/spot/${id}`,
      image: DEFAULT_IMAGE,
    }),
    {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=300, s-maxage=300",
      },
    }
  );
}
