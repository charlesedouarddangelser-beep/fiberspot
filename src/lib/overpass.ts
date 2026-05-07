import type { OsmPoi } from "../types/osm";

// In dev, Vite proxy handles CORS (see vite.config.ts).
// In prod, hit our Vercel edge function which proxies to overpass-api.de.
const OVERPASS_URL = import.meta.env.DEV ? "/overpass" : "/api/overpass";
const MIN_ZOOM = 14;
const MAX_BBOX_AREA = 0.01; // ~10km x 10km max — keeps queries fast
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// OSM amenity/tourism → FiberSpot type
const TYPE_MAP: Record<string, string> = {
  cafe: "Cafe",
  library: "Library",
  coworking_space: "Coworking",
  restaurant: "Restaurant",
  hotel: "Hotel",
};

interface CacheEntry {
  pois: OsmPoi[];
  ts: number;
}

const cache = new Map<string, CacheEntry>();

function quantizeKey(s: number, w: number, n: number, e: number): string {
  return [s, w, n, e].map((v) => v.toFixed(3)).join(",");
}

function cleanCache() {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now - entry.ts > CACHE_TTL) cache.delete(key);
  }
}

function buildAddress(tags: Record<string, string>): string | null {
  const parts: string[] = [];
  if (tags["addr:housenumber"]) parts.push(tags["addr:housenumber"]);
  if (tags["addr:street"]) parts.push(tags["addr:street"]);
  if (tags["addr:city"]) parts.push(tags["addr:city"]);
  return parts.length > 0 ? parts.join(" ") : null;
}

function mapType(tags: Record<string, string>): string | null {
  if (tags.amenity && TYPE_MAP[tags.amenity]) return TYPE_MAP[tags.amenity];
  if (tags.tourism && TYPE_MAP[tags.tourism]) return TYPE_MAP[tags.tourism];
  return null;
}

export interface OverpassBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export function shouldFetch(zoom: number, bounds: OverpassBounds): boolean {
  if (zoom < MIN_ZOOM) return false;
  const area = (bounds.north - bounds.south) * (bounds.east - bounds.west);
  return area <= MAX_BBOX_AREA;
}

export async function fetchOverpassPois(
  bounds: OverpassBounds,
  signal?: AbortSignal
): Promise<OsmPoi[]> {
  const { south, west, north, east } = bounds;
  const key = quantizeKey(south, west, north, east);

  cleanCache();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.pois;

  const bbox = `${south},${west},${north},${east}`;
  const query = `
[out:json][timeout:15];
(
  node["amenity"="cafe"](${bbox});
  node["amenity"="library"](${bbox});
  node["amenity"="coworking_space"](${bbox});
  node["tourism"="hotel"](${bbox});
);
out body 300;`;

  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    body: `data=${encodeURIComponent(query)}`,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    signal,
  });

  if (!res.ok) {
    if (res.status === 429) throw new Error("overpass_rate_limit");
    throw new Error(`Overpass error: ${res.status}`);
  }

  const json = await res.json();

  const pois: OsmPoi[] = (json.elements || [])
    .map((el: { id: number; lat: number; lon: number; tags?: Record<string, string> }) => {
      const tags = el.tags || {};
      const type = mapType(tags);
      if (!type) return null;
      return {
        id: el.id,
        lat: el.lat,
        lng: el.lon,
        name: tags.name || null,
        type,
        address: buildAddress(tags),
        openingHours: tags.opening_hours || null,
        tags,
      } satisfies OsmPoi;
    })
    .filter(Boolean) as OsmPoi[];

  cache.set(key, { pois, ts: Date.now() });
  return pois;
}
