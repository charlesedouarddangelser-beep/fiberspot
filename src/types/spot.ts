export interface Spot {
  id: string;
  name: string;
  type: string;
  address: string | null;
  lat: number;
  lng: number;
  avg_download: number | null;
  avg_upload: number | null;
  avg_ping: number | null;
  tags: string[] | null;
  wifi_ssid: string | null;
  wifi_password: string | null;
  author_id: string | null;
  created_at: string;
  last_tested_at: string | null;
}

export type SpotInsert = Omit<Spot, "id" | "created_at" | "last_tested_at" | "author_id"> & {
  // User's lat/lng at the moment the initial speedtest ran. Required by
  // the server when avg_download is non-null so we can enforce the
  // "you must be at the spot to test it" rule on creation, the same way
  // we already do for re-tests via /api/spots/speedtest.
  test_lat?: number;
  test_lng?: number;
};
