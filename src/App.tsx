import { useCallback, useEffect, useRef, useState } from "react";
import Map from "./components/Map";
import Sidebar from "./components/Sidebar";
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
  const [center, setCenter] = useState<[number, number]>([-73.985, 40.748]);
  const [zoom, setZoom] = useState(13);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [selected, setSelected] = useState<Spot | null>(null);
  const [selectedOsmPoi, setSelectedOsmPoi] = useState<OsmPoi | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [tileCache, setTileCache] = useState<Record<string, TileEstimate>>({});
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [noSpotPrompt, setNoSpotPrompt] = useState<{ name: string; lat: number; lng: number } | null>(null);
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

  useEffect(() => {
    fetchSpots();

    if (!navigator.geolocation) return;

    // Get initial position fast, then watch for movement
    let centered = false;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const loc: [number, number] = [pos.coords.longitude, pos.coords.latitude];
        setUserLocation(loc);
        if (!centered) {
          setCenter(loc);
          centered = true;
        }
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

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
          userLocation={userLocation}
          onSelect={handleSelectSpot}
          onAddNew={async () => {
            setSelected(null); setSelectedOsmPoi(null); setNoSpotPrompt(null); setSidebarOpen(false);
            if (userLocation) {
              const [lng, lat] = userLocation;
              const addr = await reverseGeocode(lat, lng);
              setFormPrefill({ name: "", lat, lng, address: addr ?? undefined });
            } else {
              setFormPrefill(null);
            }
            setShowForm(true);
          }}
          onFlyTo={(c) => { setCenter(c); setZoom(13); }}
          onSearchSelect={handleSearchSelect}
        />
      </div>
      {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}
      <main className="map-container">
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
        />
        <button className="mobile-toggle" onClick={() => setSidebarOpen((v) => !v)}>
          {sidebarOpen ? "✕" : "☰"} Spots
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
        <div className="no-spot-prompt">
          <p>No spot here yet — add it?</p>
          <button
            className="btn-primary"
            onClick={() => {
              setFormPrefill(noSpotPrompt);
              setShowForm(true);
              setNoSpotPrompt(null);
            }}
          >
            + Add "{noSpotPrompt.name}"
          </button>
          <button className="no-spot-dismiss" onClick={() => setNoSpotPrompt(null)}>✕</button>
        </div>
      )}
      {showForm && (
        <AddSpotForm
          onSubmit={addSpot}
          onCancel={() => { setShowForm(false); setFormPrefill(null); }}
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
