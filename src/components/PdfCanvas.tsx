import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type {
  Annotation,
  EditorPage,
  PdfPoint,
  Tool,
} from "../types";
import { makeId } from "../utils";

type ViewportLike = {
  width: number;
  height: number;
  scale: number;
  rotation: number;
  convertToPdfPoint: (x: number, y: number) => number[];
  convertToViewportPoint: (x: number, y: number) => number[];
};

type Props = {
  document: PDFDocumentProxy | null;
  page: EditorPage;
  zoom: number;
  tool: Tool;
  color: string;
  strokeWidth: number;
  fontSize: number;
  signatureData: string | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAddAnnotation: (annotation: Annotation) => void;
};

type Draft =
  | { type: "draw"; points: PdfPoint[] }
  | {
      type: "highlight" | "rectangle" | "signature";
      start: PdfPoint;
      end: PdfPoint;
    };

type InlineEditor = {
  kind: "text" | "comment";
  left: number;
  top: number;
  point: PdfPoint;
  value: string;
};

const createBlankViewport = (
  width: number,
  height: number,
  scale: number,
  rotation: number,
): ViewportLike => {
  const normalized = ((rotation % 360) + 360) % 360;
  const rotated = normalized === 90 || normalized === 270;

  const convertToViewportPoint = (x: number, y: number): [number, number] => {
    if (normalized === 90) return [y * scale, x * scale];
    if (normalized === 180)
      return [(width - x) * scale, y * scale];
    if (normalized === 270)
      return [(height - y) * scale, (width - x) * scale];
    return [x * scale, (height - y) * scale];
  };

  const convertToPdfPoint = (x: number, y: number): [number, number] => {
    if (normalized === 90) return [y / scale, x / scale];
    if (normalized === 180)
      return [width - x / scale, y / scale];
    if (normalized === 270)
      return [width - y / scale, height - x / scale];
    return [x / scale, height - y / scale];
  };

  return {
    width: (rotated ? height : width) * scale,
    height: (rotated ? width : height) * scale,
    scale,
    rotation: normalized,
    convertToPdfPoint,
    convertToViewportPoint,
  };
};

const annotationBounds = (
  annotation: Annotation,
  viewport: ViewportLike,
) => {
  if (
    annotation.type === "highlight" ||
    annotation.type === "rectangle" ||
    annotation.type === "signature"
  ) {
    const first = viewport.convertToViewportPoint(
      annotation.x1,
      annotation.y1,
    );
    const second = viewport.convertToViewportPoint(
      annotation.x2,
      annotation.y2,
    );
    return {
      left: Math.min(first[0], second[0]),
      top: Math.min(first[1], second[1]),
      right: Math.max(first[0], second[0]),
      bottom: Math.max(first[1], second[1]),
    };
  }

  if (annotation.type === "draw") {
    const points = annotation.points.map((point) =>
      viewport.convertToViewportPoint(point.x, point.y),
    );
    return {
      left: Math.min(...points.map(([x]) => x)) - 8,
      top: Math.min(...points.map(([, y]) => y)) - 8,
      right: Math.max(...points.map(([x]) => x)) + 8,
      bottom: Math.max(...points.map(([, y]) => y)) + 8,
    };
  }

  if (annotation.type === "text") {
    const [x, y] = viewport.convertToViewportPoint(annotation.x, annotation.y);
    const width = Math.max(60, annotation.text.length * annotation.fontSize * 0.55);
    return {
      left: x - 4,
      top: y - 4,
      right: x + width * viewport.scale,
      bottom: y + annotation.fontSize * 1.6 * viewport.scale,
    };
  }

  if (annotation.type === "comment") {
    const [x, y] = viewport.convertToViewportPoint(annotation.x, annotation.y);
    return { left: x - 12, top: y - 12, right: x + 160, bottom: y + 18 };
  }

  return { left: 0, top: 0, right: 0, bottom: 0 };
};

