import { useEffect, useRef, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Spot } from "../types/spot";
import type { OsmPoi } from "../types/osm";
import { useOverpassPois } from "../hooks/useOverpassPois";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

interface Props {
  spots: Spot[];
  center: [number, number];
  zoom: number;
  userLocation: [number, number] | null;
  typeFilter: string;
  selectedSpotId: string | null;
  onSelectSpot: (spot: Spot) => void;
  onSelectOsmPoi: (poi: OsmPoi) => void;
  onRecenter: () => void;
  onLongPress: (lng: number, lat: number) => void;
  onOsmPoisChange?: (pois: OsmPoi[]) => void;
}

export default function Map({ spots, center, zoom, userLocation, typeFilter, selectedSpotId, onSelectSpot, onSelectOsmPoi, onRecenter, onLongPress, onOsmPoisChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const userMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const selectedMarkerRef = useRef<mapboxgl.Marker | null>(null);

  const { osmPois } = useOverpassPois(mapRef, spots);

  // Surface the latest POI set to the parent so the sidebar can list
  // them alongside user-spots.
  useEffect(() => {
    onOsmPoisChange?.(osmPois);
  }, [osmPois, onOsmPoisChange]);

  // Stable callback refs to avoid stale closures in map event handlers
  const onSelectOsmPoiRef = useRef(onSelectOsmPoi);
  onSelectOsmPoiRef.current = onSelectOsmPoi;
  const onSelectSpotRef = useRef(onSelectSpot);
  onSelectSpotRef.current = onSelectSpot;
  const onLongPressRef = useRef(onLongPress);
  onLongPressRef.current = onLongPress;
  const spotsRef = useRef(spots);
  spotsRef.current = spots;

  // Convert osmPois to GeoJSON (respects the active type filter)
  const osmGeoJson = useCallback((): GeoJSON.FeatureCollection => ({
    type: "FeatureCollection",
    features: osmPois
      .filter((poi) => typeFilter === "All" || poi.type === typeFilter)
      .map((poi) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [poi.lng, poi.lat] },
        properties: {
          id: poi.id,
          name: poi.name || `${poi.type}`,
          type: poi.type,
          address: poi.address,
          openingHours: poi.openingHours,
          lat: poi.lat,
          lng: poi.lng,
        },
      })),
  }), [osmPois, typeFilter]);

  // Convert FiberSpot spots to GeoJSON (respects the active type filter)
  const spotsGeoJson = useCallback((): GeoJSON.FeatureCollection => ({
    type: "FeatureCollection",
    features: spots
      .filter((s) => typeFilter === "All" || s.type === typeFilter)
      .map((spot) => {
      const untested = spot.avg_download === null && spot.avg_upload === null && spot.avg_ping === null;
      let color: string;
      if (spot.avg_download === null)      color = "#e4e4e7"; // off-white — untested
      else if (spot.avg_download >= 50)    color = "#22c55e"; // green — fast
      else if (spot.avg_download >= 20)    color = "#f59e0b"; // orange — medium
      else                                  color = "#ef4444"; // red — slow

      return {
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [spot.lng, spot.lat] },
        properties: {
          id: spot.id,
          name: spot.name,
          type: spot.type,
          color,
          untested,
          label: untested ? "?" : (spot.avg_download !== null ? `${spot.avg_download}` : "?"),
        },
      };
    }),
  }), [spots, typeFilter]);

  const spotsGeoJsonRef = useRef(spotsGeoJson);
  spotsGeoJsonRef.current = spotsGeoJson;
  const osmGeoJsonRef = useRef(osmGeoJson);
  osmGeoJsonRef.current = osmGeoJson;

  // Init map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center,
      zoom: 13,
    });
    map.addControl(new mapboxgl.NavigationControl(), "bottom-right");

    map.on("load", () => {
      // ---- OSM POIs (bottom layer) ----
      map.addSource("osm-pois", {
        type: "geojson",
        data: osmGeoJsonRef.current(),
      });

      map.addLayer({
        id: "osm-pois-circles",
        type: "circle",
        source: "osm-pois",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 13, 3, 16, 5, 18, 7],
          "circle-color": "#e4e4e7",
          "circle-opacity": 0.18,
          "circle-stroke-color": "#e4e4e7",
          "circle-stroke-width": 1,
          "circle-stroke-opacity": 0.45,
        },
      });

      map.addLayer({
        id: "osm-pois-labels",
        type: "symbol",
        source: "osm-pois",
        minzoom: 15,
        layout: {
          "text-field": ["get", "name"],
          "text-size": 11,
          "text-offset": [0, 1.2],
          "text-anchor": "top",
          "text-max-width": 8,
          "text-allow-overlap": false,
        },
        paint: {
          "text-color": "#e4e4e7",
          "text-halo-color": "#000000",
          "text-halo-width": 1.2,
          "text-opacity": 0.55,
        },
      });

      // ---- FiberSpot spots (on top, with clustering) ----
      map.addSource("spots", {
        type: "geojson",
        data: spotsGeoJsonRef.current(),
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 50,
      });

      // Cluster bubbles (only when point_count is set).
      map.addLayer({
        id: "spots-clusters",
        type: "circle",
        source: "spots",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#6366f1",
          "circle-opacity": 0.85,
          "circle-stroke-color": "#a5b4fc",
          "circle-stroke-width": 2,
          "circle-radius": [
            "step",
            ["get", "point_count"],
            18, 10,   // <10 spots → 18px
            22, 30,   // <30 → 22px
            28,       // 30+ → 28px
          ],
        },
      });

      map.addLayer({
        id: "spots-cluster-count",
        type: "symbol",
        source: "spots",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-size": 12,
          "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
        },
        paint: {
          "text-color": "#fff",
        },
      });

      // Individual spot layers — explicitly skip clustered features so
      // singletons don't paint on top of cluster bubbles.
      const singleSpot = ["!", ["has", "point_count"]] as mapboxgl.FilterSpecification;

      map.addLayer({
        id: "spots-glow",
        type: "circle",
        source: "spots",
        filter: singleSpot,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 13, 8, 16, 14, 18, 18],
          "circle-color": ["get", "color"],
          "circle-opacity": 0.15,
          "circle-blur": 1,
        },
      });

      map.addLayer({
        id: "spots-circles",
        type: "circle",
        source: "spots",
        filter: singleSpot,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 13, 4, 16, 7, 18, 9],
          "circle-color": ["get", "color"],
          "circle-opacity": 0.95,
          "circle-stroke-color": ["get", "color"],
          "circle-stroke-width": 1.5,
          "circle-stroke-opacity": 1,
        },
      });

      map.addLayer({
        id: "spots-labels",
        type: "symbol",
        source: "spots",
        filter: singleSpot,
        minzoom: 14,
        layout: {
          "text-field": ["get", "name"],
          "text-size": 11,
          "text-offset": [0, 1.4],
          "text-anchor": "top",
          "text-max-width": 8,
          "text-allow-overlap": false,
          "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
        },
        paint: {
          "text-color": ["get", "color"],
          "text-halo-color": "#000000",
          "text-halo-width": 1.2,
        },
      });

      // ---- Click / tap with a 16px hit buffer ----
      // The visible circles are 4–9px in radius, way below a finger-
      // friendly target. Querying within a buffer around the tap point
      // and picking the closest feature lets users hit pins that are
      // visually near where they tap, even on tightly-packed clusters.
      const HIT_BUFFER_PX = 16;

      const featuresNear = (point: { x: number; y: number }) =>
        map.queryRenderedFeatures(
          [
            [point.x - HIT_BUFFER_PX, point.y - HIT_BUFFER_PX],
            [point.x + HIT_BUFFER_PX, point.y + HIT_BUFFER_PX],
          ],
          { layers: ["spots-clusters", "spots-circles", "osm-pois-circles"] }
        );

      map.on("click", (e) => {
        const features = featuresNear(e.point);
        if (features.length === 0) return;

        // Pick the closest one in screen space.
        let best = features[0];
        let bestDist = Infinity;
        for (const f of features) {
          if (f.geometry.type !== "Point") continue;
          const [lng, lat] = f.geometry.coordinates as [number, number];
          const p = map.project([lng, lat]);
          const dx = p.x - e.point.x;
          const dy = p.y - e.point.y;
          const d = dx * dx + dy * dy;
          if (d < bestDist) {
            bestDist = d;
            best = f;
          }
        }

        const props = best.properties!;

        if (best.layer?.id === "spots-clusters") {
          // Zoom in until the cluster splits.
          const clusterId = props.cluster_id as number;
          const source = map.getSource("spots") as mapboxgl.GeoJSONSource;
          source.getClusterExpansionZoom(clusterId, (err, zoom) => {
            if (err || zoom == null || best.geometry.type !== "Point") return;
            const [lng, lat] = best.geometry.coordinates as [number, number];
            map.easeTo({ center: [lng, lat], zoom });
          });
          return;
        }

        if (best.layer?.id === "spots-circles") {
          const spot = spotsRef.current.find((s) => s.id === props.id);
          if (spot) onSelectSpotRef.current(spot);
        } else if (best.layer?.id === "osm-pois-circles") {
          const poi: OsmPoi = {
            id: props.id,
            lat: props.lat,
            lng: props.lng,
            name: props.name || null,
            type: props.type,
            address: props.address || null,
            openingHours: props.openingHours || null,
            tags: {},
          };
          onSelectOsmPoiRef.current(poi);
        }
      });

      // Cursor pointer on hover for clickable layers
      for (const layer of ["spots-clusters", "spots-circles", "osm-pois-circles"]) {
        map.on("mouseenter", layer, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layer, () => {
          map.getCanvas().style.cursor = "";
        });
      }

      // ---- Long-press / right-click → add a spot at the tapped point ----
      // Touch: 600ms hold with the finger near where it landed (≤14px in
      // screen space). Without a movement tolerance, normal finger jitter
      // would cancel the timer immediately on most iOS devices.
      // Desktop: contextmenu (right-click) for an instant equivalent.
      let pressTimer: ReturnType<typeof setTimeout> | null = null;
      let pressStart: { x: number; y: number } | null = null;
      const MOVE_TOLERANCE_PX = 14;

      const cancelPress = () => {
        if (pressTimer) {
          clearTimeout(pressTimer);
          pressTimer = null;
        }
        pressStart = null;
      };

      map.on("touchstart", (e) => {
        // Skip multi-touch (pinch zoom) and presses on existing markers.
        if (e.originalEvent.touches.length !== 1) return;
        if (featuresNear(e.point).length > 0) return;
        const lngLat = e.lngLat;
        pressStart = { x: e.point.x, y: e.point.y };
        pressTimer = setTimeout(() => {
          if (navigator.vibrate) navigator.vibrate(40);
          onLongPressRef.current(lngLat.lng, lngLat.lat);
          pressTimer = null;
          pressStart = null;
        }, 600);
      });

      map.on("touchmove", (e) => {
        if (!pressTimer || !pressStart) return;
        const dx = e.point.x - pressStart.x;
        const dy = e.point.y - pressStart.y;
        if (dx * dx + dy * dy > MOVE_TOLERANCE_PX * MOVE_TOLERANCE_PX) {
          cancelPress();
        }
      });

      map.on("touchend", cancelPress);
      map.on("touchcancel", cancelPress);

      map.on("contextmenu", (e) => {
        e.preventDefault();
        if (featuresNear(e.point).length > 0) return;
        onLongPressRef.current(e.lngLat.lng, e.lngLat.lat);
      });
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update OSM POIs GeoJSON when data changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource("osm-pois") as mapboxgl.GeoJSONSource | undefined;
    if (src) src.setData(osmGeoJson());
  }, [osmPois, osmGeoJson]);

  // Update FiberSpot spots GeoJSON when data changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource("spots") as mapboxgl.GeoJSONSource | undefined;
    if (src) src.setData(spotsGeoJson());
  }, [spots, spotsGeoJson]);

  // Fly to center when it changes. On mobile, when a spot is selected
  // the bottom sheet covers ~75% of the screen — pad the bottom so the
  // visual centre lands above the sheet, where the user can actually
  // see the pulsing marker.
  useEffect(() => {
    if (!mapRef.current) return;
    const isMobile =
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 600px)").matches;
    const padding =
      isMobile && selectedSpotId
        ? { top: 0, bottom: Math.round(window.innerHeight * 0.6), left: 0, right: 0 }
        : undefined;
    mapRef.current.flyTo({ center, zoom, duration: 1500, padding });
  }, [center, zoom, selectedSpotId]);

  // Pulse-ring on the currently-selected spot, so the side panel and
  // the dot on the map are visually linked.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    selectedMarkerRef.current?.remove();
    selectedMarkerRef.current = null;
    if (!selectedSpotId) return;
    const spot = spots.find((s) => s.id === selectedSpotId);
    if (!spot) return;
    const el = document.createElement("div");
    el.className = "selected-pulse";
    selectedMarkerRef.current = new mapboxgl.Marker({ element: el })
      .setLngLat([spot.lng, spot.lat])
      .addTo(map);
  }, [selectedSpotId, spots]);

  // User location blue dot
  useEffect(() => {
    if (!mapRef.current) return;

    if (userMarkerRef.current) {
      userMarkerRef.current.remove();
      userMarkerRef.current = null;
    }

    if (!userLocation) return;

    const el = document.createElement("div");
    el.className = "user-dot";

    userMarkerRef.current = new mapboxgl.Marker({ element: el })
      .setLngLat(userLocation)
      .addTo(mapRef.current);
  }, [userLocation]);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      <button className="recenter-btn" onClick={onRecenter} title="Back to my location">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="3 11 22 2 13 21 11 13 3 11" />
        </svg>
      </button>
    </div>
  );
}
