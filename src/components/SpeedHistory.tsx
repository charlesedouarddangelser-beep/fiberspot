import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

interface SpeedTestRow {
  download: number;
  upload: number;
  ping: number;
  created_at: string;
}

interface Props {
  spotId: string;
}

const POINTS_LIMIT = 30;
const CHART_W = 240;
const CHART_H = 56;
const CHART_PAD = 4;

function buildPath(values: number[], width: number, height: number, pad: number): string {
  if (values.length === 0) return "";
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const stepX = values.length > 1 ? innerW / (values.length - 1) : 0;
  return values
    .map((v, i) => {
      const x = pad + i * stepX;
      const y = pad + innerH - ((v - min) / range) * innerH;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export default function SpeedHistory({ spotId }: Props) {
  const [tests, setTests] = useState<SpeedTestRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTests(null);
    supabase
      .from("speed_tests")
      .select("download, upload, ping, created_at")
      .eq("spot_id", spotId)
      .order("created_at", { ascending: false })
      .limit(POINTS_LIMIT)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) {
          setTests([]);
          return;
        }
        // Reverse so oldest comes first for the chart.
        setTests((data as SpeedTestRow[]).reverse());
      });
    return () => {
      cancelled = true;
    };
  }, [spotId]);

  if (tests === null) return null;
  if (tests.length === 0) return null;
  if (tests.length === 1) {
    return (
      <p className="speed-history-meta">
        1 test recorded
      </p>
    );
  }

  const downloads = tests.map((t) => t.download);
  const path = buildPath(downloads, CHART_W, CHART_H, CHART_PAD);
  const min = Math.min(...downloads);
  const max = Math.max(...downloads);

  const firstDate = new Date(tests[0].created_at);
  const lastDate = new Date(tests[tests.length - 1].created_at);
  const days = Math.max(
    1,
    Math.round((lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24))
  );

  return (
    <div className="speed-history">
      <div className="speed-history-header">
        <span className="speed-history-title">Download trend</span>
        <span className="speed-history-meta">
          {tests.length} tests · {days}d
        </span>
      </div>
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        className="speed-history-chart"
        preserveAspectRatio="none"
        aria-label={`${tests.length} download speed tests, range ${min.toFixed(0)} to ${max.toFixed(0)} Mbps`}
      >
        <path d={path} fill="none" stroke="#22c55e" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div className="speed-history-axis">
        <span>{min.toFixed(0)} Mbps</span>
        <span>{max.toFixed(0)} Mbps</span>
      </div>
    </div>
  );
}
