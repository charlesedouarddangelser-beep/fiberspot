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
  const [streaming, setStreaming] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let raf = 0;

    (async () => {
      const { default: jsQR } = await import("jsqr");
      if (cancelled) return;

      if (!navigator.mediaDevices?.getUserMedia) {
        setError("This browser doesn't expose the camera. Try Safari or Chrome.");
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
      } catch (err) {
        if (cancelled) return;
        const e = err as DOMException;
        if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
          setError("Camera access was denied. Allow it in browser settings (and in iOS Settings → Brave → Camera if you're on Brave) to scan a QR.");
        } else if (e.name === "NotFoundError" || e.name === "DevicesNotFoundError") {
          setError("No camera found on this device.");
        } else if (e.name === "NotReadableError") {
          setError("The camera is in use by another app.");
        } else {
          setError(`Camera error: ${e.name || e.message || "unknown"}. Try the page in Safari if Brave keeps failing.`);
        }
        return;
      }

      if (cancelled) {
        stream?.getTracks().forEach((t) => t.stop());
        return;
      }

      const video = videoRef.current;
      if (!video) {
        stream?.getTracks().forEach((t) => t.stop());
        return;
      }

      video.srcObject = stream;

      // Wait for the metadata so we know dimensions are valid before
      // play() — iOS WebKit otherwise sometimes throws "operation not
      // supported" because it can't size the video element.
      await new Promise<void>((resolve) => {
        if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
          resolve();
          return;
        }
        const onMeta = () => {
          video.removeEventListener("loadedmetadata", onMeta);
          resolve();
        };
        video.addEventListener("loadedmetadata", onMeta);
      });
      if (cancelled) return;

      try {
        await video.play();
        setStreaming(true);
      } catch (err) {
        const e = err as DOMException;
        setError(
          `Couldn't start the camera preview (${e.name || "play failed"}). Try Safari, or close and reopen the scanner.`
        );
        return;
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
            autoPlay
            className="qr-scanner-video"
          />
          {!streaming && (
            <div className="qr-scanner-loading">Starting camera…</div>
          )}
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
