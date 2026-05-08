import { useEffect, useRef, useState } from "react";
import { parseWifiQr, type ParsedWifi } from "../lib/wifi-qr";

interface Props {
  onScan: (parsed: ParsedWifi) => void;
  onClose: () => void;
}

// Full-screen camera overlay that decodes a Wi-Fi QR via jsQR. The
// jsQR library is dynamically imported so it stays out of the initial
// bundle — most users never open the scanner.
export default function WifiQrScanner({ onScan, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [foundNonWifi, setFoundNonWifi] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let raf = 0;

    (async () => {
      const { default: jsQR } = await import("jsqr");
      if (cancelled) return;

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
      } catch {
        if (!cancelled) setError("Camera access was denied or unavailable.");
        return;
      }

      if (cancelled) {
        stream?.getTracks().forEach((t) => t.stop());
        return;
      }

      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        // Some browsers throw on autoplay if element isn't visible.
      }

      const tick = () => {
        if (cancelled) return;
        const v = videoRef.current;
        const c = canvasRef.current;
        if (!v || !c || v.readyState !== v.HAVE_ENOUGH_DATA) {
          raf = requestAnimationFrame(tick);
          return;
        }
        c.width = v.videoWidth;
        c.height = v.videoHeight;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(v, 0, 0, c.width, c.height);
        const img = ctx.getImageData(0, 0, c.width, c.height);
        const result = jsQR(img.data, img.width, img.height, {
          inversionAttempts: "dontInvert",
        });
        if (result) {
          const parsed = parseWifiQr(result.data);
          if (parsed) {
            onScan(parsed);
            return;
          }
          // Found a QR but it's not Wi-Fi — flash a hint and keep looking.
          setFoundNonWifi(true);
          setTimeout(() => {
            if (!cancelled) setFoundNonWifi(false);
          }, 1500);
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onScan]);

  return (
    <div className="qr-scanner-overlay" role="dialog" aria-label="Scan Wi-Fi QR code">
      {error ? (
        <div className="qr-scanner-error">
          <p>{error}</p>
          <button type="button" className="btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      ) : (
        <>
          <video
            ref={videoRef}
            playsInline
            muted
            className="qr-scanner-video"
          />
          <div className="qr-scanner-frame" aria-hidden />
          <div className="qr-scanner-hint">
            {foundNonWifi
              ? "QR found, but it's not a Wi-Fi code"
              : "Point at a Wi-Fi QR code"}
          </div>
          <button type="button" className="qr-scanner-close" onClick={onClose}>
            Cancel
          </button>
        </>
      )}
      <canvas ref={canvasRef} style={{ display: "none" }} />
    </div>
  );
}
