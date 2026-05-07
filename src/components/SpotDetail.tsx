import { useEffect, useState } from "react";
import type { Spot } from "../types/spot";
import { runSpeedTest } from "../lib/speedtest";
import { getUserLocation, haversineMeters } from "../lib/geo";
import { submitSpeedtest, deleteSpot } from "../lib/api";
import { useToast } from "../lib/toast";
import { useAuth } from "../lib/auth";
import SpeedHistory from "./SpeedHistory";
import EditSpotForm from "./EditSpotForm";

interface TileEstimate {
  avg_d_kbps: number;
  avg_u_kbps: number;
  avg_lat_ms: number;
}

interface Props {
  spot: Spot;
  onClose: () => void;
  onUpdated: () => void;
  getTileEstimate: (spot: Spot) => Promise<TileEstimate | null>;
}

const MAX_DISTANCE = 200; // meters

function formatTestedAt(date: string): string {
  const d = new Date(date);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  }) + " at " + d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)}m away`;
  return `${(m / 1000).toFixed(1)}km away`;
}

function Bar({ label, value, max, unit, color, estimated }: {
  label: string; value: number | null; max: number; unit: string; color: string; estimated?: boolean;
}) {
  const pct = value !== null ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="stat-bar">
      <div className="stat-bar-label">
        <span>{label}</span>
        <span className={estimated ? "estimated-value" : ""}>
          {value !== null ? `${estimated ? "~" : ""}${value} ${unit}` : "N/A"}
        </span>
      </div>
      <div className="stat-bar-track">
        <div
          className={`stat-bar-fill ${estimated ? "estimated-fill" : ""}`}
          style={{ width: `${pct}%`, background: estimated ? undefined : color }}
        />
      </div>
    </div>
  );
}

const hasSpeedData = (spot: Spot) =>
  spot.avg_download !== null || spot.avg_upload !== null || spot.avg_ping !== null;

export default function SpotDetail({ spot, onClose, onUpdated, getTileEstimate }: Props) {
  const toast = useToast();
  const { user } = useAuth();
  const [testing, setTesting] = useState(false);
  const [phase, setPhase] = useState("");
  const [estimate, setEstimate] = useState<TileEstimate | null>(null);
  const [distance, setDistance] = useState<number | null>(null);
  const [tooFarMsg, setTooFarMsg] = useState("");
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isOwner = !!user && !!spot.author_id && user.id === spot.author_id;

  async function handleDelete() {
    if (!confirm(`Delete "${spot.name}"? This can't be undone.`)) return;
    setDeleting(true);
    try {
      await deleteSpot(spot.id);
      toast("Spot deleted", "info");
      onUpdated();
      onClose();
    } catch (e) {
      toast((e as Error).message || "Failed to delete", "error");
      setDeleting(false);
    }
  }

  // Check distance on spot change
  useEffect(() => {
    setEstimate(null);
    setDistance(null);
    setTooFarMsg("");

    if (!hasSpeedData(spot)) {
      getTileEstimate(spot).then(setEstimate);
    }

    getUserLocation()
      .then((pos) => {
        const d = haversineMeters(pos.lat, pos.lng, spot.lat, spot.lng);
        setDistance(d);
      })
      .catch(() => {
        // geolocation unavailable — distance stays null
      });
  }, [spot]);

  async function handleTest() {
    setTesting(true);
    setTooFarMsg("");

    // Fresh location check before testing — kept locally so we can pass
    // it to the server-side speedtest endpoint (which re-checks the gate).
    let userPos: { lat: number; lng: number };
    try {
      setPhase("Checking location...");
      userPos = await getUserLocation();
      const d = haversineMeters(userPos.lat, userPos.lng, spot.lat, spot.lng);
      setDistance(d);

      if (d > MAX_DISTANCE) {
        setTooFarMsg(
          `You need to be at this location to test it — you're ${formatDistance(d)}, get closer and try again`
        );
        setTesting(false);
        setPhase("");
        return;
      }
    } catch {
      setTooFarMsg("Could not verify your location. Please enable GPS and try again.");
      setTesting(false);
      setPhase("");
      return;
    }

    try {
      setPhase("Measuring ping...");
      const timerId = setTimeout(() => setPhase("Measuring download..."), 2000);
      const timerId2 = setTimeout(() => setPhase("Measuring upload..."), 7000);

      const result = await runSpeedTest();
      clearTimeout(timerId);
      clearTimeout(timerId2);

      try {
        await submitSpeedtest({
          spot_id: spot.id,
          lat: userPos.lat,
          lng: userPos.lng,
          download: result.download,
          upload: result.upload,
          ping: result.ping,
        });
        toast("Speed test saved", "success");
        onUpdated();
      } catch (e) {
        toast((e as Error).message || "Failed to save the speed test", "error");
      }
    } catch {
      toast("Speed test failed. Check your connection.", "error");
    }
    setTesting(false);
    setPhase("");
  }

  const isClose = distance !== null && distance <= MAX_DISTANCE;
  const estimatedDownload = estimate ? Math.round(estimate.avg_d_kbps / 1000) : null;
  const estimatedUpload = estimate ? Math.round(estimate.avg_u_kbps / 1000) : null;
  const estimatedPing = estimate ? Math.round(estimate.avg_lat_ms) : null;

  if (editing) {
    return (
      <EditSpotForm
        spot={spot}
        onSaved={() => {
          setEditing(false);
          onUpdated();
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="detail-panel">
      <button className="detail-close" onClick={onClose}>✕</button>
      <h2>{spot.name}</h2>
      <span className="spot-type">{spot.type}</span>
      {spot.address && <p className="detail-address">{spot.address}</p>}

      {distance !== null && (
        <div className={`proximity-badge ${isClose ? "close" : "far"}`}>
          {isClose ? "✓" : "⚠"} You are {formatDistance(distance)}
        </div>
      )}

      {hasSpeedData(spot) ? (
        <>
          <div className="detail-stats">
            <Bar label="Download" value={spot.avg_download} max={200} unit="Mbps" color="#22c55e" />
            <Bar label="Upload" value={spot.avg_upload} max={100} unit="Mbps" color="#3b82f6" />
            <Bar label="Ping" value={spot.avg_ping} max={100} unit="ms" color="#f59e0b" />
          </div>
          <SpeedHistory spotId={spot.id} />
          <button className="btn-secondary full" onClick={handleTest} disabled={testing}>
            {testing ? phase || "Testing..." : "Re-test speed"}
          </button>
        </>
      ) : estimate ? (
        <>
          <div className="estimate-badge">Ookla area estimate</div>
          <div className="detail-stats">
            <Bar label="Download" value={estimatedDownload} max={200} unit="Mbps" color="" estimated />
            <Bar label="Upload" value={estimatedUpload} max={100} unit="Mbps" color="" estimated />
            <Bar label="Ping" value={estimatedPing} max={100} unit="ms" color="" estimated />
          </div>
          <div className="cta-box">
            <p className="cta-text">Estimated from Ookla open data for this area</p>
            <button className="btn-primary full" onClick={handleTest} disabled={testing}>
              {testing ? phase || "Testing..." : "Be the first to test this spot"}
            </button>
          </div>
        </>
      ) : (
        <div className="cta-box">
          <p className="cta-text">No speed data yet</p>
          <button className="btn-primary full" onClick={handleTest} disabled={testing}>
            {testing ? phase || "Testing..." : "Be the first to test this spot"}
          </button>
        </div>
      )}

      {tooFarMsg && <p className="too-far-msg">{tooFarMsg}</p>}

      {spot.tags && spot.tags.length > 0 && (
        <div className="detail-tags">
          {spot.tags.map((tag) => (
            <span key={tag} className="tag">{tag}</span>
          ))}
        </div>
      )}

      <p className="detail-date">
        {spot.last_tested_at
          ? `Last tested: ${formatTestedAt(spot.last_tested_at)}`
          : "Never tested"}
      </p>

      {isOwner && (
        <div className="owner-actions">
          <button
            type="button"
            className="btn-link"
            onClick={() => setEditing(true)}
          >
            Edit
          </button>
          <button
            type="button"
            className="btn-link btn-link-danger"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      )}
    </div>
  );
}
