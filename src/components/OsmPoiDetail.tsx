import { useEffect, useState } from "react";
import type { OsmPoi } from "../types/osm";
import { typeIcon } from "../lib/spot-icons";

interface TileEstimate {
  avg_d_kbps: number;
  avg_u_kbps: number;
  avg_lat_ms: number;
}

interface FiberCommune {
  insee_com: string;
  commune_name: string;
  locaux_total: number | null;
  locaux_ftth: number | null;
  taux_deploiement: number | null;
  operateur_majoritaire: string | null;
  zonage: string | null;
  updated_at: string;
}

// Minimum spot shape both lookup functions accept. We don't have a
// real Spot for an OSM POI, so we synthesise one with just the
// fields the helpers read.
interface PoiAsSpot {
  id: string;
  lat: number;
  lng: number;
}

interface Props {
  poi: OsmPoi;
  onClose: () => void;
  onAdd: (poi: OsmPoi) => void;
  getTileEstimate: (spot: PoiAsSpot) => Promise<TileEstimate | null>;
  getFiberCommune: (spot: PoiAsSpot) => Promise<FiberCommune | null>;
}

export default function OsmPoiDetail({ poi, onClose, onAdd, getTileEstimate, getFiberCommune }: Props) {
  const displayName = poi.name || `Unnamed ${poi.type}`;
  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${poi.lat},${poi.lng}`;

  const [estimate, setEstimate] = useState<TileEstimate | null>(null);
  const [fiber, setFiber] = useState<FiberCommune | null>(null);

  useEffect(() => {
    setEstimate(null);
    setFiber(null);
    const stub: PoiAsSpot = { id: poi.id, lat: poi.lat, lng: poi.lng };
    getTileEstimate(stub).then(setEstimate);
    getFiberCommune(stub).then(setFiber);
  }, [poi.id, poi.lat, poi.lng, getTileEstimate, getFiberCommune]);

  const dl = estimate ? Math.round(estimate.avg_d_kbps / 1000) : null;
  const ul = estimate ? Math.round(estimate.avg_u_kbps / 1000) : null;
  const ping = estimate ? Math.round(estimate.avg_lat_ms) : null;

  return (
    <div className="detail-panel osm-detail-panel">
      <div className="detail-header">
        <div>
          <h2>{displayName}</h2>
          <span className="spot-type osm-type-badge">{typeIcon(poi.type)} {poi.type}</span>
        </div>
        <button className="close-btn" onClick={onClose}>✕</button>
      </div>

      {poi.address && (
        <p className="osm-address">{poi.address}</p>
      )}

      <a
        href={directionsUrl}
        target="_blank"
        rel="noreferrer"
        className="get-directions"
      >
        Get directions →
      </a>

      {poi.openingHours && (
        <p className="osm-hours">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: "middle", marginRight: 4 }}>
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          {poi.openingHours}
        </p>
      )}

      {fiber && fiber.taux_deploiement !== null && (() => {
        const pct = fiber.taux_deploiement;
        const tier =
          pct >= 0.9 ? "fiber-tier-full" :
          pct >= 0.5 ? "fiber-tier-partial" :
          "fiber-tier-low";
        const label =
          pct >= 0.9 ? "Fibre disponible" :
          pct >= 0.5 ? "Fibre partielle" :
          "Fibre limitée";
        return (
          <div className={`fiber-badge ${tier}`}>
            <div className="fiber-badge-row">
              <span className="fiber-badge-label">📡 {label}</span>
              <span className="fiber-badge-pct">{Math.round(pct * 100)}%</span>
            </div>
            <div className="fiber-badge-meta">
              {fiber.commune_name}
              {fiber.locaux_ftth !== null && fiber.locaux_total !== null
                ? ` · ${fiber.locaux_ftth.toLocaleString()} / ${fiber.locaux_total.toLocaleString()} locaux`
                : ""}
              {fiber.operateur_majoritaire && ` · ${fiber.operateur_majoritaire}`}
              {fiber.zonage && ` · ${fiber.zonage}`}
            </div>
            <div className="fiber-badge-source">Source: Arcep · commune {fiber.insee_com}</div>
          </div>
        );
      })()}

      {estimate && dl !== null && (
        <div className="osm-estimate">
          <p className="osm-estimate-label">Ookla area estimate</p>
          <div className="osm-estimate-row">
            <span className="osm-estimate-item dl">↓ {dl} Mbps</span>
            <span className="osm-estimate-item ul">↑ {ul} Mbps</span>
            <span className="osm-estimate-item ping">{ping} ms</span>
          </div>
          <p className="osm-estimate-source">Aggregate from Ookla open data for this area</p>
        </div>
      )}

      {!estimate && !fiber && (
        <div className="osm-no-data">
          <p>No coverage data yet for this place</p>
        </div>
      )}

      <button className="btn-primary osm-add-btn" onClick={() => onAdd(poi)}>
        + Add as FiberSpot
      </button>

      <p className="osm-attribution">Place data from Mapbox / OpenStreetMap</p>
    </div>
  );
}
