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

export type SpotInsert = Omit<Spot, "id" | "created_at" | "last_tested_at" | "author_id">;
