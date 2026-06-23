import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlignLeft,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FilePlus2,
  FileText,
  Highlighter,
  MessageSquareText,
  MousePointer2,
  PanelRightClose,
  PanelRightOpen,
  PenLine,
  Printer,
  Redo2,
  RotateCw,
  Save,
  Search,
  Square,
  Trash2,
  Type,
  Undo2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import PdfCanvas from "./components/PdfCanvas";
import PageThumbnail from "./components/PageThumbnail";
import SignatureModal from "./components/SignatureModal";
import { downloadBytes, exportEditedPdf } from "./pdf";
import type {
  Annotation,
  EditorPage,
  EditorSnapshot,
  ToastState,
  Tool,
} from "./types";
import {
  clamp,
  cloneSnapshot,
  formatFileSize,
  makeId,
} from "./utils";

GlobalWorkerOptions.workerSrc = pdfWorker;

const tools: Array<{
  id: Tool;
  label: string;
  icon: typeof MousePointer2;
  shortcut?: string;
}> = [
  { id: "select", label: "Select", icon: MousePointer2, shortcut: "V" },
  { id: "text", label: "Add text", icon: Type, shortcut: "T" },
  { id: "highlight", label: "Highlight", icon: Highlighter, shortcut: "H" },
  { id: "draw", label: "Draw", icon: PenLine, shortcut: "D" },
  { id: "rectangle", label: "Rectangle", icon: Square, shortcut: "R" },
  { id: "comment", label: "Comment", icon: MessageSquareText, shortcut: "C" },
  { id: "signature", label: "Sign", icon: AlignLeft, shortcut: "S" },
];

const palette = ["#f2c94c", "#ff6b57", "#4f8cff", "#15a37d", "#17181c"];

const defaultToolColors: Record<Tool, string> = {
  select: "#17181c",
  text: "#17181c",
  highlight: "#f2c94c",
  draw: "#ff6b57",
  rectangle: "#4f8cff",
  comment: "#ffb21c",
  signature: "#17181c",
};

