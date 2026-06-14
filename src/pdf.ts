import { degrees, PDFDocument, rgb, StandardFonts } from "pdf-lib";
import type { Annotation, EditorPage } from "./types";
import { hexToRgb } from "./utils";

type ExportOptions = {
  sourceBytes: Uint8Array;
  pages: EditorPage[];
  title: string;
};

const drawAnnotation = async (
  output: PDFDocument,
  page: ReturnType<PDFDocument["addPage"]>,
  annotation: Annotation,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
) => {
  const color = hexToRgb(annotation.color);
  const pdfColor = rgb(color.r, color.g, color.b);

  if (annotation.type === "text") {
    const lines = annotation.text.split("\n");
    lines.forEach((line, index) => {
      page.drawText(line || " ", {
        x: annotation.x,
        y: annotation.y - annotation.fontSize - index * annotation.fontSize * 1.25,
        size: annotation.fontSize,
        font,
        color: pdfColor,
      });
    });
  }

  if (annotation.type === "highlight" || annotation.type === "rectangle") {
    const x = Math.min(annotation.x1, annotation.x2);
    const y = Math.min(annotation.y1, annotation.y2);
    const width = Math.abs(annotation.x2 - annotation.x1);
    const height = Math.abs(annotation.y2 - annotation.y1);

    page.drawRectangle({
      x,
      y,
      width,
      height,
      color: annotation.type === "highlight" ? pdfColor : undefined,
      borderColor: annotation.type === "rectangle" ? pdfColor : undefined,
      borderWidth: annotation.type === "rectangle" ? annotation.width : 0,
      opacity: annotation.type === "highlight" ? 0.28 : 1,
    });
  }

  if (annotation.type === "draw") {
    for (let index = 1; index < annotation.points.length; index += 1) {
      page.drawLine({
        start: annotation.points[index - 1],
        end: annotation.points[index],
        thickness: annotation.width,
        color: pdfColor,
        opacity: 0.92,
      });
    }
  }

  if (annotation.type === "comment") {
    page.drawCircle({
      x: annotation.x,
      y: annotation.y,
      size: 8,
      color: rgb(1, 0.68, 0.12),
      borderColor: rgb(0.55, 0.31, 0.02),
      borderWidth: 1,
    });
    page.drawText("!", {
      x: annotation.x - 1.8,
      y: annotation.y - 3.5,
      size: 9,
      font,
      color: rgb(0.2, 0.12, 0.01),
    });
    page.drawText(annotation.text.slice(0, 120), {
      x: annotation.x + 12,
      y: annotation.y - 4,
      size: 8,
      font,
      color: rgb(0.22, 0.18, 0.12),
      maxWidth: 180,
      lineHeight: 10,
    });
  }

  if (annotation.type === "signature") {
    const image = await output.embedPng(annotation.dataUrl);
    const x = Math.min(annotation.x1, annotation.x2);
    const y = Math.min(annotation.y1, annotation.y2);
    page.drawImage(image, {
      x,
      y,
      width: Math.abs(annotation.x2 - annotation.x1),
      height: Math.abs(annotation.y2 - annotation.y1),
    });
  }
};

export const exportEditedPdf = async ({
  sourceBytes,
  pages,
  title,
}: ExportOptions) => {
  const source = await PDFDocument.load(sourceBytes, { ignoreEncryption: true });
  const output = await PDFDocument.create();
  const font = await output.embedFont(StandardFonts.Helvetica);

  output.setTitle(title);
  output.setCreator("Paperforge PDF Studio");
  output.setProducer("Paperforge PDF Studio");

  for (const editorPage of pages) {
    let page: ReturnType<PDFDocument["addPage"]>;

    if (editorPage.sourceIndex === null) {
      page = output.addPage([editorPage.width, editorPage.height]);
    } else {
      const [copiedPage] = await output.copyPages(source, [editorPage.sourceIndex]);
      page = output.addPage(copiedPage);
    }

    for (const annotation of editorPage.annotations) {
      await drawAnnotation(output, page, annotation, font);
    }

    const baseRotation = page.getRotation().angle;
    page.setRotation(degrees((baseRotation + editorPage.rotation) % 360));
  }

  return output.save();
};

export const downloadBytes = (bytes: Uint8Array, fileName: string) => {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};
