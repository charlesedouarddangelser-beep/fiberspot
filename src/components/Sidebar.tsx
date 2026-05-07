import { useMemo, useState } from "react";
import type { Spot } from "../types/spot";
import { haversineMeters } from "../lib/geo";
import GeocodingSearch from "./GeocodingSearch";

const TYPES = ["All", "Cafe", "Library", "Coworking", "Hotel", "Restaurant", "Park", "Other"];
const NEAR_ME_RADIUS = 500; // meters

interface Props {
  spots: Spot[];
  userLocation: [number, number] | null;
  onSelect: (spot: Spot) => void;
  onAddNew: () => void;
  onFlyTo: (center: [number, number]) => void;
  onSearchSelect: (center: [number, number], placeName: string) => void;
}

function pinColor(download: number | null): string {
  if (download === null) return "#00994d";
  if (download >= 50) return "#00ff41";
  if (download >= 20) return "#39ff14";
  return "#ff3131";
}

function formatDist(m: number): string {
  if (m < 1000) return `${Math.round(m)}m`;
  return `${(m / 1000).toFixed(1)}km`;
}

export default function Sidebar({ spots, userLocation, onSelect, onAddNew, onFlyTo: _onFlyTo, onSearchSelect }: Props) {
  void _onFlyTo;
  const [nameFilter, setNameFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");
  const [nearMe, setNearMe] = useState(false);

  // Pre-compute distances once when spots or userLocation change
  const spotsWithDist = useMemo(() => {
    if (!userLocation) return spots.map((s) => ({ spot: s, dist: null as number | null }));
    const [lng, lat] = userLocation;
    return spots.map((s) => ({
      spot: s,
      dist: haversineMeters(lat, lng, s.lat, s.lng),
    }));
  }, [spots, userLocation]);

  const filtered = useMemo(() => {
    let list = spotsWithDist;

    // Name filter
    if (nameFilter) {
      const q = nameFilter.toLowerCase();
      list = list.filter((e) => e.spot.name.toLowerCase().includes(q));
    }

    // Type filter
    if (typeFilter !== "All") {
      list = list.filter((e) => e.spot.type === typeFilter);
    }

    // Near me — restrict to radius
    if (nearMe && userLocation) {
      list = list.filter((e) => e.dist !== null && e.dist <= NEAR_ME_RADIUS);
    }

    // Sort: by distance if we have location, otherwise alphabetical
    if (userLocation) {
      list = [...list].sort((a, b) => (a.dist ?? Infinity) - (b.dist ?? Infinity));
    } else {
      list = [...list].sort((a, b) => a.spot.name.localeCompare(b.spot.name));
    }

    return list;
  }, [spotsWithDist, nameFilter, typeFilter, nearMe, userLocation]);

  return (
    <aside className="sidebar">
      <div className="drawer-handle"><span /></div>
      <div className="sidebar-header">
        <h1 className="logo">FiberSpot</h1>
        <button className="btn-primary" onClick={onAddNew}>+ Add Spot</button>
      </div>

      <GeocodingSearch onSelect={(c, name) => onSearchSelect(c, name)} userLocation={userLocation} />

      <div className="filter-row hide-mobile">
        <input
          className="name-filter"
          type="text"
          placeholder="Filter by name..."
          value={nameFilter}
          onChange={(e) => setNameFilter(e.target.value)}
        />
      </div>

      <div className="near-me-row">
        <button
          className={`near-me-toggle ${nearMe ? "active" : ""}`}
          onClick={() => setNearMe((v) => !v)}
          disabled={!userLocation}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
          </svg>
          {nearMe ? "Near me" : "All spots"}
        </button>
        {nearMe && (
          <span className="near-me-hint">Within {NEAR_ME_RADIUS}m</span>
        )}
      </div>

      <div className="type-filters">
        {TYPES.map((t) => (
          <button
            key={t}
            className={`filter-chip ${typeFilter === t ? "active" : ""}`}
            onClick={() => setTypeFilter(t)}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="spot-list">
        {filtered.length === 0 && (
          <p className="empty">
            {nearMe ? "No spots within 500m — try moving closer" : "No spots found"}
          </p>
        )}
        {filtered.map(({ spot, dist }) => (
          <div key={spot.id} className="spot-card" onClick={() => onSelect(spot)}>
            <div className="spot-card-header">
              <span
                className="spot-dot"
                style={{ background: pinColor(spot.avg_download) }}
              />
              <strong>{spot.name}</strong>
              {dist !== null && (
                <span className="spot-dist">{formatDist(dist)}</span>
              )}
            </div>
            <span className="spot-type">{spot.type}</span>
            {spot.avg_download !== null ? (
              <span className="spot-speed-row">
                <span className="spot-speed-item dl">↓{spot.avg_download}</span>
                <span className="spot-speed-item ul">↑{spot.avg_upload ?? "–"}</span>
                <span className="spot-speed-item ping">{spot.avg_ping ?? "–"}ms</span>
              </span>
            ) : (
              <span className="spot-speed untested">Not yet tested</span>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}
