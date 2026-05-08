import { useEffect, useMemo, useState } from "react";
import type { Spot } from "../types/spot";
import type { OsmPoi } from "../types/osm";
import { haversineMeters } from "../lib/geo";
import GeocodingSearch from "./GeocodingSearch";
import { typeIcon } from "../lib/spot-icons";

// Persisted filter state — keyed by version so future incompatible
// shapes can be invalidated.
const FILTERS_STORAGE_KEY = "fiberspot.filters.v1";

function readPersistedFilters(): { nearMe: boolean; nameFilter: string } | null {
  try {
    const raw = localStorage.getItem(FILTERS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { nearMe?: unknown; nameFilter?: unknown };
    return {
      nearMe: typeof parsed.nearMe === "boolean" ? parsed.nearMe : false,
      nameFilter: typeof parsed.nameFilter === "string" ? parsed.nameFilter : "",
    };
  } catch {
    return null;
  }
}

const TYPES = ["All", "Cafe", "Library", "Coworking", "Hotel", "Restaurant", "Park", "Other"];
const NEAR_ME_RADIUS = 500; // meters
const OSM_RADIUS = 1500;    // include OSM POIs within this far of user
const OSM_LIST_CAP = 30;    // soft cap to keep the list readable

type ListItem =
  | { kind: "spot"; spot: Spot; dist: number | null; sortKey: string }
  | { kind: "osm"; poi: OsmPoi; dist: number | null; sortKey: string };

interface Props {
  spots: Spot[];
  osmPois: OsmPoi[];
  userLocation: [number, number] | null;
  typeFilter: string;
  onTypeFilterChange: (next: string) => void;
  tagFilter: string | null;
  onTagFilterChange: (next: string | null) => void;
  onSelect: (spot: Spot) => void;
  onSelectOsmPoi: (poi: OsmPoi) => void;
  onAddNew: () => void;
  onFlyTo: (center: [number, number]) => void;
  onSearchSelect: (center: [number, number], placeName: string) => void;
}

function pinColor(download: number | null): string {
  if (download === null) return "#e4e4e7"; // off-white — untested
  if (download >= 50) return "#22c55e";    // green — fast
  if (download >= 20) return "#f59e0b";    // orange — medium
  return "#ef4444";                         // red — slow
}

function formatDist(m: number): string {
  if (m < 1000) return `${Math.round(m)}m`;
  return `${(m / 1000).toFixed(1)}km`;
}

function formatRelativeTime(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.round(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(mo / 12)}y ago`;
}

export default function Sidebar({
  spots,
  osmPois,
  userLocation,
  typeFilter,
  onTypeFilterChange,
  tagFilter,
  onTagFilterChange,
  onSelect,
  onSelectOsmPoi,
  onAddNew,
  onFlyTo: _onFlyTo,
  onSearchSelect,
}: Props) {
  void _onFlyTo;
  const persisted = useMemo(() => readPersistedFilters(), []);
  const [nameFilter, setNameFilter] = useState<string>(persisted?.nameFilter ?? "");
  const [nearMe, setNearMe] = useState<boolean>(persisted?.nearMe ?? false);

  // Persist filters whenever they change.
  useEffect(() => {
    try {
      localStorage.setItem(
        FILTERS_STORAGE_KEY,
        JSON.stringify({ nameFilter, nearMe })
      );
    } catch {
      // ignore quota / disabled storage
    }
  }, [nameFilter, nearMe]);

  // Build a unified list: user-spots always; OSM POIs only when we have
  // a user location (otherwise distance is meaningless and the cap
  // becomes random).
  const items = useMemo<ListItem[]>(() => {
    const out: ListItem[] = [];
    const loc = userLocation;
    const distOf = (lat: number, lng: number) =>
      loc ? haversineMeters(loc[1], loc[0], lat, lng) : null;

    for (const s of spots) {
      out.push({
        kind: "spot",
        spot: s,
        dist: distOf(s.lat, s.lng),
        sortKey: s.name.toLowerCase(),
      });
    }
    if (loc) {
      const nearby = osmPois
        .map((p) => ({ poi: p, dist: distOf(p.lat, p.lng)! }))
        .filter((x) => x.dist <= OSM_RADIUS)
        .sort((a, b) => a.dist - b.dist)
        .slice(0, OSM_LIST_CAP);
      for (const { poi, dist } of nearby) {
        out.push({
          kind: "osm",
          poi,
          dist,
          sortKey: (poi.name ?? poi.type).toLowerCase(),
        });
      }
    }
    return out;
  }, [spots, osmPois, userLocation]);

  const filtered = useMemo(() => {
    let list = items;

    if (nameFilter) {
      const q = nameFilter.toLowerCase();
      list = list.filter((it) => {
        const n = it.kind === "spot" ? it.spot.name : (it.poi.name ?? "");
        return n.toLowerCase().includes(q);
      });
    }

    if (typeFilter !== "All") {
      list = list.filter((it) => {
        const t = it.kind === "spot" ? it.spot.type : it.poi.type;
        return t === typeFilter;
      });
    }

    if (tagFilter) {
      list = list.filter((it) => {
        if (it.kind !== "spot") return false;  // OSM POIs don't have tags
        return it.spot.tags?.includes(tagFilter) ?? false;
      });
    }

    if (nearMe && userLocation) {
      list = list.filter((it) => it.dist !== null && it.dist <= NEAR_ME_RADIUS);
    }

    if (userLocation) {
      list = [...list].sort((a, b) => (a.dist ?? Infinity) - (b.dist ?? Infinity));
    } else {
      list = [...list].sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    }

    return list;
  }, [items, nameFilter, typeFilter, tagFilter, nearMe, userLocation]);

  return (
    <aside className="sidebar">
      <div className="drawer-handle"><span /></div>
      <div className="sidebar-header">
        <h1 className="logo">FiberSpot</h1>
        <button className="btn-primary" onClick={onAddNew}>+ Add Spot</button>
      </div>

      <GeocodingSearch onSelect={(c, name) => onSearchSelect(c, name)} userLocation={userLocation} />

      <div className="filter-row">
        <input
          className="name-filter"
          type="text"
          placeholder="Filter by name..."
          value={nameFilter}
          onChange={(e) => setNameFilter(e.target.value)}
        />
        {nameFilter && (
          <button
            type="button"
            className="name-filter-clear"
            onClick={() => setNameFilter("")}
            aria-label="Clear filter"
          >
            ✕
          </button>
        )}
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
            onClick={() => onTypeFilterChange(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {tagFilter && (
        <div className="active-tag-filter">
          <span>Filtering by tag</span>
          <button type="button" className="active-tag-chip" onClick={() => onTagFilterChange(null)}>
            #{tagFilter} ✕
          </button>
        </div>
      )}

      <div className="speed-legend" aria-hidden>
        <span className="speed-legend-item"><span className="legend-dot" style={{ background: "#22c55e" }} /> ≥50</span>
        <span className="speed-legend-item"><span className="legend-dot" style={{ background: "#f59e0b" }} /> 20–49</span>
        <span className="speed-legend-item"><span className="legend-dot" style={{ background: "#ef4444" }} /> &lt;20 Mbps</span>
        <span className="speed-legend-item"><span className="legend-dot" style={{ background: "#e4e4e7" }} /> untested</span>
      </div>

      <div className="spot-list">
        {filtered.length === 0 && (
          <div className="empty">
            {nameFilter ? (
              <>
                <p>No spot matches “{nameFilter}”.</p>
                <button type="button" className="btn-link" onClick={() => setNameFilter("")}>Clear filter</button>
              </>
            ) : nearMe ? (
              <>
                <p>No spots within 500m yet.</p>
                <p className="empty-hint">Long-press the map to drop a pin and add one.</p>
              </>
            ) : typeFilter !== "All" ? (
              <p>No {typeFilter.toLowerCase()} in this area yet — long-press the map to add one.</p>
            ) : userLocation ? (
              <>
                <p>No spots tested here yet.</p>
                <p className="empty-hint">Be the first — long-press the map to drop a pin.</p>
              </>
            ) : (
              <p>Loading spots near you…</p>
            )}
          </div>
        )}
        {filtered.map((it) =>
          it.kind === "spot" ? (
            <div
              key={`spot:${it.spot.id}`}
              className="spot-card"
              onClick={() => onSelect(it.spot)}
            >
              <div className="spot-card-header">
                <span
                  className="spot-dot"
                  style={{ background: pinColor(it.spot.avg_download) }}
                />
                <strong>{it.spot.name}</strong>
                {it.dist !== null && (
                  <span className="spot-dist">{formatDist(it.dist)}</span>
                )}
              </div>
              <span className="spot-type">{typeIcon(it.spot.type)} {it.spot.type}</span>
              {it.spot.avg_download !== null ? (
                <>
                  <span className="spot-speed-row">
                    <span className="spot-speed-item dl">↓{it.spot.avg_download}</span>
                    <span className="spot-speed-item ul">↑{it.spot.avg_upload ?? "–"}</span>
                    <span className="spot-speed-item ping">{it.spot.avg_ping ?? "–"}ms</span>
                  </span>
                  {it.spot.last_tested_at && (
                    <span className="spot-tested-at">Tested {formatRelativeTime(it.spot.last_tested_at)}</span>
                  )}
                </>
              ) : (
                <span className="spot-speed untested">Not yet tested</span>
              )}
            </div>
          ) : (
            <div
              key={`osm:${it.poi.id}`}
              className="spot-card osm-card"
              onClick={() => onSelectOsmPoi(it.poi)}
            >
              <div className="spot-card-header">
                <span className="spot-dot osm-dot" />
                <strong>{it.poi.name ?? `Unnamed ${it.poi.type}`}</strong>
                {it.dist !== null && (
                  <span className="spot-dist">{formatDist(it.dist)}</span>
                )}
              </div>
              <span className="spot-type">{typeIcon(it.poi.type)} {it.poi.type}</span>
              <span className="spot-speed osm-hint">+ Tap to add &amp; test</span>
            </div>
          )
        )}
      </div>
    </aside>
  );
}
