import { next, rewrite } from "@vercel/edge";

// Bots that fetch OG meta tags for share previews. The list isn't
// exhaustive; the regex catches anything claiming to be a crawler/bot.
const BOT_UA_RE = /bot|crawl|spider|slack|facebook|twitter|discord|telegram|whatsapp|linkedin|pinterest|preview|fetch|prerender|embed|scraper/i;

export const config = {
  matcher: "/spot/:id*",
};

export default function middleware(req: Request) {
  const url = new URL(req.url);
  const match = url.pathname.match(/^\/spot\/([\w-]{10,100})$/);
  if (!match) return next();

  const ua = req.headers.get("user-agent") ?? "";
  if (BOT_UA_RE.test(ua)) {
    // Bot scrape — rewrite to the OG-only HTML function. URL stays the
    // same in the share preview footer; the bot just gets a leaner page
    // with the right meta tags.
    return rewrite(new URL(`/api/og?id=${match[1]}`, req.url));
  }

  // Browser hit — Vercel's Vite preset would normally rewrite unknown
  // paths to /index.html for SPA routing, but middleware short-circuits
  // that fallback. Do the rewrite ourselves so the SPA can read the URL
  // from window.location.
  return rewrite(new URL("/index.html", req.url));
}
