// Mapbox Search Box wrapper for the AddSpotForm autocomplete. Reuses
// the same underlying API as GeocodingSearch — kept separate so the
// form can grab the *full* feature (coords, address, category) on
// selection rather than just a label + center point.

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string;
const BASE = "https://api.mapbox.com/search/searchbox/v1";

export interface PlaceSuggestion {
  mapbox_id: string;
  name: string;
  full_address: string;
  place_formatted: string;
  feature_type: string;
  poi_category_ids?: string[];
}

export interface PlaceFeature {
  name: string;
  full_address: string;
  lat: number;
  lng: number;
  poi_category_ids?: string[];
  inferred_type: string;
}

interface SuggestApiItem {
  mapbox_id: string;
  name: string;
  full_address?: string;
  place_formatted?: string;
  feature_type?: string;
  poi_category_ids?: string[];
}

interface RetrieveApiFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    name?: string;
    full_address?: string;
    address?: string;
    place_formatted?: string;
    poi_category_ids?: string[];
  };
}

export function inferTypeFromCategories(ids: string[] | undefined): string {
  if (!ids?.length) return "Other";
  for (const id of ids) {
    const lc = id.toLowerCase();
    if (lc.includes("cafe") || lc.includes("coffee")) return "Cafe";
    if (lc.includes("library") || lc.includes("bookstore")) return "Library";
    if (lc.includes("coworking")) return "Coworking";
    if (lc.includes("hotel") || lc.includes("hostel") || lc.includes("motel")) return "Hotel";
    if (lc.includes("restaurant") || lc.includes("dining") || lc.includes("food") || lc.includes("bar") || lc.includes("pub"))
      return "Restaurant";
    if (lc.includes("park") || lc.includes("garden")) return "Park";
  }
  return "Other";
}

export async function suggestPlaces(args: {
  query: string;
  sessionToken: string;
  proximity?: [number, number]; // [lng, lat]
  signal?: AbortSignal;
}): Promise<PlaceSuggestion[]> {
  if (args.query.trim().length < 2) return [];
  const params = new URLSearchParams({
    q: args.query,
    access_token: TOKEN,
    session_token: args.sessionToken,
    limit: "6",
    language: "en",
    types: "poi,place,address",
  });
  if (args.proximity) {
    params.set("proximity", `${args.proximity[0]},${args.proximity[1]}`);
  }
  const res = await fetch(`${BASE}/suggest?${params}`, { signal: args.signal });
  if (!res.ok) return [];
  const data = (await res.json()) as { suggestions?: SuggestApiItem[] };
  return (data.suggestions ?? []).map((s) => ({
    mapbox_id: s.mapbox_id,
    name: s.name,
    full_address: s.full_address ?? "",
    place_formatted: s.place_formatted ?? "",
    feature_type: s.feature_type ?? "",
    poi_category_ids: s.poi_category_ids,
  }));
}

export async function retrievePlace(args: {
  mapbox_id: string;
  sessionToken: string;
  signal?: AbortSignal;
}): Promise<PlaceFeature | null> {
  const params = new URLSearchParams({
    access_token: TOKEN,
    session_token: args.sessionToken,
  });
  const res = await fetch(`${BASE}/retrieve/${args.mapbox_id}?${params}`, { signal: args.signal });
  if (!res.ok) return null;
  const data = (await res.json()) as { features?: RetrieveApiFeature[] };
  const f = data.features?.[0];
  if (!f) return null;
  const [lng, lat] = f.geometry.coordinates;
  return {
    name: f.properties.name ?? "",
    full_address: f.properties.full_address ?? f.properties.address ?? f.properties.place_formatted ?? "",
    lat,
    lng,
    poi_category_ids: f.properties.poi_category_ids,
    inferred_type: inferTypeFromCategories(f.properties.poi_category_ids),
  };
}

export async function reverseGeocode(args: {
  lat: number;
  lng: number;
  signal?: AbortSignal;
}): Promise<{ name: string | null; address: string | null }> {
  try {
    const params = new URLSearchParams({
      longitude: String(args.lng),
      latitude: String(args.lat),
      access_token: TOKEN,
    });
    const res = await fetch(
      `https://api.mapbox.com/search/geocode/v6/reverse?${params}`,
      { signal: args.signal }
    );
    if (!res.ok) return { name: null, address: null };
    const data = await res.json();
    const feat = data.features?.[0];
    if (!feat) return { name: null, address: null };
    return {
      name: feat.properties?.name ?? null,
      address: feat.properties?.full_address ?? feat.properties?.name ?? null,
    };
  } catch {
    return { name: null, address: null };
  }
}
