import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import Sidebar from "./components/Sidebar";

// Mapbox-gl + the Map component pull ~1.5 MB of JS, so we defer them
// until the rest of the shell is on screen. The Suspense fallback
// matches the basemap background to avoid a white flash.
const Map = lazy(() => import("./components/Map"));
import SpotDetail from "./components/SpotDetail";
import AddSpotForm from "./components/AddSpotForm";
import OsmPoiDetail from "./components/OsmPoiDetail";
import DonateModal from "./components/DonateModal";
import AuthControl from "./components/AuthControl";
import { supabase } from "./lib/supabase";
import { createSpot } from "./lib/api";
import { useToast } from "./lib/toast";
import { getUserLocation, haversineMeters } from "./lib/geo";
import { latLngToQuadkey } from "./lib/quadkey";
import type { Spot, SpotInsert } from "./types/spot";
import type { OsmPoi } from "./types/osm";

interface TileEstimate {
  avg_d_kbps: number;
  avg_u_kbps: number;
  avg_lat_ms: number;
}

export default function App() {
  const toast = useToast();
  const [spots, setSpots] = useState<Spot[]>([]);
  // Restore the last viewport so returning users land where they left
  // off, instead of staring at a generic world view (or worse, NYC).
  const initialView = (() => {
    try {
      const raw = localStorage.getItem("fiberspot.view.v1");
      if (!raw) return null;
      const v = JSON.parse(raw) as { lng?: unknown; lat?: unknown; zoom?: unknown };
      if (
        typeof v.lng === "number" &&
        typeof v.lat === "number" &&
        typeof v.zoom === "number"
      ) {
        return v as { lng: number; lat: number; zoom: number };
      }
      return null;
    } catch {
      return null;
    }
  })();

  const [center, setCenter] = useState<[number, number]>(
    initialView ? [initialView.lng, initialView.lat] : [0, 30]
  );
  const [zoom, setZoom] = useState(initialView ? initialView.zoom : 2);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [selected, setSelected] = useState<Spot | null>(null);
  const [selectedOsmPoi, setSelectedOsmPoi] = useState<OsmPoi | null>(null);
  const [osmPois, setOsmPois] = useState<OsmPoi[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [typeFilter, setTypeFilter] = useState("All");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [tileCache, setTileCache] = useState<Record<string, TileEstimate>>({});
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [noSpotPrompt, setNoSpotPrompt] = useState<{
    name: string;        // shown as the place line in the prompt
    lat: number;
    lng: number;
    address?: string;    // reverse-geocoded address — prefilled into the form's Address field
  } | null>(null);
  const [formPrefill, setFormPrefill] = useState<{ name: string; lat: number; lng: number; type?: string; address?: string } | null>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<number | null>(null);

  function onTouchStart(e: React.TouchEvent) {
    dragStart.current = e.touches[0].clientY;
    if (drawerRef.current) drawerRef.current.style.transition = "none";
  }

  function onTouchMove(e: React.TouchEvent) {
    if (dragStart.current === null || !drawerRef.current) return;
    const dy = e.touches[0].clientY - dragStart.current;
    if (sidebarOpen && dy > 0) {
      drawerRef.current.style.transform = `translateY(${dy}px)`;
    } else if (!sidebarOpen && dy < 0) {
      const drawerH = window.innerHeight * 0.75;
      const offset = Math.max(drawerH + dy, 0);
      drawerRef.current.style.transform = `translateY(${offset}px)`;
    }
  }

  function onTouchEnd(e: React.TouchEvent) {
    if (dragStart.current === null || !drawerRef.current) return;
    drawerRef.current.style.transition = "";
    drawerRef.current.style.transform = "";
    const dy = e.changedTouches[0].clientY - dragStart.current;
    if (sidebarOpen && dy > 80) setSidebarOpen(false);
    else if (!sidebarOpen && dy < -80) setSidebarOpen(true);
    dragStart.current = null;
  }

  // Save the current viewport on every change so the next visit can
  // pick up where the user left off.
  useEffect(() => {
    try {
      localStorage.setItem(
        "fiberspot.view.v1",
        JSON.stringify({ lng: center[0], lat: center[1], zoom })
      );
    } catch {
      // ignore quota / disabled storage
    }
  }, [center, zoom]);

  // First-run hint — fired once per device. Tells new users about the
  // long-press gesture they'd never discover on their own.
  useEffect(() => {
    const KEY = "fiberspot.onboarded.v1";
    if (localStorage.getItem(KEY)) return;
    const timer = setTimeout(() => {
      toast("👇 Long-press the map to drop a pin and add a spot", "info");
      localStorage.setItem(KEY, "1");
    }, 1500);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    fetchSpots();

    if (!navigator.geolocation) return;

    let centered = false;
    const applyPosition = (pos: GeolocationPosition) => {
      const loc: [number, number] = [pos.coords.longitude, pos.coords.latitude];
      setUserLocation(loc);
      if (!centered) {
        setCenter(loc);
        setZoom((z) => (z < 12 ? 14 : z));
        centered = true;
      }
    };

    // Two-stage acquisition:
    //   1. fast low-accuracy fix (cell tower / cached) so the list and
    //      map snap to "around you" within ~1s.
    //   2. high-accuracy watch upgrades the position as GPS locks and
    //      the user moves.
    navigator.geolocation.getCurrentPosition(
      applyPosition,
      (err) => {
        // Surface a clear cause when permission is denied so the user
        // understands why distances / nearby sort aren't available.
        if (err.code === err.PERMISSION_DENIED) {
          toast(
            "Location is off — distances and nearby sort won't work. Allow location in your browser to fix.",
            "info"
          );
        }
      },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 8000 }
    );

    const watchId = navigator.geolocation.watchPosition(
      applyPosition,
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [toast]);

  // ---- Deep-link URL routing for /spot/:id ----
  // Two pieces:
  // 1. On mount + on browser back/forward, read the URL and load the
  //    matching spot if any.
  // 2. Whenever `selected` changes, push the matching URL — but only if
  //    it actually differs from the current location (so loading from
  //    /spot/:id doesn't immediately push a duplicate entry).
  useEffect(() => {
    const matchSpotPath = (path: string) => {
      const m = path.match(/^\/spot\/([\w-]{10,100})$/);
      return m ? m[1] : null;
    };

    const loadSpotFromPath = async (path: string) => {
      const id = matchSpotPath(path);
      if (!id) {
        setSelected(null);
        return;
      }
      const { data, error } = await supabase
        .from("spots")
        .select("*")
        .eq("id", id)
        .single();
      if (error || !data) {
        // Bad URL — quietly send the user back to root.
        window.history.replaceState({}, "", "/");
        setSelected(null);
        return;
      }
      const spot = data as Spot;
      setSelected(spot);
      setSelectedOsmPoi(null);
      setShowForm(false);
      setNoSpotPrompt(null);
      setSidebarOpen(false);
      setCenter([spot.lng, spot.lat]);
      setZoom(15);
    };

    loadSpotFromPath(window.location.pathname);

    const onPop = () => loadSpotFromPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const path = selected ? `/spot/${selected.id}` : "/";
    if (window.location.pathname !== path) {
      window.history.pushState({}, "", path);
    }
  }, [selected]);

  async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
    try {
      const token = import.meta.env.VITE_MAPBOX_TOKEN;
      const res = await fetch(
        `https://api.mapbox.com/search/geocode/v6/reverse?longitude=${lng}&latitude=${lat}&access_token=${token}`
      );
      if (!res.ok) return null;
      const data = await res.json();
      const feat = data.features?.[0];
      if (!feat) return null;
      return feat.properties?.full_address || feat.properties?.name || null;
    } catch {
      return null;
    }
  }

  async function fetchSpots() {
    const { data } = await supabase
      .from("spots")
      .select("*")
      .order("created_at", { ascending: false });
    if (data) setSpots(data as Spot[]);
  }

  async function addSpot(spot: SpotInsert) {
    try {
      await createSpot(spot);
    } catch (e) {
      toast((e as Error).message || "Failed to save the spot", "error");
      return;
    }
    await fetchSpots();
    setShowForm(false);
    toast("Spot added", "success");
  }

  // Fetch Ookla tile estimate for a spot
  async function getTileEstimate(spot: Spot): Promise<TileEstimate | null> {
    const qk = latLngToQuadkey(spot.lat, spot.lng, 16);
    if (tileCache[qk]) return tileCache[qk];

    const { data } = await supabase
      .from("speed_tiles")
      .select("avg_d_kbps, avg_u_kbps, avg_lat_ms")
      .eq("quadkey", qk)
      .single();

    if (data) {
      setTileCache((prev) => ({ ...prev, [qk]: data }));
      return data;
    }
    return null;
  }

  const handleAddNew = useCallback(async () => {
    setSelected(null);
    setSelectedOsmPoi(null);
    setNoSpotPrompt(null);
    setSidebarOpen(false);
    if (userLocation) {
      const [lng, lat] = userLocation;
      const addr = await reverseGeocode(lat, lng);
      setFormPrefill({ name: "", lat, lng, address: addr ?? undefined });
    } else {
      setFormPrefill(null);
    }
    setShowForm(true);
  }, [userLocation]);

  const handleSelectSpot = useCallback((spot: Spot) => {
    setSelected(spot);
    setSelectedOsmPoi(null);
    setShowForm(false);
    setNoSpotPrompt(null);
    setSidebarOpen(false);
    setCenter([spot.lng, spot.lat]);
    setZoom(15);
  }, []);

  const handleSelectOsmPoi = useCallback((poi: OsmPoi) => {
    setSelectedOsmPoi(poi);
    setSelected(null);
    setShowForm(false);
    setNoSpotPrompt(null);
    setSidebarOpen(false);
    setCenter([poi.lng, poi.lat]);
    setZoom(16);
  }, []);

  const handleAddOsmPoi = useCallback((poi: OsmPoi) => {
    setFormPrefill({
      name: poi.name || "",
      lat: poi.lat,
      lng: poi.lng,
      type: poi.type,
    });
    setShowForm(true);
    setSelectedOsmPoi(null);
  }, []);

  const handleMapLongPress = useCallback(async (lng: number, lat: number) => {
    // If there's already a spot within 50m, surface it instead of starting
    // a new one — long-pressing right next to an existing marker most
    // likely means "I want THAT spot, my finger missed".
    let nearest: Spot | null = null;
    let nearestDist = Infinity;
    for (const s of spots) {
      const d = haversineMeters(lat, lng, s.lat, s.lng);
      if (d <= 50 && d < nearestDist) {
        nearest = s;
        nearestDist = d;
      }
    }
    if (nearest) {
      setSelected(nearest);
      setSelectedOsmPoi(null);
      setShowForm(false);
      setNoSpotPrompt(null);
      setSidebarOpen(false);
      setCenter([nearest.lng, nearest.lat]);
      setZoom(15);
      return;
    }

    setSelected(null);
    setSelectedOsmPoi(null);
    setShowForm(false);
    setSidebarOpen(false);
    setCenter([lng, lat]);

    // Reverse-geocode to show the address in the prompt and pass it
    // through to the form's Address field. The Name field stays empty
    // — an address isn't a name, the user picks one.
    const addr = await reverseGeocode(lat, lng);
    setNoSpotPrompt({
      name: addr ?? "this location",
      lat,
      lng,
      address: addr ?? undefined,
    });
  }, [spots]);

  const handleSearchSelect = useCallback((center: [number, number], placeName: string) => {
    const [lng, lat] = center;
    setCenter(center);
    setZoom(15);
    setSidebarOpen(false);
    setNoSpotPrompt(null);
    setSelectedOsmPoi(null);

    // Find nearest spot within 100m
    let nearest: Spot | null = null;
    let nearestDist = Infinity;
    for (const s of spots) {
      const d = haversineMeters(lat, lng, s.lat, s.lng);
      if (d <= 100 && d < nearestDist) {
        nearest = s;
        nearestDist = d;
      }
    }

    if (nearest) {
      setSelected(nearest);
      setShowForm(false);
    } else {
      setSelected(null);
      setShowForm(false);
      setNoSpotPrompt({ name: placeName, lat, lng });
    }
  }, [spots]);

  return (
    <div className="app">
      <div
        ref={drawerRef}
        className={`sidebar-wrapper ${sidebarOpen ? "open" : ""}`}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <Sidebar
          spots={spots}
          osmPois={osmPois}
          userLocation={userLocation}
          onSelect={handleSelectSpot}
          onSelectOsmPoi={handleSelectOsmPoi}
          typeFilter={typeFilter}
          onTypeFilterChange={setTypeFilter}
          tagFilter={tagFilter}
          onTagFilterChange={setTagFilter}
          onAddNew={handleAddNew}
          onFlyTo={(c) => { setCenter(c); setZoom(13); }}
          onSearchSelect={handleSearchSelect}
        />
      </div>
      {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}
      <main className="map-container">
        <Suspense fallback={<div className="map-skeleton">Loading map…</div>}>
        <Map
          spots={spots}
          center={center}
          zoom={zoom}
          userLocation={userLocation}
          onSelectSpot={handleSelectSpot}
          onSelectOsmPoi={handleSelectOsmPoi}
          onRecenter={async () => {
            try {
              const pos = await getUserLocation();
              setUserLocation([pos.lng, pos.lat]);
              setCenter([pos.lng, pos.lat]);
              setZoom(15);
            } catch {
              toast("Could not get your location. Please enable GPS.", "error");
            }
          }}
          onLongPress={handleMapLongPress}
          onOsmPoisChange={setOsmPois}
          typeFilter={typeFilter}
          selectedSpotId={selected?.id ?? null}
        />
        </Suspense>
        <button className="mobile-toggle" onClick={() => setSidebarOpen((v) => !v)}>
          {sidebarOpen ? "✕" : "☰"} Spots
          {!sidebarOpen && spots.length > 0 && (
            <span className="mobile-toggle-count">{spots.length}</span>
          )}
        </button>
        <AuthControl />
        <DonateModal />
      </main>
      {selected && !showForm && !selectedOsmPoi && (
        <SpotDetail
          spot={selected}
          onClose={() => setSelected(null)}
          onUpdated={async () => {
            const { data } = await supabase
              .from("spots")
              .select("*")
              .order("created_at", { ascending: false });
            if (data) {
              const updated = data as Spot[];
              setSpots(updated);
              const refreshed = updated.find((s) => s.id === selected.id);
              if (refreshed) setSelected(refreshed);
            }
          }}
          getTileEstimate={getTileEstimate}
          onTagClick={(tag) => {
            setTagFilter(tag);
            setSidebarOpen(true);
          }}
        />
      )}
      {selectedOsmPoi && !showForm && (
        <OsmPoiDetail
          poi={selectedOsmPoi}
          onClose={() => setSelectedOsmPoi(null)}
          onAdd={handleAddOsmPoi}
        />
      )}
      {noSpotPrompt && !showForm && !selected && !selectedOsmPoi && (
        <>
          <div
            className="prompt-backdrop"
            onClick={() => setNoSpotPrompt(null)}
            aria-hidden
          />
          <div className="no-spot-prompt" role="dialog">
            <div className="no-spot-prompt-text">
              <p className="no-spot-prompt-title">Add a spot here?</p>
              <p className="no-spot-prompt-place" title={noSpotPrompt.name}>
                {noSpotPrompt.name}
              </p>
            </div>
            <div className="no-spot-prompt-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setNoSpotPrompt(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  // If we reverse-geocoded an address (long-press flow),
                  // route it to the Address field and leave Name empty
                  // for the user to fill. If the prompt came from a
                  // POI search, the name itself is meaningful — keep it.
                  const fromAddress = !!noSpotPrompt.address;
                  setFormPrefill({
                    name: fromAddress ? "" : noSpotPrompt.name,
                    lat: noSpotPrompt.lat,
                    lng: noSpotPrompt.lng,
                    address: noSpotPrompt.address,
                  });
                  setShowForm(true);
                  setNoSpotPrompt(null);
                }}
              >
                + Add
              </button>
            </div>
          </div>
        </>
      )}
      {showForm && (
        <AddSpotForm
          onSubmit={addSpot}
          onCancel={() => { setShowForm(false); setFormPrefill(null); }}
          userLocation={userLocation}
          initialName={formPrefill?.name}
          initialLat={formPrefill?.lat}
          initialLng={formPrefill?.lng}
          initialType={formPrefill?.type}
          initialAddress={formPrefill?.address}
        />
      )}
    </div>
  );
}
