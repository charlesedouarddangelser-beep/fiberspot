import type { OsmPoi } from "../types/osm";

// Fetches POIs in a bbox via Mapbox Search Box /category endpoint.
// Replaces the previous Overpass/OSM implementation:
//   - Better coverage (Mapbox uses Foursquare data + own pipeline)
//   - No CORS proxy needed (Mapbox endpoints have CORS headers)
//   - Same auth as the rest of the app (existing VITE_MAPBOX_TOKEN)

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string;
const BASE = "https://api.mapbox.com/search/searchbox/v1/category";

const MIN_ZOOM = 14;
const MAX_BBOX_AREA = 0.01; // ~10km x 10km — keeps queries fast and on-topic
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const PER_CATEGORY_LIMIT = 25;

// Mapbox canonical category IDs → our display labels.
// If a category 404s upstream, we just skip it silently (defensive).
const CATEGORIES: Record<string, string> = {
  cafe: "Cafe",
  coffee: "Cafe",
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

interface MapboxFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    mapbox_id: string;
    name?: string;
    name_preferred?: string;
    full_address?: string;
    address?: string;
    place_formatted?: string;
    poi_category?: string[];
    poi_category_ids?: string[];
    metadata?: { open_hours?: { periods?: unknown[] } };
  };
}

async function fetchCategory(
  category: string,
  bounds: OverpassBounds,
  signal?: AbortSignal
): Promise<OsmPoi[]> {
  const { south, west, north, east } = bounds;
  const params = new URLSearchParams({
    access_token: TOKEN,
    bbox: `${west},${south},${east},${north}`,
    limit: String(PER_CATEGORY_LIMIT),
    language: "en",
  });

  const res = await fetch(`${BASE}/${category}?${params}`, { signal });
  if (!res.ok) {
    // Some categories may not be supported — skip silently.
    if (res.status === 404 || res.status === 400) return [];
    throw new Error(`Mapbox category ${category} error: ${res.status}`);
  }

  const json = (await res.json()) as { features?: MapboxFeature[] };
  const displayType = CATEGORIES[category] ?? category;

  return (json.features ?? []).map((f) => ({
    id: f.properties.mapbox_id,
    lat: f.geometry.coordinates[1],
    lng: f.geometry.coordinates[0],
    name: f.properties.name ?? f.properties.name_preferred ?? null,
    type: displayType,
    address:
      f.properties.full_address ??
      f.properties.address ??
      f.properties.place_formatted ??
      null,
    openingHours: null, // /category doesn't return hours; fetch via /retrieve if needed
    tags: {},
  }));
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

  // Fire all category calls in parallel.
  const results = await Promise.all(
    Object.keys(CATEGORIES).map((cat) =>
      fetchCategory(cat, bounds, signal).catch((err) => {
        if (err?.name === "AbortError") throw err;
        console.warn(`Mapbox POI fetch failed for ${cat}:`, err);
        return [] as OsmPoi[];
      })
    )
  );

  // Merge + dedupe by mapbox_id (cafe + coffee can overlap).
  const seen = new Set<string>();
  const pois: OsmPoi[] = [];
  for (const list of results) {
    for (const poi of list) {
      if (seen.has(poi.id)) continue;
      seen.add(poi.id);
      pois.push(poi);
    }
  }

  cache.set(key, { pois, ts: Date.now() });
  return pois;
}
