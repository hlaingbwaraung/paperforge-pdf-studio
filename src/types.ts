export type Tool =
  | "select"
  | "text"
  | "highlight"
  | "draw"
  | "rectangle"
  | "comment"
  | "signature";

export type PdfPoint = {
  x: number;
  y: number;
};

export type AnnotationBase = {
  id: string;
  pageId: string;
  color: string;
  createdAt: number;
};

export type TextAnnotation = AnnotationBase & {
  type: "text";
  x: number;
  y: number;
  text: string;
  fontSize: number;
};

export type ShapeAnnotation = AnnotationBase & {
  type: "highlight" | "rectangle";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
};

export type DrawAnnotation = AnnotationBase & {
  type: "draw";
  points: PdfPoint[];
  width: number;
};

export type CommentAnnotation = AnnotationBase & {
  type: "comment";
  x: number;
  y: number;
  text: string;
};

export type SignatureAnnotation = AnnotationBase & {
  type: "signature";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  dataUrl: string;
};

export type Annotation =
  | TextAnnotation
  | ShapeAnnotation
  | DrawAnnotation
  | CommentAnnotation
  | SignatureAnnotation;

export type EditorPage = {
  id: string;
  sourceIndex: number | null;
  width: number;
  height: number;
  rotation: number;
  annotations: Annotation[];
};

export type EditorSnapshot = {
  pages: EditorPage[];
  currentPageId: string | null;
};

export type ToastState = {
  id: number;
  message: string;
  tone?: "success" | "warning" | "neutral";
};
