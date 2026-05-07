import { useEffect, useRef, useState } from "react";
import type { Map as MapboxMap } from "mapbox-gl";
import type { Spot } from "../types/spot";
import type { OsmPoi } from "../types/osm";
import { fetchOverpassPois, shouldFetch } from "../lib/mapbox-pois";
import { haversineMeters } from "../lib/geo";

const DEBOUNCE_MS = 500;
const DEDUP_RADIUS = 50; // meters

export function useOverpassPois(
  mapRef: React.RefObject<MapboxMap | null>,
  spots: Spot[]
) {
  const [osmPois, setOsmPois] = useState<OsmPoi[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    function fetchPois() {
      const m = mapRef.current;
      if (!m) return;

      const zoom = m.getZoom();
      const b = m.getBounds();
      if (!b) return;
      const bounds = {
        south: b.getSouth(),
        west: b.getWest(),
        north: b.getNorth(),
        east: b.getEast(),
      };

      if (!shouldFetch(zoom, bounds)) {
        setOsmPois([]);
        return;
      }

      // Cancel previous request
      if (abortRef.current) abortRef.current.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      setLoading(true);
      fetchOverpassPois(bounds, ac.signal)
        .then((pois) => {
          // Deduplicate against existing FiberSpot spots
          const deduped = pois.filter(
            (poi) =>
              !spots.some(
                (s) => haversineMeters(poi.lat, poi.lng, s.lat, s.lng) < DEDUP_RADIUS
              )
          );
          setOsmPois(deduped);
        })
        .catch((err) => {
          if (err.name === "AbortError") return;
          console.warn("Overpass fetch failed:", err);
        })
        .finally(() => setLoading(false));
    }

    function onMoveEnd() {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(fetchPois, DEBOUNCE_MS);
    }

    // Initial fetch
    if (map.loaded()) {
      fetchPois();
    } else {
      map.once("load", fetchPois);
    }

    map.on("moveend", onMoveEnd);

    return () => {
      map.off("moveend", onMoveEnd);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [mapRef, spots]);

  return { osmPois, loading };
}
