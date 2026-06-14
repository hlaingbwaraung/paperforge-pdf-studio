import { useEffect, useRef } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { EditorPage } from "../types";

type Props = {
  document: PDFDocumentProxy | null;
  page: EditorPage;
  index: number;
  active: boolean;
  draggable: boolean;
  onClick: () => void;
  onDragStart: () => void;
  onDrop: () => void;
};

export default function PageThumbnail({
  document,
  page,
  index,
  active,
  draggable,
  onClick,
  onDragStart,
  onDrop,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null;

    const render = async () => {
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (!canvas || !context) return;

      if (page.sourceIndex === null || !document) {
        canvas.width = 112;
        canvas.height = 148;
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.strokeStyle = "#d8d9de";
        context.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1);
        return;
      }

      const sourcePage = await document.getPage(page.sourceIndex + 1);
      const base = sourcePage.getViewport({
        scale: 1,
        rotation: sourcePage.rotate + page.rotation,
      });
      const scale = 112 / base.width;
      const viewport = sourcePage.getViewport({
        scale,
        rotation: sourcePage.rotate + page.rotation,
      });
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.ceil(viewport.width * ratio);
      canvas.height = Math.ceil(viewport.height * ratio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      if (cancelled) return;
      task = sourcePage.render({
        canvasContext: context,
        viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      });
      await task.promise;
    };

    void render();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [document, page.rotation, page.sourceIndex]);

  return (
    <button
      type="button"
      className={`thumbnail-card ${active ? "active" : ""}`}
      onClick={onClick}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
      aria-label={`Open page ${index + 1}`}
    >
      <span className="thumbnail-number">{index + 1}</span>
      <span className="thumbnail-paper">
        <canvas ref={canvasRef} />
        {page.annotations.length > 0 && (
          <span className="annotation-count">{page.annotations.length}</span>
        )}
      </span>
    </button>
  );
}