function IconButton({
  label,
  children,
  active = false,
  disabled = false,
  onClick,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${active ? "active" : ""} ${className}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

const createDemoPdf = async () => {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([612, 792]);
  page.drawRectangle({
    x: 0,
    y: 0,
    width: 612,
    height: 792,
    color: rgb(0.965, 0.97, 0.98),
  });
  page.drawRectangle({
    x: 42,
    y: 42,
    width: 528,
    height: 708,
    color: rgb(1, 1, 1),
  });
  page.drawText("PAPERFORGE", {
    x: 72,
    y: 704,
    size: 11,
    font: bold,
    color: rgb(0.11, 0.48, 0.42),
  });
  page.drawText("Project review", {
    x: 72,
    y: 644,
    size: 34,
    font: bold,
    color: rgb(0.09, 0.1, 0.14),
  });
  page.drawText("A sample document ready for annotation", {
    x: 72,
    y: 615,
    size: 14,
    font: regular,
    color: rgb(0.38, 0.4, 0.46),
  });
  page.drawRectangle({
    x: 72,
    y: 566,
    width: 468,
    height: 2,
    color: rgb(0.9, 0.91, 0.93),
  });
  const paragraphs = [
    "Use the tools above to add text, highlights, drawings, comments, shapes, and signatures.",
    "Pages can be reordered, rotated, deleted, or extended with a blank page. Export produces a new flattened PDF.",
    "Everything happens locally in your browser. The document is not uploaded to a server.",
  ];
  paragraphs.forEach((text, index) => {
    page.drawText(text, {
      x: 72,
      y: 510 - index * 72,
      size: 12,
      font: regular,
      color: rgb(0.2, 0.22, 0.27),
      maxWidth: 430,
      lineHeight: 18,
    });
  });
  page.drawRectangle({
    x: 72,
    y: 184,
    width: 468,
    height: 100,
    color: rgb(0.93, 0.97, 0.96),
    borderColor: rgb(0.65, 0.82, 0.78),
    borderWidth: 1,
  });
  page.drawText("Tip", {
    x: 92,
    y: 247,
    size: 11,
    font: bold,
    color: rgb(0.08, 0.43, 0.37),
  });
  page.drawText("Select any annotation to edit or remove it from the inspector.", {
    x: 92,
    y: 219,
    size: 11,
    font: regular,
    color: rgb(0.2, 0.29, 0.28),
  });
  return pdf.save();
};

export default function App() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const historyPast = useRef<EditorSnapshot[]>([]);
  const historyFuture = useRef<EditorSnapshot[]>([]);
  const dragPageIndex = useRef<number | null>(null);

  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [sourceBytes, setSourceBytes] = useState<Uint8Array | null>(null);
  const [pages, setPages] = useState<EditorPage[]>([]);
  const [currentPageId, setCurrentPageId] = useState<string | null>(null);
  const [fileName, setFileName] = useState("Untitled.pdf");
  const [fileSize, setFileSize] = useState(0);
  const [tool, setTool] = useState<Tool>("select");
  const [toolColors, setToolColors] = useState(defaultToolColors);
  const [strokeWidth, setStrokeWidth] = useState(2.5);
  const [fontSize, setFontSize] = useState(15);
  const [zoom, setZoom] = useState(82);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [textIndex, setTextIndex] = useState<string[]>([]);
  const [searchCursor, setSearchCursor] = useState(0);
  const [rightPanelOpen, setRightPanelOpen] = useState(
    () => window.innerWidth > 900,
  );
  const [draggingFile, setDraggingFile] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [inspectorText, setInspectorText] = useState("");
  const [, forceHistoryRender] = useState(0);

  const currentPageIndex = pages.findIndex((page) => page.id === currentPageId);
  const currentPage = pages[currentPageIndex] ?? null;
  const selectedAnnotation =
    currentPage?.annotations.find((annotation) => annotation.id === selectedId) ??
    null;
  const hasPages = pages.length > 0;
  const color = toolColors[tool];
  const setColor = (nextColor: string) => {
    setToolColors((current) => ({ ...current, [tool]: nextColor }));
  };

  useEffect(() => {
    setInspectorText(
      selectedAnnotation?.type === "text" ||
        selectedAnnotation?.type === "comment"
        ? selectedAnnotation.text
        : "",
    );
  }, [selectedAnnotation?.id]);

  const showToast = useCallback(
    (message: string, tone: ToastState["tone"] = "neutral") => {
      const next = { id: Date.now(), message, tone };
      setToast(next);
      window.setTimeout(() => {
        setToast((current) => (current?.id === next.id ? null : current));
      }, 2600);
    },
    [],
  );

  const snapshot = useCallback(
    (): EditorSnapshot => ({
      pages: structuredClone(pages),
      currentPageId,
    }),
    [currentPageId, pages],
  );

  const commit = useCallback(
    (
      update: (currentPages: EditorPage[]) => EditorPage[],
      nextPageId?: string | null,
    ) => {
      historyPast.current.push(cloneSnapshot(snapshot()));
      if (historyPast.current.length > 60) historyPast.current.shift();
      historyFuture.current = [];
      setPages((current) => update(structuredClone(current)));
      if (nextPageId !== undefined) setCurrentPageId(nextPageId);
      forceHistoryRender((value) => value + 1);
    },
    [snapshot],
  );

  const undo = useCallback(() => {
    const previous = historyPast.current.pop();
    if (!previous) return;
    historyFuture.current.push(snapshot());
    setPages(previous.pages);
    setCurrentPageId(previous.currentPageId);
    setSelectedId(null);
    forceHistoryRender((value) => value + 1);
  }, [snapshot]);

  const redo = useCallback(() => {
    const next = historyFuture.current.pop();
    if (!next) return;
    historyPast.current.push(snapshot());
    setPages(next.pages);
    setCurrentPageId(next.currentPageId);
    setSelectedId(null);
    forceHistoryRender((value) => value + 1);
  }, [snapshot]);

  const loadPdfBytes = useCallback(
    async (bytes: Uint8Array, name: string) => {
      setIsLoading(true);
      setSelectedId(null);
      try {
        const loadingTask = getDocument({ data: bytes.slice() });
        const nextDocument = await loadingTask.promise;
        const nextPages: EditorPage[] = [];

        for (let index = 0; index < nextDocument.numPages; index += 1) {
          const sourcePage = await nextDocument.getPage(index + 1);
          const [x1, y1, x2, y2] = sourcePage.view;
          nextPages.push({
            id: makeId("page"),
            sourceIndex: index,
            width: Math.abs(x2 - x1),
            height: Math.abs(y2 - y1),
            rotation: 0,
            annotations: [],
          });
        }

        setDocument(nextDocument);
        setSourceBytes(bytes);
        setPages(nextPages);
        setCurrentPageId(nextPages[0]?.id ?? null);
        setFileName(name.endsWith(".pdf") ? name : `${name}.pdf`);
        setFileSize(bytes.byteLength);
        setZoom(82);
        setTool("select");
        setQuery("");
        setSearchOpen(false);
        setTextIndex([]);
        historyPast.current = [];
        historyFuture.current = [];
        forceHistoryRender((value) => value + 1);
        showToast(`Opened ${name}`, "success");

        void Promise.all(
          Array.from({ length: nextDocument.numPages }, async (_, index) => {
            const sourcePage = await nextDocument.getPage(index + 1);
            const content = await sourcePage.getTextContent();
            return content.items
              .map((item) => ("str" in item ? item.str : ""))
              .join(" ")
              .toLowerCase();
          }),
        ).then(setTextIndex);
      } catch (error) {
        console.error(error);
        showToast(
          "This PDF could not be opened. Password-protected files may need to be unlocked first.",
          "warning",
        );
      } finally {
        setIsLoading(false);
      }
    },
    [showToast],
  );

  const openFile = useCallback(
    async (file: File) => {
      if (
        file.type !== "application/pdf" &&
        !file.name.toLowerCase().endsWith(".pdf")
      ) {
        showToast("Choose a PDF file to continue.", "warning");
        return;
      }
      await loadPdfBytes(new Uint8Array(await file.arrayBuffer()), file.name);
    },
    [loadPdfBytes, showToast],
  );

  const exportPdf = useCallback(async () => {
    if (pages.length === 0) {
      showToast("Open a PDF or add a blank page first.", "warning");
      return null;
    }
    setIsExporting(true);
    try {
      const output = await exportEditedPdf({
        sourceBytes,
        pages,
        title: fileName.replace(/\.pdf$/i, ""),
      });
      return output;
    } catch (error) {
      console.error(error);
      showToast("Export failed. Try reopening the PDF.", "warning");
      return null;
    } finally {
      setIsExporting(false);
    }
  }, [fileName, pages, showToast, sourceBytes]);

  const downloadPdf = useCallback(async () => {
    const bytes = await exportPdf();
    if (!bytes) return;
    const stem = fileName.replace(/\.pdf$/i, "");
    downloadBytes(bytes, `${stem}-edited.pdf`);
    showToast("Edited PDF downloaded", "success");
  }, [exportPdf, fileName, showToast]);

  const printPdf = useCallback(async () => {
    if (pages.length === 0) {
      showToast("Open a PDF or add a blank page first.", "warning");
      return;
    }
    const bytes = await exportPdf();
    if (!bytes) return;
    const url = URL.createObjectURL(
      new Blob([bytes as BlobPart], { type: "application/pdf" }),
    );
    const frame = window.document.createElement("iframe");
    frame.title = "Print PDF";
    frame.style.position = "fixed";
    frame.style.width = "1px";
    frame.style.height = "1px";
    frame.style.right = "0";
    frame.style.bottom = "0";
    frame.style.border = "0";
    frame.style.opacity = "0";

    let printStarted = false;
    const startPrint = () => {
      if (printStarted) return;
      printStarted = true;
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      showToast("Print dialog prepared", "success");
      window.setTimeout(() => {
        frame.remove();
        URL.revokeObjectURL(url);
      }, 60_000);
    };

    frame.onload = startPrint;
    frame.src = url;
    window.document.body.appendChild(frame);
    window.setTimeout(startPrint, 1500);
  }, [exportPdf, pages.length, showToast]);

  const selectTool = (nextTool: Tool) => {
    if (!currentPage) {
      showToast("Open a PDF or add a blank page to use editing tools.", "warning");
      return;
    }
    if (nextTool === "signature" && !signatureData) {
      setSignatureOpen(true);
      return;
    }
    setTool(nextTool);
    if (nextTool !== "select") setSelectedId(null);
  };

  const addAnnotation = (annotation: Annotation) => {
    commit((current) =>
      current.map((page) =>
        page.id === annotation.pageId
          ? { ...page, annotations: [...page.annotations, annotation] }
          : page,
      ),
    );
    setSelectedId(annotation.id);
    setTool("select");
  };

  const updateSelected = (patch: Partial<Annotation>) => {
    if (!selectedId || !currentPageId) return;
    commit((current) =>
      current.map((page) =>
        page.id === currentPageId
          ? {
              ...page,
              annotations: page.annotations.map((annotation) =>
                annotation.id === selectedId
                  ? ({ ...annotation, ...patch } as Annotation)
                  : annotation,
              ),
            }
          : page,
      ),
    );
  };

  const deleteSelected = useCallback(() => {
    if (!selectedId || !currentPageId) return;
    commit((current) =>
      current.map((page) =>
        page.id === currentPageId
          ? {
              ...page,
              annotations: page.annotations.filter(
                (annotation) => annotation.id !== selectedId,
              ),
            }
          : page,
      ),
    );
    setSelectedId(null);
  }, [commit, currentPageId, selectedId]);

  const rotatePage = () => {
    if (!currentPageId) return;
    commit((current) =>
      current.map((page) =>
        page.id === currentPageId
          ? { ...page, rotation: (page.rotation + 90) % 360 }
          : page,
      ),
    );
  };

  const deletePage = () => {
    if (!currentPageId || pages.length <= 1) {
      showToast("A document needs at least one page.", "warning");
      return;
    }
    const nextPages = pages.filter((page) => page.id !== currentPageId);
    const nextIndex = Math.min(currentPageIndex, nextPages.length - 1);
    commit(
      (current) => current.filter((page) => page.id !== currentPageId),
      nextPages[nextIndex].id,
    );
    setSelectedId(null);
  };

  const addBlankPage = () => {
    const blank: EditorPage = {
      id: makeId("page"),
      sourceIndex: null,
      width: 612,
      height: 792,
      rotation: 0,
      annotations: [],
    };
    commit((current) => {
      const insertAt = currentPageIndex < 0 ? current.length : currentPageIndex + 1;
      current.splice(insertAt, 0, blank);
      return current;
    }, blank.id);
    showToast("Blank page added", "success");
  };

  const movePage = (direction: -1 | 1) => {
    if (currentPageIndex < 0) return;
    const target = currentPageIndex + direction;
    if (target < 0 || target >= pages.length) return;
    commit((current) => {
      const [moving] = current.splice(currentPageIndex, 1);
      current.splice(target, 0, moving);
      return current;
    });
  };

  const reorderPage = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0) return;
    commit((current) => {
      const [moving] = current.splice(from, 1);
      current.splice(to, 0, moving);
      return current;
    });
  };

  const fitView = (mode: "page" | "width") => {
    if (!currentPage || !viewerRef.current) return;
    const rotated = currentPage.rotation === 90 || currentPage.rotation === 270;
    const width = rotated ? currentPage.height : currentPage.width;
    const height = rotated ? currentPage.width : currentPage.height;
    const availableWidth = viewerRef.current.clientWidth - 96;
    const availableHeight = viewerRef.current.clientHeight - 84;
    const scale =
      mode === "width"
        ? availableWidth / width
        : Math.min(availableWidth / width, availableHeight / height);
    setZoom(clamp(Math.round((scale / 1.22) * 100), 25, 240));
  };

  const searchMatches = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];
    return textIndex.flatMap((text, sourceIndex) =>
      text.includes(normalized) ? [sourceIndex] : [],
    );
  }, [query, textIndex]);

  const goToSearchResult = useCallback(
    (direction: -1 | 1) => {
      if (searchMatches.length === 0) return;
      const next =
        (searchCursor + direction + searchMatches.length) % searchMatches.length;
      setSearchCursor(next);
      const sourceIndex = searchMatches[next];
      const editorPage = pages.find((page) => page.sourceIndex === sourceIndex);
      if (editorPage) setCurrentPageId(editorPage.id);
    },
    [pages, searchCursor, searchMatches],
  );

  useEffect(() => {
    setSearchCursor(0);
    if (searchMatches[0] !== undefined) {
      const editorPage = pages.find(
        (page) => page.sourceIndex === searchMatches[0],
      );
      if (editorPage) setCurrentPageId(editorPage.id);
    }
  }, [query]); // Intentionally react only to a new query.

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      }
      if (modifier && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
      }
      if (modifier && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void downloadPdf();
      }
      if (modifier && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setSearchOpen(true);
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedId) {
        event.preventDefault();
        deleteSelected();
      }
      if (event.key === "Escape") {
        setSelectedId(null);
        setTool("select");
      }

      const shortcut = tools.find(
        (entry) => entry.shortcut?.toLowerCase() === event.key.toLowerCase(),
      );
      if (!modifier && shortcut) selectTool(shortcut.id);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deleteSelected, downloadPdf, redo, selectedId, signatureData, undo]);

  const newDocument = () => {
    setDocument(null);
    setSourceBytes(null);
    setPages([]);
    setCurrentPageId(null);
    setSelectedId(null);
    setFileName("Untitled.pdf");
    setFileSize(0);
    setTextIndex([]);
    setQuery("");
    setSearchOpen(false);
    setTool("select");
    historyPast.current = [];
    historyFuture.current = [];
  };

  return (
    <main
      className={`editor-app ${draggingFile ? "drag-active" : ""}`}
      onDragEnter={(event) => {
        event.preventDefault();
        setDraggingFile(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        setDraggingFile(false);
        const file = event.dataTransfer.files[0];
        if (file) void openFile(file);
      }}
    >
      <input
        ref={fileInputRef}
        className="sr-only"
        type="file"
        accept=".pdf,application/pdf"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void openFile(file);
          event.target.value = "";
        }}
      />

      <header className="topbar">
        <div className="topbar-left">
          <button
            className="brand-lockup compact"
            onClick={newDocument}
            title="Start a new workspace"
            aria-label="Start a new workspace"
          >
            <span className="brand-mark">
              <span />
            </span>
            <span>Paperforge</span>
          </button>
          <span className="topbar-divider" />
          <div className="file-identity">
            <span className="file-name">{fileName}</span>
            <span className="file-meta">
              {hasPages
                ? `${pages.length} ${pages.length === 1 ? "page" : "pages"} | ${formatFileSize(fileSize)}`
                : "No document loaded"}
            </span>
          </div>
        </div>
        <div className="topbar-actions">
          <IconButton
            label="Search document"
            disabled={!sourceBytes || isLoading}
            onClick={() => setSearchOpen(true)}
          >
            <Search size={18} />
          </IconButton>
          <IconButton
            label="Print"
            disabled={!hasPages || isLoading || isExporting}
            onClick={() => void printPdf()}
          >
            <Printer size={18} />
          </IconButton>
          <button
            className="button button-primary save-button"
            disabled={!hasPages || isLoading || isExporting}
            onClick={() => void downloadPdf()}
          >
            {isExporting ? (
              <span className="spinner" />
            ) : (
              <Download size={17} />
            )}
            {isExporting ? "Exporting" : "Export PDF"}
          </button>
        </div>
      </header>

      <section className="commandbar">
        <div className="command-group">
          <button
            className="button button-quiet"
            disabled={isLoading}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={16} />
            Open
          </button>
          <button
            className="button button-quiet"
            disabled={!hasPages || isLoading || isExporting}
            onClick={() => void downloadPdf()}
          >
            <Save size={16} />
            Save as
          </button>
        </div>
        <span className="command-divider" />
        <div className="command-group tool-group">
          {tools.map((entry) => {
            const ToolIcon = entry.icon;
            return (
              <button
                key={entry.id}
                className={`tool-button ${tool === entry.id ? "active" : ""}`}
                disabled={!currentPage || isLoading}
                onClick={() => selectTool(entry.id)}
                title={`${entry.label}${entry.shortcut ? ` (${entry.shortcut})` : ""}`}
              >
                <ToolIcon size={17} />
                <span>{entry.label}</span>
              </button>
            );
          })}
        </div>
        <span className="command-divider" />
        <div className="command-group history-controls">
          <IconButton
            label="Undo"
            disabled={historyPast.current.length === 0}
            onClick={undo}
          >
            <Undo2 size={17} />
          </IconButton>
          <IconButton
            label="Redo"
            disabled={historyFuture.current.length === 0}
            onClick={redo}
          >
            <Redo2 size={17} />
          </IconButton>
        </div>
        <div className="command-spacer" />
        <IconButton
          label={rightPanelOpen ? "Hide inspector" : "Show inspector"}
          onClick={() => setRightPanelOpen((value) => !value)}
        >
          {rightPanelOpen ? (
            <PanelRightClose size={18} />
          ) : (
            <PanelRightOpen size={18} />
          )}
        </IconButton>
      </section>

      <div
        className={`editor-grid ${rightPanelOpen ? "" : "inspector-hidden"}`}
      >
        <aside className="page-sidebar">
          <div className="sidebar-heading">
            <div>
              <span className="eyebrow">Document</span>
              <strong>Pages</strong>
            </div>
            <IconButton label="Add blank page" onClick={addBlankPage}>
              <FilePlus2 size={17} />
            </IconButton>
          </div>
          <div className="page-actions">
            <IconButton
              label="Move page up"
              disabled={currentPageIndex <= 0}
              onClick={() => movePage(-1)}
            >
              <ArrowUp size={16} />
            </IconButton>
            <IconButton
              label="Move page down"
              disabled={
                currentPageIndex < 0 || currentPageIndex >= pages.length - 1
              }
              onClick={() => movePage(1)}
            >
              <ArrowDown size={16} />
            </IconButton>
            <IconButton
              label="Rotate page"
              disabled={!currentPage}
              onClick={rotatePage}
            >
              <RotateCw size={16} />
            </IconButton>
            <IconButton
              label="Delete page"
              className="danger"
              disabled={pages.length <= 1}
              onClick={deletePage}
            >
              <Trash2 size={16} />
            </IconButton>
          </div>
          <div className="thumbnail-list">
            {pages.map((page, index) => (
              <PageThumbnail
                key={page.id}
                document={document}
                page={page}
                index={index}
                active={page.id === currentPageId}
                draggable={pages.length > 1}
                onClick={() => {
                  setCurrentPageId(page.id);
                  setSelectedId(null);
                }}
                onDragStart={() => {
                  dragPageIndex.current = index;
                }}
                onDrop={() => {
                  if (dragPageIndex.current !== null) {
                    reorderPage(dragPageIndex.current, index);
                    dragPageIndex.current = null;
                  }
                }}
              />
            ))}
          </div>
        </aside>

        <section className="document-stage">
          <div className="stage-status">
            <span>
              {currentPage
                ? `Page ${currentPageIndex + 1} of ${pages.length}`
                : "Workshop ready"}
            </span>
            <span className="privacy-note">
              <span className="status-dot" />
              Local session
            </span>
          </div>
          <div className="viewer-scroll" ref={viewerRef}>
            {currentPage ? (
              <PdfCanvas
                document={document}
                page={currentPage}
                zoom={zoom}
                tool={tool}
                color={color}
                strokeWidth={strokeWidth}
                fontSize={fontSize}
                signatureData={signatureData}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onAddAnnotation={addAnnotation}
              />
            ) : (
              <section className="workshop-empty" aria-labelledby="workshop-title">
                <span className="empty-document-icon">
                  <FileText size={28} />
                </span>
                <span className="eyebrow">PDF workshop</span>
                <h1 id="workshop-title">Open a document to begin</h1>
                <p>
                  Drop a PDF anywhere in this workshop, open one from your
                  computer, or start with a clean blank page.
                </p>
                <div className="workshop-empty-actions">
                  <button
                    className="button button-primary"
                    disabled={isLoading}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload size={17} />
                    Open PDF
                  </button>
                  <button
                    className="button button-secondary"
                    disabled={isLoading}
                    onClick={addBlankPage}
                  >
                    <FilePlus2 size={17} />
                    Blank page
                  </button>
                </div>
                <button
                  className="sample-link"
                  disabled={isLoading}
                  onClick={async () => {
                    const bytes = await createDemoPdf();
                    await loadPdfBytes(bytes, "Paperforge-demo.pdf");
                  }}
                >
                  Use the sample document
                </button>
                <span className="empty-privacy">
                  <span className="status-dot" />
                  Files stay in this browser
                </span>
              </section>
            )}
          </div>
          {currentPage && <div className="view-controls">
            <IconButton
              label="Previous page"
              disabled={currentPageIndex <= 0}
              onClick={() => {
                setCurrentPageId(pages[currentPageIndex - 1].id);
                setSelectedId(null);
              }}
            >
              <ChevronLeft size={17} />
            </IconButton>
            <span className="page-counter">
              {currentPageIndex + 1} / {pages.length}
            </span>
            <IconButton
              label="Next page"
              disabled={currentPageIndex >= pages.length - 1}
              onClick={() => {
                setCurrentPageId(pages[currentPageIndex + 1].id);
                setSelectedId(null);
              }}
            >
              <ChevronRight size={17} />
            </IconButton>
            <span className="view-divider" />
            <IconButton
              label="Zoom out"
              onClick={() => setZoom((value) => clamp(value - 10, 25, 240))}
            >
              <ZoomOut size={17} />
            </IconButton>
            <button
              className="zoom-value"
              onClick={() => fitView("page")}
              title="Fit page"
            >
              {zoom}%
            </button>
            <IconButton
              label="Zoom in"
              onClick={() => setZoom((value) => clamp(value + 10, 25, 240))}
            >
              <ZoomIn size={17} />
            </IconButton>
            <span className="view-divider" />
            <button className="fit-button" onClick={() => fitView("width")}>
              Fit width
            </button>
          </div>}
          {isLoading && (
            <div className="stage-loading" role="status">
              <span className="spinner dark" />
              Opening PDF...
            </div>
          )}
        </section>

        {rightPanelOpen && (
          <aside className="inspector">
            <div className="inspector-heading">
              <div>
                <span className="eyebrow">Inspector</span>
                <strong>
                  {selectedAnnotation ? "Selection" : "Tool settings"}
                </strong>
              </div>
              {selectedAnnotation && (
                <IconButton
                  label="Delete annotation"
                  className="danger"
                  onClick={deleteSelected}
                >
                  <Trash2 size={17} />
                </IconButton>
              )}
            </div>

            {selectedAnnotation ? (
              <div className="inspector-content">
                <div className="selection-type">
                  <span className="selection-icon">
                    {selectedAnnotation.type === "text" ? (
                      <Type size={17} />
                    ) : selectedAnnotation.type === "comment" ? (
                      <MessageSquareText size={17} />
                    ) : selectedAnnotation.type === "draw" ? (
                      <PenLine size={17} />
                    ) : selectedAnnotation.type === "highlight" ? (
                      <Highlighter size={17} />
                    ) : selectedAnnotation.type === "signature" ? (
                      <AlignLeft size={17} />
                    ) : (
                      <Square size={17} />
                    )}
                  </span>
                  <span>
                    <small>Annotation</small>
                    <strong>{selectedAnnotation.type}</strong>
                  </span>
                </div>

                {(selectedAnnotation.type === "text" ||
                  selectedAnnotation.type === "comment") && (
                  <label className="field">
                    <span>Content</span>
                    <textarea
                      value={inspectorText}
                      onChange={(event) => setInspectorText(event.target.value)}
                      onBlur={() => {
                        const next = inspectorText.trim();
                        if (next && next !== selectedAnnotation.text) {
                          updateSelected({ text: next });
                        } else if (!next) {
                          setInspectorText(selectedAnnotation.text);
                        }
                      }}
                      onKeyDown={(event) => {
                        if (
                          (event.metaKey || event.ctrlKey) &&
                          event.key === "Enter"
                        ) {
                          event.currentTarget.blur();
                        }
                      }}
                    />
                  </label>
                )}

                {selectedAnnotation.type !== "signature" &&
                  selectedAnnotation.type !== "comment" && (
                    <div className="field">
                      <span>Color</span>
                      <div className="color-row">
                        {palette.map((swatch) => (
                          <button
                            key={swatch}
                            className={`color-swatch ${
                              selectedAnnotation.color === swatch ? "active" : ""
                            }`}
                            style={{ backgroundColor: swatch }}
                            onClick={() => updateSelected({ color: swatch })}
                            aria-label={`Set color ${swatch}`}
                          />
                        ))}
                        <input
                          type="color"
                          value={selectedAnnotation.color}
                          onChange={(event) =>
                            updateSelected({ color: event.target.value })
                          }
                          aria-label="Custom color"
                        />
                      </div>
                    </div>
                  )}

                {selectedAnnotation.type === "text" && (
                  <label className="field">
                    <span>Font size</span>
                    <div className="range-row">
                      <input
                        type="range"
                        min="8"
                        max="48"
                        value={selectedAnnotation.fontSize}
                        onChange={(event) =>
                          updateSelected({
                            fontSize: Number(event.target.value),
                          })
                        }
                      />
                      <output>{selectedAnnotation.fontSize} pt</output>
                    </div>
                  </label>
                )}

                {(selectedAnnotation.type === "draw" ||
                  selectedAnnotation.type === "rectangle") && (
                  <label className="field">
                    <span>Stroke</span>
                    <div className="range-row">
                      <input
                        type="range"
                        min="1"
                        max="10"
                        step="0.5"
                        value={selectedAnnotation.width}
                        onChange={(event) =>
                          updateSelected({ width: Number(event.target.value) })
                        }
                      />
                      <output>{selectedAnnotation.width}px</output>
                    </div>
                  </label>
                )}

                <div className="inspector-hint">
                  <MousePointer2 size={16} />
                  Press Delete to remove this annotation.
                </div>
              </div>
            ) : (
              <div className="inspector-content">
                <div className="active-tool-card">
                  <span className="active-tool-icon">
                    {(() => {
                      const ActiveIcon =
                        tools.find((entry) => entry.id === tool)?.icon ??
                        MousePointer2;
                      return <ActiveIcon size={20} />;
                    })()}
                  </span>
                  <span>
                    <small>Active tool</small>
                    <strong>
                      {tools.find((entry) => entry.id === tool)?.label}
                    </strong>
                  </span>
                  <ChevronDown size={16} />
                </div>

                {tool !== "select" &&
                  tool !== "signature" &&
                  tool !== "comment" && (
                    <div className="field">
                      <span>Color</span>
                      <div className="color-row">
                        {palette.map((swatch) => (
                          <button
                            key={swatch}
                            className={`color-swatch ${
                              color === swatch ? "active" : ""
                            }`}
                            style={{ backgroundColor: swatch }}
                            onClick={() => setColor(swatch)}
                            aria-label={`Set color ${swatch}`}
                          />
                        ))}
                        <input
                          type="color"
                          value={color}
                          onChange={(event) => setColor(event.target.value)}
                          aria-label="Custom color"
                        />
                      </div>
                    </div>
                  )}

                {tool === "text" && (
                  <label className="field">
                    <span>Font size</span>
                    <div className="range-row">
                      <input
                        type="range"
                        min="8"
                        max="48"
                        value={fontSize}
                        onChange={(event) => setFontSize(Number(event.target.value))}
                      />
                      <output>{fontSize} pt</output>
                    </div>
                  </label>
                )}

                {(tool === "draw" || tool === "rectangle") && (
                  <label className="field">
                    <span>Stroke</span>
                    <div className="range-row">
                      <input
                        type="range"
                        min="1"
                        max="10"
                        step="0.5"
                        value={strokeWidth}
                        onChange={(event) =>
                          setStrokeWidth(Number(event.target.value))
                        }
                      />
                      <output>{strokeWidth}px</output>
                    </div>
                  </label>
                )}

                <div className="quick-actions">
                  <button disabled={!currentPage} onClick={rotatePage}>
                    <RotateCw size={17} />
                    Rotate page
                  </button>
                  <button onClick={addBlankPage}>
                    <FilePlus2 size={17} />
                    Add page
                  </button>
                </div>

                <div className="comments-section">
                  <div className="section-title">
                    <span>Comments</span>
                    <span className="count-badge">
                      {currentPage?.annotations.filter(
                        (annotation) => annotation.type === "comment",
                      ).length ?? 0}
                    </span>
                  </div>
                  {currentPage?.annotations.filter(
                    (annotation) => annotation.type === "comment",
                  ).length ? (
                    currentPage.annotations
                      .filter((annotation) => annotation.type === "comment")
                      .map((annotation) => (
                        <button
                          className="comment-card"
                          key={annotation.id}
                          onClick={() => {
                            setSelectedId(annotation.id);
                            setTool("select");
                          }}
                        >
                          <span className="comment-avatar">Y</span>
                          <span>
                            <strong>You</strong>
                            <small>{annotation.text}</small>
                          </span>
                        </button>
                      ))
                  ) : (
                    <div className="empty-comments">
                      <MessageSquareText size={22} />
                      <p>No comments on this page.</p>
                      <button
                        disabled={!currentPage}
                        onClick={() => selectTool("comment")}
                      >
                        Add a comment
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </aside>
        )}
      </div>

      {searchOpen && (
        <div className="search-popover">
          <Search size={17} />
          <input
            autoFocus
            value={query}
            placeholder="Search this PDF"
            onChange={(event) => setQuery(event.target.value)}
          />
          <span className="search-count">
            {query
              ? searchMatches.length
                ? `${searchCursor + 1}/${searchMatches.length}`
                : "0/0"
              : ""}
          </span>
          <IconButton
            label="Previous match"
            disabled={searchMatches.length === 0}
            onClick={() => goToSearchResult(-1)}
          >
            <ChevronLeft size={16} />
          </IconButton>
          <IconButton
            label="Next match"
            disabled={searchMatches.length === 0}
            onClick={() => goToSearchResult(1)}
          >
            <ChevronRight size={16} />
          </IconButton>
          <IconButton label="Close search" onClick={() => setSearchOpen(false)}>
            <X size={16} />
          </IconButton>
        </div>
      )}

      <SignatureModal
        open={signatureOpen}
        onClose={() => setSignatureOpen(false)}
        onSave={(dataUrl) => {
          setSignatureData(dataUrl);
          setSignatureOpen(false);
          setTool("signature");
          showToast("Drag on the page to place your signature.", "success");
        }}
      />

      {draggingFile && (
        <div
          className="drop-overlay"
          onDragLeave={() => setDraggingFile(false)}
        >
          <Upload size={30} />
          <strong>Release to open a new PDF</strong>
        </div>
      )}
      {toast && <div className={`toast ${toast.tone}`}>{toast.message}</div>}
    </main>
  );
}
