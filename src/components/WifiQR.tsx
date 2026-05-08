import { useEffect, useRef } from "react";
import QRCode from "qrcode";

interface Props {
  ssid: string;
  password: string | null;
}

// Builds a standard Wi-Fi auto-join QR payload. iOS Camera, Android
// Camera, and most QR scanners recognise the format and offer "Join
// network" without retyping the SSID/password.
//
// Backslashes and the special characters \ ; , : " in SSID/password
// must be escaped per the spec.
function escapeWifi(s: string): string {
  return s.replace(/[\\;,:"]/g, (c) => `\\${c}`);
}

function buildWifiPayload(ssid: string, password: string | null): string {
  const t = password ? "WPA" : "nopass";
  const s = escapeWifi(ssid);
  const p = password ? `P:${escapeWifi(password)};` : "";
  return `WIFI:T:${t};S:${s};${p};`;
}

export default function WifiQR({ ssid, password }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const payload = buildWifiPayload(ssid, password);
    QRCode.toCanvas(canvas, payload, {
      width: 180,
      margin: 1,
      color: { dark: "#e4e4e7", light: "#22232d" },
    }).catch(() => {
      // ignore — canvas keeps whatever was last drawn
    });
  }, [ssid, password]);

  return (
    <div className="wifi-qr">
      <canvas ref={canvasRef} aria-label="Wi-Fi join QR code" />
      <p className="wifi-qr-hint">Scan with another phone's camera to auto-join.</p>
    </div>
  );
}
