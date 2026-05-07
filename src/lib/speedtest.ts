const DOWN_URL = "https://speed.cloudflare.com/__down?bytes=5000000";
const UP_URL = "https://speed.cloudflare.com/__up";
const PING_URL = "https://speed.cloudflare.com/__down?bytes=0";

export interface SpeedResult {
  download: number;
  upload: number;
  ping: number;
}

async function measureDownload(): Promise<number> {
  const start = performance.now();
  const res = await fetch(DOWN_URL, { cache: "no-store" });
  const blob = await res.blob();
  const end = performance.now();
  const mbps = (blob.size * 8) / ((end - start) / 1000) / 1_000_000;
  return Math.round(mbps * 100) / 100;
}

async function measureUpload(): Promise<number> {
  const payload = new Blob([new ArrayBuffer(2_000_000)]);
  const start = performance.now();
  await fetch(UP_URL, { method: "POST", body: payload, cache: "no-store" });
  const end = performance.now();
  const mbps = (payload.size * 8) / ((end - start) / 1000) / 1_000_000;
  return Math.round(mbps * 100) / 100;
}

async function measurePing(): Promise<number> {
  const samples: number[] = [];
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    await fetch(PING_URL, { cache: "no-store" });
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  // Median of 5 samples
  const median = samples[2];
  return Math.round(median * 100) / 100;
}

export async function runSpeedTest(): Promise<SpeedResult> {
  const ping = await measurePing();
  const download = await measureDownload();
  const upload = await measureUpload();
  return { download, upload, ping };
}
