import { useState } from "react";
import type { Spot } from "../types/spot";
import { updateSpot } from "../lib/api";
import { useToast } from "../lib/toast";

const TYPES = ["Cafe", "Library", "Coworking", "Hotel", "Restaurant", "Park", "Other"];

interface Props {
  spot: Spot;
  onSaved: (updated: Spot) => void;
  onCancel: () => void;
}

export default function EditSpotForm({ spot, onSaved, onCancel }: Props) {
  const toast = useToast();
  const [name, setName] = useState(spot.name);
  const [type, setType] = useState(spot.type);
  const [address, setAddress] = useState(spot.address ?? "");
  const [tags, setTags] = useState(spot.tags?.join(", ") ?? "");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const updated = await updateSpot(spot.id, {
        name: name.trim(),
        type,
        address: address.trim() || null,
        tags: tags.trim()
          ? tags.split(",").map((t) => t.trim()).filter(Boolean)
          : null,
      });
      toast("Spot updated", "success");
      onSaved(updated);
    } catch (e) {
      toast((e as Error).message || "Failed to update", "error");
    }
    setSubmitting(false);
  }

  return (
    <div className="detail-panel form-panel">
      <button className="detail-close" onClick={onCancel}>✕</button>
      <h2>Edit spot</h2>
      <form onSubmit={handleSubmit}>
        <label>
          Name
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Coffee Corner"
          />
        </label>

        <label>
          Type
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>

        <label>
          Address
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="123 Main St"
          />
        </label>

        <label>
          Tags (comma-separated)
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="quiet, power outlets"
          />
        </label>

        <button type="submit" className="btn-primary full" disabled={submitting}>
          {submitting ? "Saving..." : "Save changes"}
        </button>
      </form>
    </div>
  );
}
