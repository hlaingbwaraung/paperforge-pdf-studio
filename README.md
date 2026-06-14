# Paperforge PDF Studio

Paperforge is a private, browser-based PDF editor with an Adobe Reader-inspired
workspace and a distinct visual identity. Files stay on the device; no document
upload service or account is required.

## Features

- Open local PDF files or use the built-in sample
- Crisp PDF.js rendering with thumbnails, zoom, fit, and text search
- Add text, highlights, freehand drawing, rectangles, comments, and signatures
- Select annotations to update their content, color, size, or stroke
- Reorder, rotate, delete, and insert blank pages
- Undo and redo editor operations
- Print or export a flattened edited PDF
- Responsive desktop and mobile workspace

## Local development

```bash
npm install
npm run dev
```

Create a production build with:

```bash
npm run build
```

## Privacy

PDF parsing, annotation, page operations, and export run in the browser. The
deployed site does not receive or store opened documents.

## Limitations

Paperforge adds and flattens annotations, signatures, and page-level edits. It
does not replace arbitrary text already embedded inside a PDF or bypass PDF
password protection.
