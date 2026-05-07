import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

const BTC_ADDRESS = import.meta.env.VITE_BTC_ADDRESS as string;

export default function DonateModal() {
  const [open, setOpen] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (open && canvasRef.current && BTC_ADDRESS) {
      QRCode.toCanvas(canvasRef.current, `bitcoin:${BTC_ADDRESS}`, {
        width: 200,
        margin: 2,
        color: { dark: "#e4e4e7", light: "#1a1b23" },
      });
    }
  }, [open]);

  if (!BTC_ADDRESS) return null;

  return (
    <>
      <button className="donate-btn" onClick={() => setOpen(true)}>
        Support FiberSpot
      </button>

      {open && (
        <div className="modal-overlay" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="detail-close" onClick={() => setOpen(false)}>✕</button>
            <h2>Donate Bitcoin</h2>
            <p className="modal-desc">Support FiberSpot development</p>
            <canvas ref={canvasRef} />
            <p className="btc-address">{BTC_ADDRESS}</p>
          </div>
        </div>
      )}
    </>
  );
}
