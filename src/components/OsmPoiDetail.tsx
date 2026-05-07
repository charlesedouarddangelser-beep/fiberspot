import type { OsmPoi } from "../types/osm";
import { typeIcon } from "../lib/spot-icons";

interface Props {
  poi: OsmPoi;
  onClose: () => void;
  onAdd: (poi: OsmPoi) => void;
}

export default function OsmPoiDetail({ poi, onClose, onAdd }: Props) {
  const displayName = poi.name || `Unnamed ${poi.type}`;
  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${poi.lat},${poi.lng}`;

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

      <div className="osm-no-data">
        <p>No speed data yet for this place</p>
      </div>

      <button className="btn-primary osm-add-btn" onClick={() => onAdd(poi)}>
        + Add as FiberSpot
      </button>

      <p className="osm-attribution">Data from OpenStreetMap</p>
    </div>
  );
}
