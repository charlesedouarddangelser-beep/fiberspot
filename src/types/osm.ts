// Renamed-in-place: this type now represents POIs from Mapbox Search Box,
// not OpenStreetMap. We keep the `OsmPoi` name to minimize churn across
// components — TODO rename to `Poi` in a follow-up cleanup.
export interface OsmPoi {
  id: string;
  lat: number;
  lng: number;
  name: string | null;
  type: string;
  address: string | null;
  openingHours: string | null;
  tags: Record<string, string>;
}
