import { useEffect, useRef, useState } from "react";
import { PenLine, RotateCcw, X } from "lucide-react";

type Props = {
  open: boolean;
  onClose: () => void;
  onSave: (dataUrl: string) => void;
};

export default function SignatureModal({ open, onClose, onSave }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [hasInk, setHasInk] = useState(false);

  const clear = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
  };

  useEffect(() => {
    if (open) window.setTimeout(clear, 0);
  }, [open]);

  if (!open) return null;

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * event.currentTarget.width,
      y: ((event.clientY - rect.top) / rect.height) * event.currentTarget.height,
    };
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="signature-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="signature-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">Identity mark</span>
            <h2 id="signature-title">Create your signature</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <p className="modal-copy">
          Draw inside the field. Your signature stays in this browser and is
          embedded only when you export.
        </p>
        <div className="signature-pad">
          <canvas
            ref={canvasRef}
            width={720}
            height={240}
            onPointerDown={(event) => {
              const context = event.currentTarget.getContext("2d");
              if (!context) return;
              const start = point(event);
              event.currentTarget.setPointerCapture(event.pointerId);
              context.beginPath();
              context.moveTo(start.x, start.y);
              context.strokeStyle = "#172033";
              context.lineWidth = 5;
              context.lineCap = "round";
              context.lineJoin = "round";
              setDrawing(true);
              setHasInk(true);
            }}
            onPointerMove={(event) => {
              if (!drawing) return;
              const context = event.currentTarget.getContext("2d");
              if (!context) return;
              const next = point(event);
              context.lineTo(next.x, next.y);
              context.stroke();
            }}
            onPointerUp={(event) => {
              event.currentTarget.releasePointerCapture(event.pointerId);
              setDrawing(false);
            }}
          />
          {!hasInk && (
            <div className="signature-placeholder">
              <PenLine size={20} />
              Draw signature
            </div>
          )}
          <div className="signature-line" />
        </div>
        <div className="modal-actions">
          <button className="button button-ghost" onClick={clear}>
            <RotateCcw size={16} />
            Clear
          </button>
          <button
            className="button button-primary"
            disabled={!hasInk}
            onClick={() => {
              const dataUrl = canvasRef.current?.toDataURL("image/png");
              if (dataUrl) onSave(dataUrl);
            }}
          >
            Use signature
          </button>
        </div>
      </section>
    </div>
  );
}
