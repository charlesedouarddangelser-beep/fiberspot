import { ImageResponse } from "@vercel/og";
import { createElement } from "react";
import { supabaseAdmin } from "./_lib/supabase";

export const config = { runtime: "edge" };

const h = createElement;

const SITE_URL = "https://fiberspot.vercel.app";

interface SpotForOg {
  name: string;
  type: string;
  address: string | null;
  avg_download: number | null;
  avg_upload: number | null;
  avg_ping: number | null;
}

function speedColor(download: number | null): string {
  if (download === null) return "#e4e4e7";
  if (download >= 50) return "#22c55e";
  if (download >= 20) return "#f59e0b";
  return "#ef4444";
}

function speedLabel(download: number | null): string {
  if (download === null) return "Untested";
  if (download >= 50) return "Fast";
  if (download >= 20) return "OK";
  return "Slow";
}

function defaultCard() {
  return new ImageResponse(
    h(
      "div",
      {
        style: {
          width: "100%",
          height: "100%",
          background: "#0f1117",
          color: "#e4e4e7",
          display: "flex",
          flexDirection: "column",
          padding: 80,
          fontFamily: "Inter, system-ui, sans-serif",
        },
      },
      h(
        "div",
        { style: { fontSize: 24, color: "#6366f1", letterSpacing: 4, fontWeight: 600 } },
        "FIBERSPOT"
      ),
      h(
        "div",
        {
          style: {
            fontSize: 96,
            fontWeight: 700,
            marginTop: 40,
            lineHeight: 1.1,
            display: "flex",
          },
        },
        "Find Wi-Fi spots near you"
      ),
      h(
        "div",
        { style: { fontSize: 36, color: "#9ca3af", marginTop: 24, display: "flex" } },
        "Test the speed. Share what you find."
      ),
      h(
        "div",
        { style: { marginTop: "auto", fontSize: 22, color: "#6b7280", display: "flex" } },
        "fiberspot.vercel.app"
      )
    ),
    { width: 1200, height: 630 }
  );
}

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (!id || id.length < 10 || id.length > 100) {
    return defaultCard();
  }

  const { data } = await supabaseAdmin
    .from("spots")
    .select("name, type, address, avg_download, avg_upload, avg_ping")
    .eq("id", id)
    .single();

  if (!data) return defaultCard();

  const spot = data as SpotForOg;
  const color = speedColor(spot.avg_download);
  const label = speedLabel(spot.avg_download);
  const dl = spot.avg_download !== null ? Math.round(spot.avg_download) : null;
  const up = spot.avg_upload !== null ? Math.round(spot.avg_upload) : null;
  const ping = spot.avg_ping !== null ? Math.round(spot.avg_ping) : null;

  const sideStat = (sym: string, val: number, unit: string) =>
    h(
      "div",
      { style: { display: "flex", alignItems: "baseline", gap: 12 } },
      h("span", { style: { fontSize: 22, color: "#6b7280" } }, sym),
      h("span", { style: { fontSize: 36, color: "#e4e4e7", fontWeight: 600 } }, String(val)),
      h("span", { style: { fontSize: 22, color: "#9ca3af" } }, unit)
    );

  const sideColumn =
    dl !== null
      ? h(
          "div",
          {
            style: {
              display: "flex",
              flexDirection: "column",
              gap: 18,
              marginBottom: 24,
              paddingLeft: 32,
              borderLeft: "1px solid #2e303a",
            },
          },
          up !== null ? sideStat("↑", up, "Mbps") : null,
          ping !== null ? sideStat("ping", ping, "ms") : null
        )
      : null;

  return new ImageResponse(
    h(
      "div",
      {
        style: {
          width: "100%",
          height: "100%",
          background: "#0f1117",
          color: "#e4e4e7",
          display: "flex",
          flexDirection: "column",
          padding: 80,
          fontFamily: "Inter, system-ui, sans-serif",
        },
      },
      h(
        "div",
        { style: { fontSize: 22, color: "#6366f1", letterSpacing: 4, fontWeight: 600, display: "flex" } },
        "FIBERSPOT"
      ),
      h(
        "div",
        {
          style: {
            fontSize: 84,
            fontWeight: 700,
            marginTop: 32,
            lineHeight: 1.05,
            display: "flex",
            maxWidth: 1040,
          },
        },
        spot.name
      ),
      h(
        "div",
        {
          style: {
            fontSize: 28,
            color: "#9ca3af",
            marginTop: 18,
            display: "flex",
            gap: 16,
          },
        },
        h("span", null, spot.type),
        spot.address ? h("span", { style: { color: "#6b7280" } }, "·") : null,
        spot.address
          ? h(
              "span",
              {
                style: {
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: 800,
                  display: "block",
                },
              },
              spot.address
            )
          : null
      ),
      h(
        "div",
        {
          style: {
            marginTop: "auto",
            display: "flex",
            alignItems: "flex-end",
            gap: 48,
          },
        },
        h(
          "div",
          { style: { display: "flex", flexDirection: "column" } },
          h(
            "div",
            {
              style: {
                fontSize: 18,
                color: "#6b7280",
                letterSpacing: 2,
                textTransform: "uppercase",
                display: "flex",
              },
            },
            dl !== null ? "Download" : "Status"
          ),
          h(
            "div",
            {
              style: {
                fontSize: 140,
                fontWeight: 800,
                color,
                lineHeight: 1,
                marginTop: 8,
                display: "flex",
              },
            },
            dl !== null ? String(dl) : label
          ),
          h(
            "div",
            { style: { fontSize: 28, color: "#9ca3af", marginTop: 4, display: "flex" } },
            dl !== null ? `Mbps · ${label}` : "no measurements yet"
          )
        ),
        sideColumn
      ),
      h(
        "div",
        {
          style: {
            marginTop: 32,
            fontSize: 22,
            color: "#6b7280",
            display: "flex",
          },
        },
        SITE_URL.replace("https://", "")
      )
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        "cache-control": "public, max-age=300, s-maxage=300",
      },
    }
  );
}
