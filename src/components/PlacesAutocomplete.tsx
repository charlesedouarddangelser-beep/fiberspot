import { useEffect, useRef, useState } from "react";
import {
  suggestPlaces,
  retrievePlace,
  inferTypeFromCategories,
  type PlaceFeature,
  type PlaceSuggestion,
} from "../lib/mapbox-search";

interface Props {
  value: string;
  onChange: (next: string) => void;
  onPick: (feature: PlaceFeature) => void;
  proximity?: [number, number]; // [lng, lat] for biasing suggestions
  placeholder?: string;
  required?: boolean;
}

export default function PlacesAutocomplete({
  value,
  onChange,
  onPick,
  proximity,
  placeholder,
  required,
}: Props) {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const sessionTokenRef = useRef<string>(crypto.randomUUID());
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  // Latest proximity, kept out of the effect's dep array — userLocation
  // ticks every few seconds via watchPosition and would otherwise re-run
  // the suggest call (and re-open the dropdown) constantly.
  const proximityRef = useRef(proximity);
  proximityRef.current = proximity;
  // Set to true right before we programmatically change `value` (i.e.
  // after the user picks a suggestion) so the resulting effect run
  // doesn't immediately refetch and re-open the dropdown.
  const skipNextRef = useRef(false);

  // Debounced suggest as the user types
  useEffect(() => {
    if (skipNextRef.current) {
      skipNextRef.current = false;
      return;
    }
    if (value.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setLoading(true);
      suggestPlaces({
        query: value,
        sessionToken: sessionTokenRef.current,
        proximity: proximityRef.current,
        signal: ac.signal,
      })
        .then((s) => {
          if (ac.signal.aborted) return;
          setSuggestions(s);
          setOpen(s.length > 0);
        })
        .catch(() => {})
        .finally(() => {
          if (!ac.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => clearTimeout(debounceRef.current);
  }, [value]);

  // Close dropdown on outside click
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  async function handlePick(s: PlaceSuggestion) {
    setOpen(false);
    setSuggestions([]);
    // Mark the upcoming value change as a programmatic pick so the
    // suggest effect skips this round and doesn't reopen the dropdown.
    skipNextRef.current = true;
    onChange(s.name);
    const feature = await retrievePlace({
      mapbox_id: s.mapbox_id,
      sessionToken: sessionTokenRef.current,
    });
    if (feature) {
      // The /retrieve response sometimes omits full_address for POIs
      // that are well-known by name but light on metadata (venues,
      // landmarks). The suggestion's place_formatted / full_address are
      // always populated, so prefer those when retrieve came back blank.
      if (!feature.full_address) {
        feature.full_address = s.place_formatted || s.full_address || "";
      }
      // Same for category-based type inference: suggestion carries
      // poi_category_ids reliably; retrieve sometimes drops them.
      if (feature.inferred_type === "Other" && s.poi_category_ids?.length) {
        feature.poi_category_ids = s.poi_category_ids;
        feature.inferred_type = inferTypeFromCategories(s.poi_category_ids);
      }
      onPick(feature);
      // Start a fresh session for the next search.
      sessionTokenRef.current = crypto.randomUUID();
    }
  }

  return (
    <div className="places-autocomplete" ref={containerRef}>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        placeholder={placeholder}
        required={required}
        autoComplete="off"
      />
      {loading && <span className="places-loading" aria-hidden>…</span>}
      {open && suggestions.length > 0 && (
        <ul className="places-results">
          {suggestions.map((s) => (
            <li key={s.mapbox_id} onMouseDown={(e) => { e.preventDefault(); handlePick(s); }}>
              <span className="places-name">{s.name}</span>
              {(s.place_formatted || s.full_address) && (
                <span className="places-address">
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
