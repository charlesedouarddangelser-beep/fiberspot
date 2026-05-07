import { useEffect, useState } from "react";
import type { SpotInsert } from "../types/spot";
import { getUserLocation } from "../lib/geo";
import { runSpeedTest as runFullSpeedTest } from "../lib/speedtest";
import type { SpeedResult } from "../lib/speedtest";
import { useToast } from "../lib/toast";

const TYPES = ["Cafe", "Library", "Coworking", "Hotel", "Restaurant", "Park", "Other"];

interface Props {
  onSubmit: (spot: SpotInsert) => Promise<void>;
  onCancel: () => void;
  initialName?: string;
  initialLat?: number;
  initialLng?: number;
  initialType?: string;
  initialAddress?: string;
}

export default function AddSpotForm({ onSubmit, onCancel, initialName, initialLat, initialLng, initialType, initialAddress }: Props) {
  const toast = useToast();
  const [name, setName] = useState(initialName ?? "");
  const [type, setType] = useState(initialType ?? "Cafe");
  const [address, setAddress] = useState(initialAddress ?? "");
  const [tags, setTags] = useState("");
  const [lat, setLat] = useState<number | null>(initialLat ?? null);
  const [lng, setLng] = useState<number | null>(initialLng ?? null);
  const [speed, setSpeed] = useState<SpeedResult | null>(null);
  const [locating, setLocating] = useState(false);
  const [testing, setTesting] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Resync local state when parent updates the prefill props (defensive — root cause is fixed in App.tsx)
  useEffect(() => { if (initialName !== undefined) setName(initialName); }, [initialName]);
  useEffect(() => { if (initialType !== undefined) setType(initialType); }, [initialType]);
  useEffect(() => { if (initialAddress !== undefined) setAddress(initialAddress); }, [initialAddress]);
  useEffect(() => { if (initialLat !== undefined) setLat(initialLat); }, [initialLat]);
  useEffect(() => { if (initialLng !== undefined) setLng(initialLng); }, [initialLng]);

  async function detectLocation() {
    setLocating(true);
    try {
      const pos = await getUserLocation();
      setLat(pos.lat);
      setLng(pos.lng);
    } catch {
      toast("Could not detect location. Please allow geolocation access.", "error");
    }
    setLocating(false);
  }

  async function handleSpeedTest() {
    setTesting(true);
    try {
      const result = await runFullSpeedTest();
      setSpeed(result);
    } catch {
      toast("Speed test failed. Check your connection.", "error");
    }
    setTesting(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (lat === null || lng === null) {
      toast("Please detect your location first.", "error");
      return;
    }
    setSubmitting(true);
    await onSubmit({
      name,
      type,
      address: address || null,
      lat,
      lng,
      avg_download: speed?.download ?? null,
      avg_upload: speed?.upload ?? null,
      avg_ping: speed?.ping ?? null,
      tags: tags ? tags.split(",").map((t) => t.trim()) : null,
    });
    setSubmitting(false);
  }

  return (
    <div className="detail-panel form-panel">
      <button className="detail-close" onClick={onCancel}>✕</button>
      <h2>Add New Spot</h2>
      <form onSubmit={handleSubmit}>
        <label>
          Name
          <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Coffee Corner" />
        </label>

        <label>
          Type
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>

        <label>
          Address
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="123 Main St" />
        </label>

        <label>
          Tags (comma-separated)
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="quiet, power outlets" />
        </label>

        <div className="form-row">
          <button type="button" className="btn-secondary" onClick={detectLocation} disabled={locating}>
            {locating ? "Detecting..." : lat !== null && lng !== null ? `📍 ${lat.toFixed(4)}, ${lng.toFixed(4)}` : "Detect Location"}
          </button>
        </div>

        <div className="form-row">
          <button type="button" className="btn-secondary" onClick={handleSpeedTest} disabled={testing}>
            {testing ? "Testing..." : speed !== null ? `⚡ ↓${speed.download} ↑${speed.upload} ${speed.ping}ms` : "Run Speed Test"}
          </button>
        </div>

        <button type="submit" className="btn-primary full" disabled={submitting}>
          {submitting ? "Saving..." : "Save Spot"}
        </button>
      </form>
    </div>
  );
}