const drawAnnotation = (
  context: CanvasRenderingContext2D,
  annotation: Annotation,
  viewport: ViewportLike,
  selected: boolean,
) => {
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";

  if (annotation.type === "draw") {
    const points = annotation.points.map((point) =>
      viewport.convertToViewportPoint(point.x, point.y),
    );
    context.beginPath();
    points.forEach(([x, y], index) => {
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.strokeStyle = annotation.color;
    context.lineWidth = annotation.width * viewport.scale;
    context.stroke();
  }

  if (annotation.type === "highlight" || annotation.type === "rectangle") {
    const bounds = annotationBounds(annotation, viewport);
    const width = bounds.right - bounds.left;
    const height = bounds.bottom - bounds.top;
    if (annotation.type === "highlight") {
      context.globalAlpha = 0.32;
      context.fillStyle = annotation.color;
      context.fillRect(bounds.left, bounds.top, width, height);
    } else {
      context.strokeStyle = annotation.color;
      context.lineWidth = annotation.width * viewport.scale;
      context.strokeRect(bounds.left, bounds.top, width, height);
    }
  }

  if (annotation.type === "text") {
    const [x, y] = viewport.convertToViewportPoint(annotation.x, annotation.y);
    context.fillStyle = annotation.color;
    context.font = `${annotation.fontSize * viewport.scale}px "Inter", "Segoe UI", sans-serif`;
    context.textBaseline = "top";
    annotation.text.split("\n").forEach((line, index) => {
      context.fillText(
        line,
        x,
        y + index * annotation.fontSize * viewport.scale * 1.25,
      );
    });
  }

  if (annotation.type === "comment") {
    const [x, y] = viewport.convertToViewportPoint(annotation.x, annotation.y);
    context.fillStyle = "#ffb21c";
    context.strokeStyle = "#9a5b00";
    context.lineWidth = 1.2;
    context.beginPath();
    context.roundRect(x - 10, y - 10, 20, 20, 5);
    context.fill();
    context.stroke();
    context.fillStyle = "#2b1a00";
    context.font = `700 12px "Inter", sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("!", x, y + 0.5);
  }

  if (selected) {
    const bounds = annotationBounds(annotation, viewport);
    context.globalAlpha = 1;
    context.setLineDash([5, 4]);
    context.strokeStyle = "#4f8cff";
    context.lineWidth = 1.5;
    context.strokeRect(
      bounds.left - 4,
      bounds.top - 4,
      bounds.right - bounds.left + 8,
      bounds.bottom - bounds.top + 8,
    );
  }

  context.restore();
};

export default function PdfCanvas({
  document,
  page,
  zoom,
  tool,
  color,
  strokeWidth,
  fontSize,
  signatureData,
  selectedId,
  onSelect,
  onAddAnnotation,
}: Props) {
  const baseCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const [viewport, setViewport] = useState<ViewportLike | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [inlineEditor, setInlineEditor] = useState<InlineEditor | null>(null);
  const [signatureImages, setSignatureImages] = useState<
    Record<string, HTMLImageElement>
  >({});
  const activePointer = useRef<number | null>(null);

  const scale = (zoom / 100) * 1.22;

  useEffect(() => {
    let cancelled = false;
    let renderTask: ReturnType<PDFPageProxy["render"]> | null = null;

    const render = async () => {
      const canvas = baseCanvasRef.current;
      if (!canvas) return;
      const context = canvas.getContext("2d");
      if (!context) return;

      let nextViewport: ViewportLike;
      let renderViewport: ReturnType<PDFPageProxy["getViewport"]> | null = null;
      let sourcePage: PDFPageProxy | null = null;
      if (page.sourceIndex !== null && document) {
        sourcePage = await document.getPage(page.sourceIndex + 1);
        renderViewport = sourcePage.getViewport({
          scale,
          rotation: sourcePage.rotate + page.rotation,
        });
        nextViewport = renderViewport as unknown as ViewportLike;
      } else {
        nextViewport = createBlankViewport(
          page.width,
          page.height,
          scale,
          page.rotation,
        );
      }

      if (cancelled) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.ceil(nextViewport.width * ratio);
      canvas.height = Math.ceil(nextViewport.height * ratio);
      canvas.style.width = `${nextViewport.width}px`;
      canvas.style.height = `${nextViewport.height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, nextViewport.width, nextViewport.height);

      if (sourcePage && renderViewport) {
        context.setTransform(1, 0, 0, 1, 0, 0);
        renderTask = sourcePage.render({
          canvasContext: context,
          viewport: renderViewport,
          transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
        });
        await renderTask.promise;
      }

      if (!cancelled) setViewport(nextViewport);
    };

    void render();
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [document, page.height, page.rotation, page.sourceIndex, page.width, scale]);

  useEffect(() => {
    const missing = page.annotations.filter(
      (annotation) =>
        annotation.type === "signature" && !signatureImages[annotation.id],
    );
    missing.forEach((annotation) => {
      if (annotation.type !== "signature") return;
      const image = new Image();
      image.onload = () =>
        setSignatureImages((current) => ({
          ...current,
          [annotation.id]: image,
        }));
      image.src = annotation.dataUrl;
    });
  }, [page.annotations, signatureImages]);

  const paintOverlay = useCallback(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas || !viewport) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.ceil(viewport.width * ratio);
    canvas.height = Math.ceil(viewport.height * ratio);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, viewport.width, viewport.height);

    page.annotations.forEach((annotation) => {
      if (annotation.type === "signature") {
        const image = signatureImages[annotation.id];
        if (image) {
          const bounds = annotationBounds(annotation, viewport);
          context.drawImage(
            image,
            bounds.left,
            bounds.top,
            bounds.right - bounds.left,
            bounds.bottom - bounds.top,
          );
        }
      }
      drawAnnotation(context, annotation, viewport, annotation.id === selectedId);
    });

    if (draft?.type === "draw") {
      drawAnnotation(
        context,
        {
          id: "draft",
          pageId: page.id,
          type: "draw",
          points: draft.points,
          width: strokeWidth,
          color,
          createdAt: Date.now(),
        },
        viewport,
        false,
      );
    }

    if (
      draft?.type === "highlight" ||
      draft?.type === "rectangle"
    ) {
      drawAnnotation(
        context,
        {
          id: "draft",
          pageId: page.id,
          type: draft.type,
          x1: draft.start.x,
          y1: draft.start.y,
          x2: draft.end.x,
          y2: draft.end.y,
          width: strokeWidth,
          color,
          createdAt: Date.now(),
        },
        viewport,
        false,
      );
    }

    if (draft?.type === "signature" && signatureData) {
      const start = viewport.convertToViewportPoint(
        draft.start.x,
        draft.start.y,
      );
      const end = viewport.convertToViewportPoint(draft.end.x, draft.end.y);
      const bounds = {
        left: Math.min(start[0], end[0]),
        top: Math.min(start[1], end[1]),
        width: Math.abs(end[0] - start[0]),
        height: Math.abs(end[1] - start[1]),
      };
      const image = new Image();
      image.onload = () => {
        context.drawImage(
          image,
          bounds.left,
          bounds.top,
          bounds.width,
          bounds.height,
        );
      };
      image.src = signatureData;
    }
  }, [
    color,
    draft,
    page.annotations,
    page.id,
    selectedId,
    signatureData,
    signatureImages,
    strokeWidth,
    viewport,
  ]);

  useEffect(() => {
    paintOverlay();
  }, [paintOverlay]);

  const toLocalPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const toPdfPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!viewport) return { x: 0, y: 0 };
    const local = toLocalPoint(event);
    const [x, y] = viewport.convertToPdfPoint(local.x, local.y);
    return { x, y };
  };

  const hitTest = (x: number, y: number) => {
    if (!viewport) return null;
    return (
      [...page.annotations]
        .reverse()
        .find((annotation) => {
          const bounds = annotationBounds(annotation, viewport);
          return (
            x >= bounds.left - 6 &&
            x <= bounds.right + 6 &&
            y >= bounds.top - 6 &&
            y <= bounds.bottom + 6
          );
        }) ?? null
    );
  };

  const handlePointerDown = (
    event: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    if (!viewport) return;
    const local = toLocalPoint(event);
    const point = toPdfPoint(event);

    if (tool === "select") {
      onSelect(hitTest(local.x, local.y)?.id ?? null);
      return;
    }

    if (tool === "text") {
      setInlineEditor({
        kind: "text",
        left: local.x,
        top: local.y,
        point,
        value: "",
      });
      return;
    }

    if (tool === "comment") {
      setInlineEditor({
        kind: "comment",
        left: local.x,
        top: local.y,
        point,
        value: "",
      });
      return;
    }

    activePointer.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === "draw") {
      setDraft({ type: "draw", points: [point] });
    } else if (
      tool === "highlight" ||
      tool === "rectangle" ||
      tool === "signature"
    ) {
      setDraft({ type: tool, start: point, end: point });
    }
  };

  const handlePointerMove = (
    event: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    if (activePointer.current !== event.pointerId || !draft) return;
    const point = toPdfPoint(event);
    if (draft.type === "draw") {
      setDraft({ ...draft, points: [...draft.points, point] });
    } else {
      setDraft({ ...draft, end: point });
    }
  };

  const handlePointerUp = (
    event: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    if (activePointer.current !== event.pointerId || !draft) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    activePointer.current = null;

    if (draft.type === "draw" && draft.points.length > 1) {
      onAddAnnotation({
        id: makeId("draw"),
        pageId: page.id,
        type: "draw",
        points: draft.points,
        width: strokeWidth,
        color,
        createdAt: Date.now(),
      });
    }

    if (draft.type === "highlight" || draft.type === "rectangle") {
      onAddAnnotation({
        id: makeId(draft.type),
        pageId: page.id,
        type: draft.type,
        x1: draft.start.x,
        y1: draft.start.y,
        x2: draft.end.x,
        y2: draft.end.y,
        width: strokeWidth,
        color,
        createdAt: Date.now(),
      });
    }

    if (draft.type === "signature" && signatureData) {
      onAddAnnotation({
        id: makeId("signature"),
        pageId: page.id,
        type: "signature",
        x1: draft.start.x,
        y1: draft.start.y,
        x2: draft.end.x,
        y2: draft.end.y,
        dataUrl: signatureData,
        color: "#111111",
        createdAt: Date.now(),
      });
    }

    setDraft(null);
  };

  const commitInlineEditor = () => {
    if (!inlineEditor?.value.trim()) {
      setInlineEditor(null);
      return;
    }

    if (inlineEditor.kind === "comment") {
      onAddAnnotation({
        id: makeId("comment"),
        pageId: page.id,
        type: "comment",
        x: inlineEditor.point.x,
        y: inlineEditor.point.y,
        text: inlineEditor.value.trim(),
        color: "#ffb21c",
        createdAt: Date.now(),
      });
    } else {
      onAddAnnotation({
        id: makeId("text"),
        pageId: page.id,
        type: "text",
        x: inlineEditor.point.x,
        y: inlineEditor.point.y,
        text: inlineEditor.value.trim(),
        fontSize,
        color,
        createdAt: Date.now(),
      });
    }
    setInlineEditor(null);
  };

  const cursorClass = useMemo(() => {
    if (tool === "select") return "cursor-select";
    if (tool === "text") return "cursor-text";
    return "cursor-crosshair";
  }, [tool]);

  return (
    <div
      className="pdf-page-shell"
      style={{
        width: viewport?.width ?? page.width * scale,
        height: viewport?.height ?? page.height * scale,
      }}
    >
      <canvas ref={baseCanvasRef} className="pdf-base-canvas" />
      <canvas
        ref={overlayCanvasRef}
        className={`pdf-overlay-canvas ${cursorClass}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => setDraft(null)}
        aria-label={`PDF page ${page.sourceIndex === null ? "blank" : page.sourceIndex + 1} editing canvas`}
      />
      {inlineEditor && (
        <textarea
          autoFocus
          className={`canvas-text-editor ${
            inlineEditor.kind === "comment" ? "comment-editor" : ""
          }`}
          style={{
            left: inlineEditor.left,
            top: inlineEditor.top,
            color: inlineEditor.kind === "comment" ? "#2b1a00" : color,
            fontSize:
              inlineEditor.kind === "comment" ? 13 : fontSize * scale,
          }}
          value={inlineEditor.value}
          placeholder={
            inlineEditor.kind === "comment"
              ? "Write a comment..."
              : "Type here..."
          }
          onChange={(event) =>
            setInlineEditor({ ...inlineEditor, value: event.target.value })
          }
          onBlur={commitInlineEditor}
          onKeyDown={(event) => {
            if (event.key === "Escape") setInlineEditor(null);
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              commitInlineEditor();
            }
          }}
        />
      )}
    </div>
  );
}
