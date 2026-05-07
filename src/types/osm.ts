export interface OsmPoi {
  id: number;
  lat: number;
  lng: number;
  name: string | null;
  type: string;
  address: string | null;
  openingHours: string | null;
  tags: Record<string, string>;
}
