import { useEffect, useRef, useState } from "react";

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string;
const SESSION = crypto.randomUUID();

interface Suggestion {
  mapbox_id: string;
  name: string;
  full_address: string;
  place_formatted: string;
}

interface Props {
  onSelect: (center: [number, number], placeName: string) => void;
  userLocation: [number, number] | null;
}

export default function GeocodingSearch({ onSelect, userLocation }: Props) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);

  // Suggest
  useEffect(() => {
    if (query.length < 2) {
      setSuggestions([]);
      return;
    }

    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          q: query,
          access_token: TOKEN,
          session_token: SESSION,
          limit: "6",
          language: "en",
          types: "place,address,poi,neighborhood,locality,street",
        });
        if (userLocation) {
          params.set("proximity", `${userLocation[0]},${userLocation[1]}`);
        }

        const res = await fetch(
          `https://api.mapbox.com/search/searchbox/v1/suggest?${params}`
        );
        const data = await res.json();

        if (data.suggestions) {
          setSuggestions(
            data.suggestions.map((s: {
              mapbox_id: string;
              name: string;
              full_address?: string;
              place_formatted?: string;
            }) => ({
              mapbox_id: s.mapbox_id,
              name: s.name,
              full_address: s.full_address || "",
              place_formatted: s.place_formatted || "",
            }))
          );
          setOpen(true);
        }
      } catch {
        // silently ignore
      }
    }, 250);

    return () => clearTimeout(debounceRef.current);
  }, [query, userLocation]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Retrieve full feature on selection
  async function handleSelect(s: Suggestion) {
    setQuery(s.name);
    setOpen(false);
    setSuggestions([]);

    try {
      const params = new URLSearchParams({
        access_token: TOKEN,
        session_token: SESSION,
      });
      const res = await fetch(
        `https://api.mapbox.com/search/searchbox/v1/retrieve/${s.mapbox_id}?${params}`
      );
      const data = await res.json();
      const feature = data.features?.[0];
      if (feature?.geometry?.coordinates) {
        const [lng, lat] = feature.geometry.coordinates;
        onSelect([lng, lat], s.name);
      }
    } catch {
      // silently ignore
    }
  }

  return (
    <div className="geocoding-search" ref={containerRef}>
      <input
        className="geocoding-input"
        type="text"
        placeholder="Search any place, hotel, address..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
      />
      {open && suggestions.length > 0 && (
        <ul className="geocoding-results">
          {suggestions.map((s) => (
            <li key={s.mapbox_id} onClick={() => handleSelect(s)}>
              <span className="geo-name">{s.name}</span>
              {(s.place_formatted || s.full_address) && (
                <span className="geo-address">
                  {s.place_formatted || s.full_address}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
