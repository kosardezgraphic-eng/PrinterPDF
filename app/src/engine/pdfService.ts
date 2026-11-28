/**
 * PrintStudio Pro — Real PDF & Image Import, Thumbnail Generator,
 * Imposition Vector Merger & Splitter Engine (A1, A4, C1, C2, D1-D5, E1, F1-F2)
 */

import {
  BlendMode,
  LineCapStyle,
  PDFArray,
  PDFName,
  PDFNumber,
  PDFRawStream,
  clip,
  concatTransformationMatrix,
  endPath,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  PDFDocument,
  StandardFonts,
  degrees,
  rgb,
} from 'pdf-lib';
import type {
  BookmarkItem,
  DetectedDocumentBoundaries,
  EffectsSettings,
  LayoutSettings,
  PageItem,
  PageOverlay,
  PageNumberSettings,
  PdfExportOptions,
  ScanDeskewInfo,
  SourceDocument,
  WatermarkSettings,
} from '@shared/models';
import { drawOverlayText, textPlacements } from './textOverlays';
import { imagePlacements, imageDrawRect, shapePlacements } from './overlayPlacements';
import { MM_PER_PT, shapeColorComponents, shapeCommands, shapeDashPattern, shapeHasFill, shapeSvgPath } from './shapes';
import { rasterizeOverlayImage } from './imageImport';
import { eraseSignature } from './imageErase';
import { inspectJpeg, inspectPng, planPictureEmbedding } from './imageFormat';
import { computeImpositionSheets, sortCellsByLayer, stripTrailingEmptyDuplexSides } from './layoutEngine';
import { normalizeAngle, pageCropFractions, rotateInsets } from './pageGeometry';
import { applyEffectsToRgbaBuffer, resolvePageEffects, type ResolvedPageEffects } from './effectsPipeline';
import { formatPageNumberLabel, resolveTextMacros } from './watermarkEngine';
import { globalThumbnailCache } from './pageCache';
import {
  autoDeskewDecodedImage,
  detectRawScanBoundariesFromEncodedBytes,
  toDetectedDocumentBoundaries,
} from './scanBoundaryDetector';
import {
  decodeUniversalImageToPages,
  decodedPageToDataUrl,
  isSupportedImageFileNameOrType,
} from './universalImageDecoder';
import {
  type RealPdfPageAnalysis,
} from './pdfRealRenderer';
import type {
  PdfWorkerRequest,
  PdfWorkerResponse,
} from './pdfRendererWorker';

const MM_TO_PT = 72 / 25.4; // 1 mm = 2.83464567 pt

/** The preview uses the model value directly, so the PDF must not clamp it differently. */
function clampOpacity(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
}

/**
 * Overrides the `Decode` array pdf-lib puts on a CMYK JPEG image. `0 1 0 1 …` means "the samples
 * already run from no ink to full ink", which is what a plain CMYK stream stores. pdf-lib only
 * writes the stream when the image is first drawn, so the embed has to be forced here.
 */
async function applyCmykDecode(doc: PDFDocument, image: Awaited<ReturnType<PDFDocument['embedJpg']>>): Promise<void> {
  await image.embed();
  const stream = doc.context.lookup(image.ref);
  if (!(stream instanceof PDFRawStream)) return;
  const decode = PDFArray.withContext(doc.context);
  for (const value of [0, 1, 0, 1, 0, 1, 0, 1]) decode.push(PDFNumber.of(value));
  stream.dict.set(PDFName.of('Decode'), decode);
}

/** Adds an RGB Page Transparency Group so PDF viewers composite BlendMode.Difference reliably. */
function ensureTransparencyGroup(doc: PDFDocument, page: ReturnType<PDFDocument['addPage']>): void {
  if (!page.node.get(PDFName.of('Group'))) {
    page.node.set(
      PDFName.of('Group'),
      doc.context.obj({
        Type: PDFName.of('Group'),
        S: PDFName.of('Transparency'),
        CS: PDFName.of('DeviceRGB'),
      })
    );
  }
}

type PdfJsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
type PdfJsDocumentProxy = Awaited<ReturnType<PdfJsModule['getDocument']>['promise']>;

const standardPdfFonts =
  typeof import.meta.glob === 'function'
    ? import.meta.glob<string>('../../../node_modules/pdfjs-dist/standard_fonts/*.{ttf,pfb}', {
        eager: true,
        query: '?url&inline',
        import: 'default',
      })
    : {};

class BundledStandardFontFactory {
  async fetch({ filename }: { filename: string }) {
    const entry = Object.entries(standardPdfFonts).find(([name]) => name.endsWith(`/${filename}`));
    if (!entry) throw new Error(`PDF standard font unavailable: ${filename}`);
    const response = await fetch(entry[1]);
    if (!response.ok) throw new Error(`Failed to load PDF standard font: ${filename}`);
    return new Uint8Array(await response.arrayBuffer());
  }
}

interface Canvas2DSurface {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
}

async function loadPdfJsLib(): Promise<PdfJsModule> {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (!(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
    const workerMod = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerMod.default;
  }
  return pdfjsLib;
}

function createCanvas2DSurface(width: number, height: number): Canvas2DSurface | null {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  if (typeof document !== 'undefined') {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (ctx) return { canvas, ctx };
    } catch {
      // fall through to OffscreenCanvas
    }
  }
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d');
      if (ctx) return { canvas, ctx };
    } catch {
      // unavailable
    }
  }
  return null;
}

async function surfaceToPngBytes(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Uint8Array> {
  const anyCanvas = canvas as unknown as {
    convertToBlob?: (opts?: { type?: string }) => Promise<Blob>;
    toBlob?: (cb: (blob: Blob | null) => void, type?: string) => void;
    encode?: (type: 'png') => Promise<Uint8Array | ArrayBuffer>;
    toDataURL?: (type?: string) => string;
  };
  if (typeof anyCanvas.convertToBlob === 'function') {
    const blob = await anyCanvas.convertToBlob({ type: 'image/png' });
    return new Uint8Array(await blob.arrayBuffer());
  }
  if (typeof anyCanvas.toBlob === 'function') {
    const blob = await new Promise<Blob>((resolve, reject) => {
      anyCanvas.toBlob!((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png');
    });
    return new Uint8Array(await blob.arrayBuffer());
  }
  if (typeof anyCanvas.encode === 'function') {
    const encoded = await anyCanvas.encode('png');
    return new Uint8Array(encoded);
  }
  if (typeof anyCanvas.toDataURL === 'function') {
    const dataUrl = anyCanvas.toDataURL('image/png');
    const commaIdx = dataUrl.indexOf(',');
    if (commaIdx >= 0) {
      const bin = atob(dataUrl.slice(commaIdx + 1));
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
  }
  throw new Error('Canvas PNG export is unavailable');
}

function yieldPdfExportTurn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function surfaceToJpegBytes(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  quality = 0.85
): Promise<{ bytes: Uint8Array; format: 'jpeg' | 'png' }> {
  const anyCanvas = canvas as unknown as {
    convertToBlob?: (opts?: { type?: string; quality?: number }) => Promise<Blob>;
    toBlob?: (cb: (blob: Blob | null) => void, type?: string, quality?: number) => void;
    toDataURL?: (type?: string, quality?: number) => string;
  };
  try {
    if (typeof anyCanvas.convertToBlob === 'function') {
      const blob = await anyCanvas.convertToBlob({ type: 'image/jpeg', quality });
      if (blob.type === 'image/jpeg' || blob.size > 0) {
        return { bytes: new Uint8Array(await blob.arrayBuffer()), format: 'jpeg' };
      }
    }
    if (typeof anyCanvas.toBlob === 'function') {
      const blob = await new Promise<Blob>((resolve, reject) => {
        anyCanvas.toBlob!((b) => (b ? resolve(b) : reject(new Error('JPEG encoding failed'))), 'image/jpeg', quality);
      });
      if (blob.type === 'image/jpeg' || blob.size > 0) {
        return { bytes: new Uint8Array(await blob.arrayBuffer()), format: 'jpeg' };
      }
    }
    if (typeof anyCanvas.toDataURL === 'function') {
      const dataUrl = anyCanvas.toDataURL('image/jpeg', quality);
      if (dataUrl.startsWith('data:image/jpeg')) {
        const commaIdx = dataUrl.indexOf(',');
        if (commaIdx >= 0) {
          const bin = atob(dataUrl.slice(commaIdx + 1));
          const out = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
          return { bytes: out, format: 'jpeg' };
        }
      }
    }
  } catch {
    // Fall back cleanly to PNG in headless/mock Canvas environments
  }
  return { bytes: await surfaceToPngBytes(canvas), format: 'png' };
}

async function decodeImageSource(
  bytes: Uint8Array,
  mimeType: string
): Promise<{ source: CanvasImageSource; width: number; height: number; cleanup?: () => void }> {
  const safeBytes = new Uint8Array(bytes);
  const type = mimeType || 'image/png';
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(new Blob([safeBytes], { type }));
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      cleanup: () => bitmap.close?.(),
    };
  }
  if (typeof Image !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    const url = URL.createObjectURL(new Blob([safeBytes], { type }));
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        resolve({
          source: img,
          width: img.naturalWidth || img.width,
          height: img.naturalHeight || img.height,
          cleanup: () => URL.revokeObjectURL(url),
        });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to decode source image for effects export'));
      };
      img.src = url;
    });
  }
  throw new Error('Image decoding is unavailable in this environment');
}

function buildResolvedEffectsKey(r: ResolvedPageEffects): string {
  return [
    r.applyGlobal ? 1 : 0,
    r.effectiveInvert ? 1 : 0,
    r.effectiveGrayscale ? 1 : 0,
    r.effectiveBlackAndWhite ? 1 : 0,
    r.brightness,
    r.contrast,
    r.gamma,
    r.blackText ? 1 : 0,
    r.threshold,
  ].join(':');
}

function parseCssColorRgba(color: string): { r: number; g: number; b: number; alpha: number } | null {
  const trimmed = color.trim();
  if (!trimmed || trimmed === 'transparent') return null;
  if (trimmed.startsWith('#')) {
    const hex = trimmed.slice(1);
    if (/^[0-9a-f]{3}$/i.test(hex)) {
      return {
        r: parseInt(hex[0] + hex[0], 16) / 255,
        g: parseInt(hex[1] + hex[1], 16) / 255,
        b: parseInt(hex[2] + hex[2], 16) / 255,
        alpha: 1,
      };
    }
    if (/^[0-9a-f]{6}$/i.test(hex)) {
      return {
        r: parseInt(hex.slice(0, 2), 16) / 255,
        g: parseInt(hex.slice(2, 4), 16) / 255,
        b: parseInt(hex.slice(4, 6), 16) / 255,
        alpha: 1,
      };
    }
    if (/^[0-9a-f]{8}$/i.test(hex)) {
      return {
        r: parseInt(hex.slice(0, 2), 16) / 255,
        g: parseInt(hex.slice(2, 4), 16) / 255,
        b: parseInt(hex.slice(4, 6), 16) / 255,
        alpha: parseInt(hex.slice(6, 8), 16) / 255,
      };
    }
    return null;
  }
  const rgbMatch = trimmed.match(
    /^rgba?\(\s*(\d+(?:\.\d+)?)\s*[,\s]\s*(\d+(?:\.\d+)?)\s*[,\s]\s*(\d+(?:\.\d+)?)(?:\s*[,/]\s*(\d*(?:\.\d+)?%?))?\s*\)$/i
  );
  if (rgbMatch) {
    const r = Math.max(0, Math.min(255, Number(rgbMatch[1]))) / 255;
    const g = Math.max(0, Math.min(255, Number(rgbMatch[2]))) / 255;
    const b = Math.max(0, Math.min(255, Number(rgbMatch[3]))) / 255;
    let alpha = 1;
    if (rgbMatch[4] !== undefined) {
      alpha = rgbMatch[4].endsWith('%')
        ? Math.max(0, Math.min(100, Number(rgbMatch[4].slice(0, -1)))) / 100
        : Math.max(0, Math.min(1, Number(rgbMatch[4])));
    }
    return { r, g, b, alpha };
  }
  return null;
}

type VisualTextToken =
  | { kind: 'glyph'; text: string; isRtl: boolean }
  | { kind: 'space'; text: string };

const ANY_DIGIT_REGEX = /[0-9\u06F0-\u06F9\u0660-\u0669]/;
const DIGIT_RUN_ONLY_REGEX = /^[0-9\u06F0-\u06F9\u0660-\u0669]+$/;
const RTL_UNSAFE_DECOMPOSE_REGEX = /[A-Za-z()[\]{}<>\u200E\u200F\u202A-\u202E\u2066-\u2069]/;
const RTL_NON_LETTER_ADJ_BEFORE_DIGIT =
  /[^\s\u0621-\u064A\u0671-\u06D50-9\u06F0-\u06F9\u0660-\u0669][0-9\u06F0-\u06F9\u0660-\u0669]/;
const RTL_NON_LETTER_ADJ_AFTER_DIGIT =
  /[0-9\u06F0-\u06F9\u0660-\u0669][^\s\u0621-\u064A\u0671-\u06D50-9\u06F0-\u06F9\u0660-\u0669]/;
const RTL_TOKEN_SPLIT_REGEX =
  /(\s+|[0-9\u06F0-\u06F9\u0660-\u0669]+|[^\s0-9\u06F0-\u06F9\u0660-\u0669]+)/g;
const LTR_TOKEN_SPLIT_REGEX = /(\s+|[0-9\u06F0-\u06F9\u0660-\u0669]|[^\s0-9\u06F0-\u06F9\u0660-\u0669]+)/g;

function decomposeVisualTextTokens(text: string): VisualTextToken[] | null {
  if (!text || !ANY_DIGIT_REGEX.test(text)) return null;
  const hasRtl = /[\u0590-\u08ff]/.test(text);
  if (!hasRtl) {
    const out: VisualTextToken[] = [];
    const parts = text.match(LTR_TOKEN_SPLIT_REGEX);
    if (!parts || parts.length === 0) return null;
    for (const part of parts) {
      if (/^\s+$/.test(part)) {
        out.push({ kind: 'space', text: part });
      } else {
        out.push({ kind: 'glyph', text: part, isRtl: false });
      }
    }
    return out;
  }

  if (
    RTL_UNSAFE_DECOMPOSE_REGEX.test(text) ||
    RTL_NON_LETTER_ADJ_BEFORE_DIGIT.test(text) ||
    RTL_NON_LETTER_ADJ_AFTER_DIGIT.test(text)
  ) {
    return null;
  }

  const parts = text.match(RTL_TOKEN_SPLIT_REGEX);
  if (!parts || parts.length === 0) return null;

  const out: VisualTextToken[] = [];
  // Visual left-to-right order in an RTL base paragraph reverses logical segment order,
  // while digits inside each number run remain left-to-right.
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (/^\s+$/.test(part)) {
      out.push({ kind: 'space', text: part });
    } else if (DIGIT_RUN_ONLY_REGEX.test(part)) {
      for (let d = 0; d < part.length; d++) {
        out.push({ kind: 'glyph', text: part[d], isRtl: false });
      }
    } else {
      out.push({ kind: 'glyph', text: part, isRtl: true });
    }
  }
  return out;
}

export interface ImportErrorItem {
  fileName: string;
  reasonFa: string;
  solutionFa: string;
  reasonEn: string;
  solutionEn: string;
}

export interface ImportBatchResult {
  documents: SourceDocument[];
  pages: PageItem[];
  bookmarks: BookmarkItem[];
  errors: ImportErrorItem[];
}

/** Render PDFs in a dedicated worker; failures are reported to the importer. */
async function analyzePdfOffThread(pdfBytes: Uint8Array, fileName: string): Promise<RealPdfPageAnalysis[]> {
  if (typeof Worker === 'undefined') throw new Error('PDF rendering requires Web Worker support');
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./pdfRendererWorker.ts', import.meta.url), { type: 'module' });
    const id = `pdf-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const finish = () => worker.terminate();
    worker.onmessage = (event: MessageEvent<PdfWorkerResponse>) => {
      if (event.data.id !== id) return;
      if (event.data.type === 'analyze-pdf-result' && event.data.pages) {
        finish(); resolve(event.data.pages);
      } else if (event.data.type === 'analyze-pdf-error') {
        finish(); reject(new Error(event.data.errorMessage || 'PDF worker failed'));
      }
    };
    worker.onerror = event => { finish(); reject(new Error(event.message || 'PDF worker failed')); };
    worker.onmessageerror = () => { finish(); reject(new Error('Invalid PDF worker response')); };
    const payload: PdfWorkerRequest = { id, type: 'analyze-pdf', fileName, pdfBytes: new Uint8Array(pdfBytes) };
    worker.postMessage(payload, [payload.pdfBytes.buffer]);
  });
}

/**
 * Generates a crisp SVG data URL thumbnail for blank or synthesized pages.
 */
export function buildCrispPageSvgDataUrl(opts: {
  title: string;
  subtitle: string;
  pageNumber: number;
  totalPages: number;
  widthMm: number;
  heightMm: number;
  colorProfile: 'color' | 'grayscale' | 'blank';
  accentColor: string;
  lines: string[];
}): string {
  if (opts.colorProfile === 'blank') {
    const blankSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 297" width="210" height="297">
      <rect width="210" height="297" fill="#ffffff"/>
      <rect x="8" y="8" width="194" height="281" fill="none" stroke="#e2e8f0" stroke-dasharray="4 4"/>
      <text x="105" y="150" text-anchor="middle" fill="#94a3b8" font-family="sans-serif" font-size="10">صفحه خالی / Blank Page</text>
    </svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(blankSvg)}`;
  }

  const w = Math.round(opts.widthMm);
  const h = Math.round(opts.heightMm);
  const primary = opts.colorProfile === 'grayscale' ? '#334155' : opts.accentColor;
  const secondary = opts.colorProfile === 'grayscale' ? '#64748b' : '#0284c7';

  const lineElements = opts.lines
    .slice(0, 7)
    .map(
      (txt, idx) =>
        `<text x="${w - 16}" y="${78 + idx * 18}" text-anchor="end" fill="#1e293b" font-family="Tahoma, sans-serif" font-size="8.5">${escapeXml(
          txt
        )}</text>`
    )
    .join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="#ffffff"/>
    <rect x="10" y="10" width="${w - 20}" height="32" rx="4" fill="${primary}" fill-opacity="0.12" stroke="${primary}" stroke-width="1"/>
    <text x="${w - 16}" y="25" text-anchor="end" fill="${primary}" font-family="Tahoma, sans-serif" font-weight="bold" font-size="10">${escapeXml(
      opts.title
    )}</text>
    <text x="${w - 16}" y="37" text-anchor="end" fill="#475569" font-family="Tahoma, sans-serif" font-size="7.5">${escapeXml(
      opts.subtitle
    )}</text>
    <line x1="14" y1="54" x2="${w - 14}" y2="54" stroke="${primary}" stroke-width="0.75" stroke-opacity="0.4"/>
    ${lineElements}
    <rect x="14" y="${h - 78}" width="${w - 28}" height="44" rx="4" fill="${secondary}" fill-opacity="0.08" stroke="${secondary}" stroke-width="0.8"/>
    <circle cx="36" cy="${h - 56}" r="12" fill="${primary}" fill-opacity="0.2" stroke="${primary}" stroke-width="1.2"/>
    <path d="M 56 ${h - 46} L 76 ${h - 66} L 96 ${h - 52} L 122 ${h - 70} L ${w - 24} ${h - 46}" fill="none" stroke="${primary}" stroke-width="1.5"/>
    <text x="${w / 2}" y="${h - 14}" text-anchor="middle" fill="#64748b" font-family="sans-serif" font-size="8">Page ${
      opts.pageNumber
    } / ${opts.totalPages} • ${w}×${h}mm</text>
  </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Imports user-dropped or selected File objects (PDFs & Images).
 * Uses pdfjs-dist to genuinely render and analyze every PDF page.
 * Corrupt files are isolated and reported with actionable Persian solutions (Principle #1).
 */
export async function importFilesBatch(
  files: File[],
  onProgress?: (current: number, total: number, fileName: string) => void,
  options?: { autoDeskew?: boolean }
): Promise<ImportBatchResult> {
  const autoDeskew = options?.autoDeskew ?? true;
  const documents: SourceDocument[] = [];
  const pages: PageItem[] = [];
  const bookmarks: BookmarkItem[] = [];
  const errors: ImportErrorItem[] = [];
  const importedImageBatches: Array<{
    docId: string;
    fileName: string;
    firstPageId: string;
    firstPageIndex: number;
    docIds: string[];
    pageIds: string[];
  }> = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress?.(i + 1, files.length, file.name);

    try {
      const lower = file.name.toLowerCase();
      const bytes = new Uint8Array(await file.arrayBuffer());

      if (bytes.byteLength === 0) {
        throw new Error('EMPTY_FILE');
      }

      const isPdf =
        lower.endsWith('.pdf') || file.type === 'application/pdf';
      const isImage = !isPdf && isSupportedImageFileNameOrType(file.name, file.type);

      if (!isPdf && !isImage) {
        errors.push({
          fileName: file.name,
          reasonFa: `فرمت فایل «${file.name}» پشتیبانی نمی‌شود.`,
          solutionFa:
            'لطفاً فایل‌های PDF یا تصاویر استاندارد (JPG، PNG، TIFF، PSD، WEBP، HEIC، BMP) را وارد کنید.',
          reasonEn: `Unsupported file format for "${file.name}".`,
          solutionEn:
            'Please import PDF or supported image files (JPG, PNG, TIFF, PSD, WEBP, HEIC, BMP).',
        });
        continue;
      }

      if (isPdf) {
        // Real PDF parsing & rendering via pdfjs-dist
        const analyzedPages = await analyzePdfOffThread(bytes, file.name);
        if (analyzedPages.length === 0) {
          throw new Error('ZERO_PAGES');
        }

        const docId = `doc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const sourceDoc: SourceDocument = {
          id: docId,
          name: file.name,
          filePath: file.name,
          fileSize: file.size || bytes.byteLength,
          fileType: 'pdf',
          mimeType: 'application/pdf',
          pageCount: analyzedPages.length,
          createdAt: new Date().toISOString(),
          rawBytes: bytes,
        };
        documents.push(sourceDoc);

        const palette = ['#0284c7', '#4f46e5', '#059669', '#d97706', '#e11d48'];
        const accent = palette[i % palette.length];

        for (let pIdx = 0; pIdx < analyzedPages.length; pIdx++) {
          const info = analyzedPages[pIdx];
          const pageId = `page-${docId}-${info.pageNumber}`;
          globalThumbnailCache.set(pageId, info.thumbnailDataUrl);

          pages.push({
            id: pageId,
            documentId: docId,
            documentName: file.name,
            sourcePageNumber: info.pageNumber,
            widthMm: info.widthMm,
            heightMm: info.heightMm,
            rotation: info.rotation,
            selectedForPrint: true,
            isHighlighted: pIdx === 0 && i === 0,
            isBlankPage: info.colorProfile === 'blank',
            colorProfile: info.colorProfile,
            inkCoveragePercent: info.inkCoveragePercent,
            thumbnailDataUrl: info.thumbnailDataUrl,
            previewLines: info.extractedTextLines,
            previewAccentColor: accent,
          });

          if (pIdx === 0) {
            bookmarks.push({
              id: `bm-${docId}`,
              title: file.name.replace(/\.pdf$/i, ''),
              documentId: docId,
              targetPageId: pageId,
              pageIndex: pages.length - 1,
              level: 0,
            });
          }
        }
      } else {
        // Universal Image import (PNG, JPEG, TIFF, PSD, WebP, HEIC/HEIF, BMP, GIF, SVG)
        const decodedPages = await decodeUniversalImageToPages(bytes, file.name, file.type);
        const imageDoc = await PDFDocument.create();
        const batchDocIds: string[] = [];
        const batchPageIds: string[] = [];
        let firstDocId = '';
        let firstPageId = '';
        let firstPageIndex = -1;

        for (let pIdx = 0; pIdx < decodedPages.length; pIdx++) {
          const dPage = decodedPages[pIdx];
          // Verify PDF-embeddability via pdf-lib
          const embeddedCheck =
            dPage.mimeType === 'image/png'
              ? await imageDoc.embedPng(dPage.bytes)
              : await imageDoc.embedJpg(dPage.bytes);

          const imgW = embeddedCheck.width || dPage.width;
          const imgH = embeddedCheck.height || dPage.height;
          // Fit source aspect ratio into an A4-sized page without distorting pixels (or honor physical DPI if valid)
          const imageScale = Math.min(210 / imgW, 297 / imgH);
          const physW = dPage.dpiX ? (imgW / dPage.dpiX) * 25.4 : imgW * imageScale;
          const physH = dPage.dpiY ? (imgH / dPage.dpiY) * 25.4 : imgH * imageScale;
          const rawFinalW = physW >= 5 && physW <= 1200 ? physW : imgW * imageScale;
          const rawFinalH = physH >= 5 && physH <= 1200 ? physH : imgH * imageScale;

          let activeBytes = dPage.bytes;
          let activeMime = dPage.mimeType;
          let activeW = imgW;
          let activeH = imgH;
          let finalW = rawFinalW;
          let finalH = rawFinalH;
          let preDeskewRawBytes: Uint8Array | undefined;
          let preDeskewMimeType: string | undefined;
          let detectedBoundaries: DetectedDocumentBoundaries | undefined;
          let deskewInfo: ScanDeskewInfo | undefined;

          if (imgW >= 16 && imgH >= 16) {
            const scanDetection = await detectRawScanBoundariesFromEncodedBytes(
              dPage.bytes,
              dPage.mimeType
            );
            detectedBoundaries = toDetectedDocumentBoundaries(scanDetection);

            if (autoDeskew && imgW >= 24 && imgH >= 24) {
              const deskewed = await autoDeskewDecodedImage({
                bytes: dPage.bytes,
                mimeType: dPage.mimeType,
                boundaryDetection: scanDetection,
              });
              if (deskewed.applied && deskewed.width > 0 && deskewed.height > 0) {
                preDeskewRawBytes = dPage.bytes;
                preDeskewMimeType = dPage.mimeType;
                activeBytes = deskewed.bytes;
                activeMime = deskewed.mimeType;
                activeW = deskewed.width;
                activeH = deskewed.height;
                finalW = rawFinalW * (activeW / Math.max(1, imgW));
                finalH = rawFinalH * (activeH / Math.max(1, imgH));
                detectedBoundaries = toDetectedDocumentBoundaries(deskewed.boundaryDetection);
                deskewInfo = {
                  applied: true,
                  angleDeg: deskewed.angleDeg,
                  confidence: deskewed.confidence,
                  method: deskewed.method,
                  originalWidthMm: rawFinalW,
                  originalHeightMm: rawFinalH,
                  originalWidthPx: imgW,
                  originalHeightPx: imgH,
                };
              }
            }
          }

          const docDisplayName =
            decodedPages.length > 1 ? `${file.name} (ص ${pIdx + 1})` : file.name;
          const docId = `img-${Date.now()}-${pIdx}-${Math.random().toString(36).slice(2, 7)}`;
          const safeBuf = new Uint8Array(activeBytes);
          const previewUrl =
            typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
              ? URL.createObjectURL(new Blob([safeBuf], { type: activeMime }))
              : decodedPageToDataUrl({
                  bytes: activeBytes,
                  mimeType: activeMime === 'image/jpeg' ? 'image/jpeg' : 'image/png',
                });
          const pageId = `page-${docId}-1`;

          documents.push({
            id: docId,
            name: docDisplayName,
            filePath: file.name,
            fileSize: pIdx === 0 ? file.size || bytes.byteLength : activeBytes.byteLength,
            fileType: 'image',
            mimeType: activeMime,
            pageCount: 1,
            createdAt: new Date().toISOString(),
            rawBytes: activeBytes,
            ...(preDeskewRawBytes
              ? { preDeskewRawBytes, preDeskewMimeType }
              : {}),
          });

          globalThumbnailCache.set(pageId, previewUrl);

          const pageOverrides =
            detectedBoundaries || deskewInfo
              ? {
                  ...(detectedBoundaries ? { detectedBoundaries } : {}),
                  ...(deskewInfo ? { deskewInfo } : {}),
                }
              : undefined;

          pages.push({
            id: pageId,
            documentId: docId,
            documentName: docDisplayName,
            sourcePageNumber: 1,
            widthMm: finalW,
            heightMm: finalH,
            rotation: 0,
            selectedForPrint: true,
            isHighlighted: i === 0 && pIdx === 0,
            isBlankPage: false,
            colorProfile: dPage.colorSpace === 'Grayscale' ? 'grayscale' : 'color',
            inkCoveragePercent: 34.5,
            thumbnailDataUrl: previewUrl,
            previewLines: [
              `تصویر ورودی (${dPage.formatLabel}): ${docDisplayName}`,
              `${activeW}×${activeH} px · ${dPage.colorSpace}${dPage.dpiX ? ` · ${dPage.dpiX} DPI` : ''}${
                deskewInfo?.applied ? ` · تراز خودکار ${deskewInfo.angleDeg > 0 ? '+' : ''}${deskewInfo.angleDeg.toFixed(1)}°` : ''
              }`,
            ],
            previewAccentColor: '#059669',
            ...(pageOverrides ? { overrides: pageOverrides } : {}),
          });

          if (pIdx === 0) {
            firstDocId = docId;
            firstPageId = pageId;
            firstPageIndex = pages.length - 1;
          }
          batchDocIds.push(docId);
          batchPageIds.push(pageId);
        }

        if (firstDocId && firstPageId) {
          importedImageBatches.push({
            docId: firstDocId,
            fileName: file.name,
            firstPageId,
            firstPageIndex,
            docIds: batchDocIds,
            pageIds: batchPageIds,
          });
        }
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      errors.push({
        fileName: file.name,
        reasonFa: `ورود فایل «${file.name}» ناموفق بود (${detail}).`,
        solutionFa:
          'این فایل به‌صورت ایمن رد شد و سایر فایل‌ها بدون توقف بارگذاری شدند. لطفاً نسخه سالم فایل را بررسی کنید.',
        reasonEn: `Could not import "${file.name}" (${detail}).`,
        solutionEn:
          'This file was safely skipped so remaining files could load. Please verify the source file.',
      });
    }
  }

  if (importedImageBatches.length === 1) {
    const single = importedImageBatches[0];
    if (single.docIds.length > 1) {
      const docIdSet = new Set(single.docIds);
      const groupId = `img-batch-${single.docId}`;
      for (const doc of documents) {
        if (docIdSet.has(doc.id)) {
          doc.batchGroupId = groupId;
          doc.batchGroupTitle = single.fileName;
        }
      }
    }
    bookmarks.push({
      id: `bm-${single.docId}`,
      title: single.fileName,
      documentId: single.docId,
      targetPageId: single.firstPageId,
      pageIndex: single.firstPageIndex,
      level: 0,
      ...(single.pageIds.length > 1
        ? {
            documentIds: single.docIds,
            pageIds: single.pageIds,
            itemCount: single.pageIds.length,
          }
        : {}),
    });
  } else if (importedImageBatches.length > 1) {
    const first = importedImageBatches[0];
    const allDocIds = importedImageBatches.flatMap((entry) => entry.docIds);
    const allPageIds = importedImageBatches.flatMap((entry) => entry.pageIds);
    const batchGroupId = `img-batch-${first.docId}`;
    const batchGroupTitle = `${first.fileName} (+${importedImageBatches.length - 1})`;
    const docIdSet = new Set(allDocIds);
    for (const doc of documents) {
      if (docIdSet.has(doc.id)) {
        doc.batchGroupId = batchGroupId;
        doc.batchGroupTitle = batchGroupTitle;
      }
    }
    bookmarks.push({
      id: `bm-img-batch-${first.docId}`,
      title: batchGroupTitle,
      documentId: first.docId,
      targetPageId: first.firstPageId,
      pageIndex: first.firstPageIndex,
      level: 0,
      documentIds: allDocIds,
      pageIds: allPageIds,
      itemCount: allPageIds.length,
    });
  }

  return { documents, pages, bookmarks, errors };
}

/**
 * Creates a realistic 4-document Print Shop Dataset (Brochure, Architectural CAD Plan,
 * University Exam Booklet, and Personnel ID Cards) with real PDF bytes so the user can
 * immediately test N-Up, Step & Repeat, Invert, Watermarks, Counter, and PDF Export!
 */
export async function createSamplePrintShopWorkspace(): Promise<{
  documents: SourceDocument[];
  pages: PageItem[];
  bookmarks: BookmarkItem[];
}> {
  const sampleSpecs = [
    {
      name: 'کاتالوگ-محصولات-چاپخانه-۱۴۰۵.pdf',
      pageCount: 6,
      widthMm: 210,
      heightMm: 297,
      accent: '#0284c7',
      colorPages: [1, 2, 4, 6],
      subtitle: 'کاتالوگ تمام‌رنگی A4 — گلاسه ۱۷۰ گرم',
      lines: [
        'کاتالوگ جامع خدمات چاپ دیجیتال و افست',
        'لیست تعرفه چاپ رنگی، سیاه‌وسفید و صحافی',
        'تضمین کیفیت رنگ CMYK و کنترل دقیق حاشیه برش',
        'چاپ کاتالوگ، بروشور، ست اداری و پوستر تبلیغاتی',
      ],
    },
    {
      name: 'جزوه-آزمون-مهندسی-نرم‌افزار.pdf',
      pageCount: 8,
      widthMm: 210,
      heightMm: 297,
      accent: '#4f46e5',
      colorPages: [1],
      subtitle: 'جزوه آموزشی A4 — مناسب چاپ ۲ یا ۴ صفحه در یک برگ (N-Up)',
      lines: [
        'فصل اول: معماری سیستم‌های توزیع‌شده و دسکتاپ',
        'فصل دوم: مدیریت حافظه، کش LRU و پردازش موازی Worker',
        'فصل سوم: الگوریتم‌های چیدمان چاپ (Imposition & Booklet)',
        'نکته چاپ: مناسب برای تست حالت Invert و حذف پس‌زمینه اسکن',
      ],
    },
    {
      name: 'نقشه-معماری-پروژه-برج-میلاد-A3.pdf',
      pageCount: 2,
      widthMm: 420,
      heightMm: 297,
      accent: '#059669',
      colorPages: [1, 2],
      subtitle: 'پلان اجرایی A3 افقی (Landscape) — مناسب تست Invert و مقیاس',
      lines: [
        'پلان معماری طبقه اول و جزئیات سازه نگهبان',
        'مقیاس ۱:۱۰۰ — واحد اندازه‌گیری میلی‌متر',
        'کنترل خطوط برش و کادر فنی مهندسی',
        'تاییدیه دفتر فنی و مهندسی — نسخه نهایی چاپ',
      ],
    },
    {
      name: 'کارت-پرسنلی-و-ویزیت-غرفه.pdf',
      pageCount: 2,
      widthMm: 90,
      heightMm: 55,
      accent: '#d97706',
      colorPages: [1, 2],
      subtitle: 'کارت ۹۰×۵۵ میلی‌متر — ایده‌آل برای تست Step & Repeat (تکرار در شیت)',
      lines: [
        'کارت شناسایی پرسنل و غرفه‌داران نمایشگاه بین‌المللی',
        'ابعاد استاندارد کارت ویزیت: ۹۰ در ۵۵ میلی‌متر',
        'در تب Page Layout حالت «تکرار یک صفحه در همه خانه‌ها» را امتحان کنید',
      ],
    },
  ];

  const documents: SourceDocument[] = [];
  const pages: PageItem[] = [];
  const bookmarks: BookmarkItem[] = [];

  for (let dIdx = 0; dIdx < sampleSpecs.length; dIdx++) {
    const spec = sampleSpecs[dIdx];
    const docId = `sample-doc-${dIdx + 1}`;

    // Build a real PDF in memory via pdf-lib so export/merge works with true vector PDF bytes
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const bodyFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

    for (let p = 1; p <= spec.pageCount; p++) {
      const page = pdfDoc.addPage([spec.widthMm * MM_TO_PT, spec.heightMm * MM_TO_PT]);
      const { width, height } = page.getSize();
      page.drawRectangle({
        x: 18,
        y: 18,
        width: width - 36,
        height: height - 36,
        borderColor: rgb(0.05, 0.52, 0.78),
        borderWidth: 1.5,
      });
      page.drawText(`PrintStudio Pro Vector Document - Doc #${dIdx + 1}`, {
        x: 32,
        y: height - 48,
        size: 13,
        font,
        color: rgb(0.06, 0.25, 0.48),
      });
      page.drawText(
        `Source Page ${p} of ${spec.pageCount} (${spec.widthMm}x${spec.heightMm} mm)`,
        {
          x: 32,
          y: height - 70,
          size: 10,
          font: bodyFont,
          color: rgb(0.25, 0.32, 0.42),
        }
      );
    }

    const rawBytes = await pdfDoc.save();
    const analyzed = await analyzePdfOffThread(rawBytes, spec.name);
    if (analyzed.length !== spec.pageCount) throw new Error('Sample rendering returned an unexpected page count');

    documents.push({
      id: docId,
      name: spec.name,
      filePath: spec.name,
      fileSize: rawBytes.byteLength,
      fileType: 'pdf',
      mimeType: 'application/pdf',
      pageCount: spec.pageCount,
      createdAt: new Date().toISOString(),
      rawBytes,
    });

    for (let p = 1; p <= spec.pageCount; p++) {
      const pageId = `${docId}-page-${p}`;
      const info = analyzed[p - 1];
      const thumb = info.thumbnailDataUrl;
      globalThumbnailCache.set(pageId, thumb);

      pages.push({
        id: pageId,
        documentId: docId,
        documentName: spec.name,
        sourcePageNumber: p,
        widthMm: spec.widthMm,
        heightMm: spec.heightMm,
        rotation: 0,
        selectedForPrint: true,
        isHighlighted: dIdx === 0 && p === 1,
        isBlankPage: false,
        colorProfile: info.colorProfile,
        inkCoveragePercent: info.inkCoveragePercent,
        thumbnailDataUrl: thumb,
        previewLines: info.extractedTextLines,
        previewAccentColor: spec.accent,
      });

      if (p === 1) {
        bookmarks.push({
          id: `bm-${docId}`,
          title: spec.name.replace(/\.pdf$/i, ''),
          documentId: docId,
          targetPageId: pageId,
          pageIndex: pages.length - 1,
          level: 0,
        });
      }
    }
  }

  return { documents, pages, bookmarks };
}

/**
 * C1, C2, D1-D5, E1, F1-F2:
 * Generates a real, imposed, merged vector PDF from the current workspace state.
 * Preserves vector content, draws N-Up cells, crop marks, Bates/Page numbers,
 * Watermarks, and Vector BlendMode.Difference for Invert!
 */
export async function exportImposedPdf(params: {
  documents: SourceDocument[];
  pages: PageItem[];
  layout: LayoutSettings;
  effects: EffectsSettings;
  watermark: WatermarkSettings;
  pageNumbering: PageNumberSettings;
  overlays?: PageOverlay[];
  /** Source order, including pages excluded from output, for stable page scopes. */
  allPages?: PageItem[];
  userName: string;
  exportOptions?: PdfExportOptions;
  onProgress?: (percent: number) => void;
  onMeta?: (meta: { sheetCount: number }) => void;
}): Promise<Uint8Array> {
  const {
    documents,
    pages,
    layout,
    effects,
    watermark,
    pageNumbering,
    overlays = [],
    allPages = pages,
    userName,
    exportOptions,
    onProgress,
    onMeta,
  } = params;

  const imageHandling = exportOptions?.imageHandling ?? 'preserve';
  const compression = exportOptions?.compression ?? 'lossless';
  const targetRasterDpi = imageHandling === 'downsample-150' ? 150 : 300;
  const maxRasterSidePx =
    imageHandling === 'downsample-150'
      ? 1500
      : imageHandling === 'downsample-300'
        ? 2600
        : 3600;
  const jpegQuality = compression === 'compact' ? 0.72 : compression === 'balanced' ? 0.88 : null;

  const embedSurfaceOpaque = async (canvas: HTMLCanvasElement | OffscreenCanvas) => {
    if (jpegQuality !== null) {
      const encoded = await surfaceToJpegBytes(canvas, jpegQuality);
      if (encoded.format === 'jpeg') {
        try {
          return await outPdf.embedJpg(encoded.bytes);
        } catch {
          // If headless mock returned non-JPEG bytes, fall back cleanly to PNG
        }
      }
    }
    return await outPdf.embedPng(await surfaceToPngBytes(canvas));
  };

  const outPdf = await PDFDocument.create();
  outPdf.setTitle('PrintStudio Pro — Imposed Output');
  outPdf.setAuthor(userName || 'PrintStudio Pro User');
  outPdf.setCreator('PrintStudio Pro v1.0');
  outPdf.setProducer('PrintStudio Pro Vector Imposition Engine (pdf-lib)');

  const font = await outPdf.embedFont(StandardFonts.Helvetica);
  const boldFont = await outPdf.embedFont(StandardFonts.HelveticaBold);

  // Compute imposition sheets first so unused documents are never parsed or embedded into outPdf
  const rawSheets = computeImpositionSheets(pages, layout);
  const pageIndices = new Map(allPages.map((page, index) => [page.id, index + 1]));
  const effectiveDuplex = layout.booklet?.enabled ? layout.booklet.duplexMode : layout.duplexMode;
  const sheets = stripTrailingEmptyDuplexSides(rawSheets, effectiveDuplex, (side, originalTotal) =>
    overlays.length > 0 &&
    (shapePlacements(side, originalTotal, allPages, overlays, pageIndices).length > 0 ||
      textPlacements(side, originalTotal, allPages, overlays, pageIndices).length > 0 ||
      imagePlacements(side, originalTotal, allPages, overlays, pageIndices).length > 0)
  );
  onMeta?.({ sheetCount: sheets.length });

  const usedDocIds = new Set<string>();
  for (const sheetSide of sheets) {
    for (const cell of sheetSide.cells) {
      if (cell.page && cell.page.sourcePageNumber > 0) {
        usedDocIds.add(cell.page.documentId);
      }
    }
  }

  // Cache loaded source PDFDocuments and SourceDocuments by documentId
  const docById = new Map(documents.map((d) => [d.id, d]));
  const loadedSourceDocs = new Map<string, PDFDocument>();
  const loadedImages = new Map<string, Awaited<ReturnType<typeof outPdf.embedPng>>>();
  for (const doc of documents) {
    if (!usedDocIds.has(doc.id)) continue;
    if (doc.fileType === 'pdf' && doc.rawBytes) {
      const src = await PDFDocument.load(doc.rawBytes, { ignoreEncryption: false });
      loadedSourceDocs.set(doc.id, src);
    } else if (doc.fileType === 'image' && doc.rawBytes) {
      let embedded: Awaited<ReturnType<typeof outPdf.embedPng>> | null = null;
      const pngInfo = doc.mimeType === 'image/png' ? inspectPng(doc.rawBytes) : null;
      const jpegInfo = (doc.mimeType === 'image/jpeg' || doc.mimeType === 'image/jpg') ? inspectJpeg(doc.rawBytes) : null;
      const hasAlphaPng = Boolean(pngInfo && (pngInfo.colorType === 4 || pngInfo.colorType === 6 || pngInfo.hasTrns));
      const needsColorConversion = Boolean(
        pngInfo?.hasColorProfile ||
        pngInfo?.animated ||
        (pngInfo && ![0, 2, 3, 4, 6].includes(pngInfo.colorType)) ||
        jpegInfo?.hasColorProfile ||
        jpegInfo?.components === 4 ||
        (jpegInfo && jpegInfo.orientation !== 1)
      );
      if (imageHandling !== 'preserve' || jpegQuality !== null || needsColorConversion) {
        try {
          const decoded = await decodeImageSource(doc.rawBytes, doc.mimeType || 'image/png');
          try {
            const scale =
              imageHandling === 'preserve'
                ? 1
                : Math.min(1, maxRasterSidePx / Math.max(1, decoded.width, decoded.height));
            const shouldReencode = scale < 1 || jpegQuality !== null || needsColorConversion;
            if (shouldReencode) {
              const w = Math.max(1, Math.round(decoded.width * scale));
              const h = Math.max(1, Math.round(decoded.height * scale));
              const surface = createCanvas2DSurface(w, h);
              if (surface) {
                if (hasAlphaPng && jpegQuality === null) {
                  surface.ctx.clearRect(0, 0, w, h);
                  surface.ctx.drawImage(decoded.source, 0, 0, w, h);
                  embedded = await outPdf.embedPng(await surfaceToPngBytes(surface.canvas));
                } else {
                  surface.ctx.fillStyle = '#ffffff';
                  surface.ctx.fillRect(0, 0, w, h);
                  surface.ctx.drawImage(decoded.source, 0, 0, w, h);
                  embedded = await embedSurfaceOpaque(surface.canvas);
                }
                if ('width' in surface.canvas) {
                  surface.canvas.width = 0;
                  surface.canvas.height = 0;
                }
              }
            }
          } finally {
            decoded.cleanup?.();
          }
        } catch {
          // Fall back to direct embed when image decoding/Canvas is unavailable (e.g. Node unit tests)
        }
      }
      if (!embedded) {
        if (doc.mimeType === 'image/png') embedded = await outPdf.embedPng(doc.rawBytes);
        else if (doc.mimeType === 'image/jpeg' || doc.mimeType === 'image/jpg') {
          embedded = await outPdf.embedJpg(doc.rawBytes);
          const isPlainCmyk = Boolean(
            jpegInfo &&
            jpegInfo.components === 4 &&
            (!jpegInfo.adobe || (jpegInfo.adobeTransform !== null && jpegInfo.adobeTransform < 2))
          );
          if (isPlainCmyk) await applyCmykDecode(outPdf, embedded);
        } else throw new Error(`Unsupported image format: ${doc.mimeType}`);
      }
      loadedImages.set(doc.id, embedded);
    }
  }

  const totalSides = Math.max(1, sheets.length);
  const textImages = new Map<string, Awaited<ReturnType<typeof outPdf.embedPng>>>();
  const textTokenCache = new Map<
    string,
    { image: Awaited<ReturnType<typeof outPdf.embedPng>>; advPx: number; padPx: number; tokW: number }
  >();
  const shapeSvgPathCache = new Map<string, string>();
  const pdfPageBaseDims = new Map<string, { width: number; height: number }>();
  const picturePlanCache = new Map<string, ReturnType<typeof planPictureEmbedding>>();
  const pictureImages = new Map<string, Awaited<ReturnType<typeof outPdf.embedPng>>>();
  const processedImages = new Map<string, Awaited<ReturnType<typeof outPdf.embedPng>>>();
  const processedPdfPages = new Map<string, Awaited<ReturnType<typeof outPdf.embedPng>>>();
  const embeddedSourcePdfPages = new Map<string, Awaited<ReturnType<typeof outPdf.embedPages>>[number]>();
  const loadedPdfJsTasks = new Map<string, ReturnType<PdfJsModule['getDocument']>>();
  const loadedPdfJsDocs = new Map<string, Promise<PdfJsDocumentProxy>>();
  const loadedTextFonts = new Set<string>();

  const shapeOverlays = overlays.filter((o) => o.kind === 'shape');
  const imageOverlays = overlays.filter((o) => o.kind === 'image');
  const textOverlays = overlays.filter((o) => o.kind === 'text' || (o.kind === 'numbering' && o.enabled));

  const watermarkActive = watermark.enabled && watermark.text.trim().length > 0;
  const watermarkHasMacros = watermarkActive && watermark.text.includes('{');
  const watermarkHex = watermarkActive && /^#[0-9a-f]{6}$/i.test(watermark.colorHex) ? watermark.colorHex.slice(1) : '0d73bf';
  const watermarkColor = watermarkActive
    ? rgb(
        parseInt(watermarkHex.slice(0, 2), 16) / 255,
        parseInt(watermarkHex.slice(2, 4), 16) / 255,
        parseInt(watermarkHex.slice(4, 6), 16) / 255,
      )
    : null;
  const watermarkOptions = watermarkActive && watermarkColor
    ? {
        size: Math.max(6, Math.min(200, watermark.fontSizePt)),
        font: watermark.fontFamily === 'Inter' ? font : boldFont,
        color: watermarkColor,
        opacity: Math.max(0.05, Math.min(1, watermark.opacity)),
        rotate: degrees(Math.max(-90, Math.min(90, watermark.rotationDeg))),
      }
    : null;
  const staticWatermarkText =
    watermarkActive && !watermarkHasMacros
      ? watermark.text.replace(/[^\x20-\x7E]/g, '').trim() || 'PrintStudio Pro'
      : null;
  let measureCtxCache: CanvasRenderingContext2D | null | undefined;
  const getMeasureCtx = (): CanvasRenderingContext2D | null => {
    if (measureCtxCache !== undefined) return measureCtxCache;
    if (typeof document === 'undefined') {
      measureCtxCache = null;
      return null;
    }
    try {
      const mc = document.createElement('canvas');
      mc.width = 1;
      mc.height = 1;
      measureCtxCache = mc.getContext('2d');
    } catch {
      measureCtxCache = null;
    }
    return measureCtxCache;
  };

  const getPdfJsDoc = (docId: string, rawBytes: Uint8Array): Promise<PdfJsDocumentProxy> => {
    let promise = loadedPdfJsDocs.get(docId);
    if (!promise) {
      promise = (async () => {
        const pdfjsLib = await loadPdfJsLib();
        const canvasFactory =
          typeof document === 'undefined' && typeof OffscreenCanvas !== 'undefined'
            ? class {
                create(width: number, height: number) {
                  const canvas = new OffscreenCanvas(Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(height)));
                  return { canvas, context: canvas.getContext('2d') };
                }
                reset(pair: { canvas: OffscreenCanvas }, width: number, height: number) {
                  pair.canvas.width = Math.max(1, Math.ceil(width));
                  pair.canvas.height = Math.max(1, Math.ceil(height));
                }
                destroy(pair: { canvas: OffscreenCanvas | null; context: OffscreenCanvasRenderingContext2D | null }) {
                  pair.canvas = null;
                  pair.context = null;
                }
              }
            : undefined;
        const useBundledStandardFonts =
          typeof window !== 'undefined' &&
          typeof fetch === 'function' &&
          Object.keys(standardPdfFonts).length > 0;
        const task = pdfjsLib.getDocument({
          data: new Uint8Array(rawBytes),
          useSystemFonts: true,
          isEvalSupported: false,
          ...(useBundledStandardFonts ? { StandardFontDataFactory: BundledStandardFontFactory as never } : {}),
          ...(canvasFactory ? { CanvasFactory: canvasFactory as never } : {}),
        });
        loadedPdfJsTasks.set(docId, task);
        return await task.promise;
      })();
      loadedPdfJsDocs.set(docId, promise);
    }
    return promise;
  };

  let lastProgressReported = -1;
  let lastYieldAt = typeof performance !== 'undefined' ? performance.now() : Date.now();

  try {
  for (let sIdx = 0; sIdx < sheets.length; sIdx++) {
    const sheetSide = sheets[sIdx];
    const sheetWidthPt = sheetSide.widthMm * MM_TO_PT;
    const sheetHeightPt = sheetSide.heightMm * MM_TO_PT;

    const outPage = outPdf.addPage([sheetWidthPt, sheetHeightPt]);

    for (const cell of sortCellsByLayer(sheetSide.cells)) {
      if (!cell.page) continue;

      const cellXPt = cell.cellXMm * MM_TO_PT;
      // PDF coordinate origin is bottom-left
      const cellYPt =
        sheetHeightPt - (cell.cellYMm + cell.cellHeightMm) * MM_TO_PT;
      const cellWPt = cell.cellWidthMm * MM_TO_PT;
      const cellHPt = cell.cellHeightMm * MM_TO_PT;

      const contentXPt = cell.contentXMm * MM_TO_PT;
      const contentYPt =
        sheetHeightPt - (cell.contentYMm + cell.contentHeightMm) * MM_TO_PT;
      const contentWPt = cell.contentWidthMm * MM_TO_PT;
      const contentHPt = cell.contentHeightMm * MM_TO_PT;

      // Embed source PDF page or image if available
      const sourceDoc = docById.get(cell.page.documentId);
      const srcPdf = loadedSourceDocs.get(cell.page.documentId);
      const srcImage = loadedImages.get(cell.page.documentId);
      const resolved = resolvePageEffects(cell.page, effects);
      const rotation = cell.effectiveRotation;
      // Preview uses clockwise CSS rotation; PDF coordinates increase upwards.
      const rotated = rotation === 90 || rotation === 270;
      const pageOpacity =
        typeof cell.page.overrides?.opacity === 'number' &&
        Number.isFinite(cell.page.overrides.opacity) &&
        cell.page.overrides.opacity < 0.999
          ? Math.max(0.05, Math.min(1, cell.page.overrides.opacity))
          : undefined;
      const drawPlacement = {
        x: contentXPt + (rotation === 180 || rotation === 270 ? contentWPt : 0),
        y: contentYPt + (rotation === 90 || rotation === 180 ? contentHPt : 0),
        width: rotated ? contentHPt : contentWPt,
        height: rotated ? contentWPt : contentHPt,
        rotate: degrees(-rotation),
        ...(pageOpacity !== undefined ? { opacity: pageOpacity } : {}),
      };
      const extraRotation = normalizeAngle(cell.transform?.rotationDeg ?? 0);
      const angle = -extraRotation * Math.PI / 180;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      const cx = contentXPt + contentWPt / 2, cy = contentYPt + contentHPt / 2;
      const rotateContent = () => {
        if (extraRotation) outPage.pushOperators(concatTransformationMatrix(cos, sin, -sin, cos, cx - cos*cx + sin*cy, cy - sin*cx - cos*cy));
      };
      outPage.pushOperators(pushGraphicsState());
      if (!cell.allowOverflow) outPage.pushOperators(rectangle(cellXPt, cellYPt, cellWPt, cellHPt), clip(), endPath());
      rotateContent();
      let bakedSrcImageInvert = false;
      if (srcPdf && cell.page.sourcePageNumber > 0) {
        const pageIdxZero = cell.page.sourcePageNumber - 1;
        if (pageIdxZero >= srcPdf.getPageCount()) {
          throw new Error(`Invalid source page ${cell.page.sourcePageNumber} in ${cell.page.documentName}`);
        }
        const sourcePage = srcPdf.getPage(pageIdxZero);
        if (resolved.hasPixelEffects && sourceDoc?.rawBytes) {
          if (!sourcePage.node.Contents()) {
            const tinted = applyEffectsToRgbaBuffer(
              new Uint8ClampedArray([255, 255, 255, 255]),
              effects,
              cell.page.overrides,
              resolved.applyGlobal
            );
            outPage.drawRectangle({
              x: contentXPt,
              y: contentYPt,
              width: contentWPt,
              height: contentHPt,
              color: rgb(tinted[0] / 255, tinted[1] / 255, tinted[2] / 255),
            });
          } else {
            const crop = pageCropFractions(cell.page);
            const targetCellW = rotated ? contentHPt : contentWPt;
            const targetCellH = rotated ? contentWPt : contentHPt;
            const visibleFractionW = Math.max(0.02, 1 - crop.left - crop.right);
            const visibleFractionH = Math.max(0.02, 1 - crop.top - crop.bottom);
            const baseKey = `${cell.page.documentId}:${cell.page.sourcePageNumber}`;
            let baseDims = pdfPageBaseDims.get(baseKey);
            let pdfPage: Awaited<ReturnType<PdfJsDocumentProxy['getPage']>> | null = null;
            if (!baseDims) {
              const pdfJsDoc = await getPdfJsDoc(cell.page.documentId, sourceDoc.rawBytes);
              pdfPage = await pdfJsDoc.getPage(cell.page.sourcePageNumber);
              const baseViewport = pdfPage.getViewport({ scale: 1, rotation: 0 });
              baseDims = { width: baseViewport.width, height: baseViewport.height };
              pdfPageBaseDims.set(baseKey, baseDims);
            }
            try {
              const maxSidePx = Math.min(3200, maxRasterSidePx);
              const desiredScaleW = (targetCellW * (targetRasterDpi / 72)) / Math.max(1, baseDims.width * visibleFractionW);
              const desiredScaleH = (targetCellH * (targetRasterDpi / 72)) / Math.max(1, baseDims.height * visibleFractionH);
              const maxScale = Math.min(
                maxSidePx / Math.max(1, baseDims.width),
                maxSidePx / Math.max(1, baseDims.height)
              );
              const minScale = Math.min(maxScale, imageHandling === 'downsample-150' ? 1.25 : 2);
              const renderScale = Math.max(minScale, Math.min(maxScale, Math.max(desiredScaleW, desiredScaleH)));
              const fullW = Math.max(1, Math.round(baseDims.width * renderScale));
              const fullH = Math.max(1, Math.round(baseDims.height * renderScale));
              const cropX = Math.max(0, Math.min(fullW - 1, Math.round(crop.left * fullW)));
              const cropY = Math.max(0, Math.min(fullH - 1, Math.round(crop.top * fullH)));
              const cropW = Math.max(1, Math.min(fullW - cropX, Math.round(visibleFractionW * fullW)));
              const cropH = Math.max(1, Math.min(fullH - cropY, Math.round(visibleFractionH * fullH)));

              const pdfEffectKey = JSON.stringify([
                cell.page.documentId,
                cell.page.sourcePageNumber,
                cropX,
                cropY,
                cropW,
                cropH,
                fullW,
                fullH,
                buildResolvedEffectsKey(resolved),
                imageHandling,
                compression,
              ]);
              let processedPdfImg = processedPdfPages.get(pdfEffectKey);
              if (!processedPdfImg) {
                if (!pdfPage) {
                  const pdfJsDoc = await getPdfJsDoc(cell.page.documentId, sourceDoc.rawBytes);
                  pdfPage = await pdfJsDoc.getPage(cell.page.sourcePageNumber);
                }
                const viewport = pdfPage.getViewport({ scale: renderScale, rotation: 0 });
                const renderW = Math.max(1, Math.round(viewport.width));
                const renderH = Math.max(1, Math.round(viewport.height));
                const fullSurface = createCanvas2DSurface(renderW, renderH);
                if (!fullSurface) throw new Error('Effects export requires a Canvas 2D renderer');
                fullSurface.ctx.fillStyle = '#ffffff';
                fullSurface.ctx.fillRect(0, 0, renderW, renderH);
                await pdfPage.render({
                  canvasContext: fullSurface.ctx as unknown as CanvasRenderingContext2D,
                  viewport,
                }).promise;
                const safeCropX = Math.max(0, Math.min(renderW - 1, Math.round(crop.left * renderW)));
                const safeCropY = Math.max(0, Math.min(renderH - 1, Math.round(crop.top * renderH)));
                const safeCropW = Math.max(1, Math.min(renderW - safeCropX, Math.round(visibleFractionW * renderW)));
                const safeCropH = Math.max(1, Math.min(renderH - safeCropY, Math.round(visibleFractionH * renderH)));
                const imgData = fullSurface.ctx.getImageData(safeCropX, safeCropY, safeCropW, safeCropH);
                const processed = applyEffectsToRgbaBuffer(
                  imgData.data,
                  effects,
                  cell.page.overrides,
                  resolved.applyGlobal
                );
                const outSurface =
                  safeCropX === 0 && safeCropY === 0 && safeCropW === renderW && safeCropH === renderH
                    ? fullSurface
                    : createCanvas2DSurface(safeCropW, safeCropH);
                if (!outSurface) throw new Error('Effects export requires a Canvas 2D renderer');
                const targetImgData =
                  outSurface === fullSurface ? imgData : outSurface.ctx.createImageData(safeCropW, safeCropH);
                targetImgData.data.set(processed);
                outSurface.ctx.putImageData(targetImgData, 0, 0);
                processedPdfImg = await embedSurfaceOpaque(outSurface.canvas);
                processedPdfPages.set(pdfEffectKey, processedPdfImg);
                if ('width' in outSurface.canvas) {
                  outSurface.canvas.width = 0;
                  outSurface.canvas.height = 0;
                }
                if (fullSurface !== outSurface && 'width' in fullSurface.canvas) {
                  fullSurface.canvas.width = 0;
                  fullSurface.canvas.height = 0;
                }
              }
              outPage.drawImage(processedPdfImg, drawPlacement);
            } finally {
              pdfPage?.cleanup();
            }
          }
        } else {
          // The PDF thumbnail is rendered on white paper; keep that opaque paper when layers overlap.
          outPage.drawRectangle({ x:contentXPt, y:contentYPt, width:contentWPt, height:contentHPt, color:rgb(1,1,1) });
          // pdf-lib cannot embed a page with no Contents; such a page is empty.
          if (sourcePage.node.Contents()) {
            const box = sourcePage.getCropBox();
            const crop = pageCropFractions(cell.page);
            const cropBox = {
              left: box.x + box.width * crop.left,
              right: box.x + box.width * (1 - crop.right),
              bottom: box.y + box.height * crop.bottom,
              top: box.y + box.height * (1 - crop.top),
            };
            const embeddedKey = `${cell.page.documentId}|${cell.page.sourcePageNumber}|${cropBox.left.toFixed(3)},${cropBox.bottom.toFixed(3)},${cropBox.right.toFixed(3)},${cropBox.top.toFixed(3)}`;
            let embeddedPage = embeddedSourcePdfPages.get(embeddedKey);
            if (!embeddedPage) {
              [embeddedPage] = await outPdf.embedPages([sourcePage], [cropBox]);
              embeddedSourcePdfPages.set(embeddedKey, embeddedPage);
            }
            outPage.drawPage(embeddedPage, drawPlacement);
          }
        }
      } else if (srcImage && cell.page.sourcePageNumber > 0) {
        let imageToDraw = srcImage;
        if ((resolved.hasPixelEffects || resolved.effectiveInvert) && sourceDoc?.rawBytes) {
          const imgEffectKey = `${cell.page.documentId}|${buildResolvedEffectsKey(resolved)}|${imageHandling}|${compression}`;
          let processedImg = processedImages.get(imgEffectKey);
          if (!processedImg) {
            const decoded = await decodeImageSource(sourceDoc.rawBytes, sourceDoc.mimeType || 'image/png');
            try {
              const scale = Math.min(1, maxRasterSidePx / Math.max(1, decoded.width, decoded.height));
              const w = Math.max(1, Math.round(decoded.width * scale));
              const h = Math.max(1, Math.round(decoded.height * scale));
              const surface = createCanvas2DSurface(w, h);
              if (!surface) throw new Error('Effects export requires a Canvas 2D renderer');
              surface.ctx.fillStyle = '#ffffff';
              surface.ctx.fillRect(0, 0, w, h);
              surface.ctx.drawImage(decoded.source, 0, 0, w, h);
              const imgData = surface.ctx.getImageData(0, 0, w, h);
              const processed = applyEffectsToRgbaBuffer(
                imgData.data,
                effects,
                cell.page.overrides,
                resolved.applyGlobal
              );
              imgData.data.set(processed);
              surface.ctx.putImageData(imgData, 0, 0);
              processedImg = await embedSurfaceOpaque(surface.canvas);
              processedImages.set(imgEffectKey, processedImg);
              if ('width' in surface.canvas) {
                surface.canvas.width = 0;
                surface.canvas.height = 0;
              }
            } finally {
              decoded.cleanup?.();
            }
          }
          imageToDraw = processedImg;
          if (resolved.effectiveInvert) bakedSrcImageInvert = true;
        }
        const crop = rotateInsets(pageCropFractions(cell.page), rotation);
        const fullW = contentWPt / (1 - crop.left - crop.right);
        const fullH = contentHPt / (1 - crop.top - crop.bottom);
        const fullX = contentXPt - crop.left * fullW;
        const fullY = contentYPt - crop.bottom * fullH;
        outPage.pushOperators(pushGraphicsState(), rectangle(contentXPt, contentYPt, contentWPt, contentHPt), clip(), endPath());
        outPage.drawImage(imageToDraw, {
          x: fullX + (rotation === 180 || rotation === 270 ? fullW : 0),
          y: fullY + (rotation === 90 || rotation === 180 ? fullH : 0),
          width: rotated ? fullH : fullW,
          height: rotated ? fullW : fullH,
          rotate: degrees(-rotation),
          ...(pageOpacity !== undefined ? { opacity: pageOpacity } : {}),
        });
        outPage.pushOperators(popGraphicsState());
      } else if (cell.page.sourcePageNumber === 0 && cell.page.isBlankPage) {
        let blankColor = rgb(1, 1, 1);
        if (resolved.hasPixelEffects) {
          const tinted = applyEffectsToRgbaBuffer(
            new Uint8ClampedArray([255, 255, 255, 255]),
            effects,
            cell.page.overrides,
            resolved.applyGlobal
          );
          blankColor = rgb(tinted[0] / 255, tinted[1] / 255, tinted[2] / 255);
        }
        outPage.drawRectangle({
          x: contentXPt,
          y: contentYPt,
          width: contentWPt,
          height: contentHPt,
          color: blankColor,
          ...(pageOpacity !== undefined ? { opacity: pageOpacity } : {}),
        });
      } else if (cell.page.sourcePageNumber > 0) {
        throw new Error(`Missing or unsupported source for ${cell.page.documentName}; re-import the original file`);
      }

      // Page-level eraser marks are painted as vector shapes over the imported page. This keeps
      // untouched PDF text and paths vector; only the small areas deliberately covered by the eraser
      // become filled geometry. Coordinates are percentages of the visible, oriented page rectangle.
      for (const mark of cell.page.erase ?? []) {
        const hex = mark.color && /^#[0-9a-f]{6}$/i.test(mark.color) ? mark.color.slice(1) : 'ffffff';
        const fill = rgb(parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255);
        if (mark.mode === 'region') {
          const x = contentXPt + mark.x / 100 * contentWPt;
          const y = contentYPt + (100 - mark.y - mark.height) / 100 * contentHPt;
          outPage.drawRectangle({ x, y, width: mark.width / 100 * contentWPt, height: mark.height / 100 * contentHPt, color: fill });
        } else {
          const rx = mark.radiusMm * MM_TO_PT;
          const ry = mark.radiusMm * MM_TO_PT;
          for (const point of mark.points) {
            const cx = contentXPt + point.x / 100 * contentWPt;
            const cy = contentYPt + (100 - point.y) / 100 * contentHPt;
            outPage.drawEllipse({ x: cx, y: cy, xScale: Math.max(0.1, rx), yScale: Math.max(0.1, ry), color: fill });
          }
        }
      }

      outPage.pushOperators(popGraphicsState());

      // Draw optional cell border
      if (layout.showCellBorders) {
        outPage.drawRectangle({
          x: cellXPt,
          y: cellYPt,
          width: cellWPt,
          height: cellHPt,
          borderColor: rgb(0.65, 0.7, 0.78),
          borderWidth: 0.5,
        });
      }

      // Draw optional crop marks at cell corners
      if (layout.showCropMarks) {
        const markLen = 8;
        const corners = [
          [cellXPt, cellYPt],
          [cellXPt + cellWPt, cellYPt],
          [cellXPt, cellYPt + cellHPt],
          [cellXPt + cellWPt, cellYPt + cellHPt],
        ];
        for (const [cx, cy] of corners) {
          outPage.drawLine({
            start: { x: cx - markLen, y: cy },
            end: { x: cx + markLen, y: cy },
            thickness: 0.4,
            color: rgb(0, 0, 0),
          });
          outPage.drawLine({
            start: { x: cx, y: cy - markLen },
            end: { x: cx, y: cy + markLen },
            thickness: 0.4,
            color: rgb(0, 0, 0),
          });
        }
      }

      // E1: Vector Invert via PDF BlendMode.Difference over the cell (when pixel effects or image baking already ran, Step 6 inverted pixels directly)
      if (resolved.effectiveInvert && !resolved.hasPixelEffects && !bakedSrcImageInvert) {
        ensureTransparencyGroup(outPdf, outPage);
        outPage.pushOperators(pushGraphicsState());
        if (!cell.allowOverflow) outPage.pushOperators(rectangle(cellXPt, cellYPt, cellWPt, cellHPt), clip(), endPath());
        rotateContent();
        outPage.drawRectangle({
          x: contentXPt,
          y: contentYPt,
          width: contentWPt,
          height: contentHPt,
          color: rgb(1, 1, 1),
          blendMode: BlendMode.Difference,
        });
        outPage.pushOperators(popGraphicsState());
      }
    }

    // F1: Watermark on sheet. All visual controls are applied to the exported PDF.
    if (watermarkActive && watermarkOptions) {
      let asciiSafeText = staticWatermarkText;
      if (asciiSafeText === null) {
        const firstPage = sheetSide.cells.find((c) => c.page !== null)?.page;
        const resolvedText = resolveTextMacros(watermark.text, {
          pageNumber: firstPage?.sourcePageNumber ?? sIdx + 1,
          totalPages: pages.length,
          sheetNumber: sheetSide.sheetNumber,
          totalSheets: totalSides,
          fileName: firstPage?.documentName ?? 'PrintStudio',
          userName,
        });
        // Standard PDF fonts are ASCII-only here; preserve the configured color and opacity.
        asciiSafeText = resolvedText.replace(/[^\x20-\x7E]/g, '').trim() || 'PrintStudio Pro';
      }
      if (watermark.tiled) {
        const spacingPt = Math.max(5, watermark.tileSpacingMm) * MM_TO_PT;
        for (let y = spacingPt / 2; y < sheetHeightPt; y += spacingPt) {
          for (let x = spacingPt / 2; x < sheetWidthPt; x += spacingPt) {
            outPage.drawText(asciiSafeText, { ...watermarkOptions, x, y });
          }
        }
      } else {
        outPage.drawText(asciiSafeText, {
          ...watermarkOptions,
          x: sheetWidthPt * 0.25,
          y: sheetHeightPt * 0.5,
        });
      }
    }

    // F2: Sheet / Bates Numbering on sheet footer
    if (pageNumbering.enabled) {
      const label =
        pageNumbering.format === 'bates'
          ? formatPageNumberLabel(pageNumbering, sIdx + 1, totalSides)
          : `Sheet ${sIdx + 1} of ${totalSides}`;
      outPage.drawText(label, {
        x: sheetWidthPt / 2 - 35,
        y: Math.max(12, pageNumbering.marginMm * MM_TO_PT),
        size: Math.max(8, pageNumbering.fontSizePt),
        font,
        color: rgb(0.25, 0.3, 0.38),
      });
    }

    // Shapes go on the page as vector paths, not as a raster of the box: a 0.2 pt hairline printed from
    // a bitmap would arrive as a grey smear, and this is the same outline the preview paints from the
    // same command list. Filled first, so text and pictures keep their traditional position above them.
    if (shapeOverlays.length > 0) {
      for (const placement of shapePlacements(sheetSide, totalSides, allPages, shapeOverlays, pageIndices)) {
        const item = placement.shape;
        if (!Number.isFinite(placement.width) || !Number.isFinite(placement.height) || placement.width <= 0 || placement.height <= 0) continue;
        // The path is in millimetres around the centre of the box, and drawSvgPath multiplies it by `scale`
        // while flipping y — so the line width and the dash have to be in millimetres too.
        const lineWidthMm = item.strokeWidth * MM_PER_PT;
        const fill = shapeHasFill(item) ? shapeColorComponents(item.fillColor) : null;
        const stroke = item.strokeWidth > 0 ? shapeColorComponents(item.strokeColor) : null;
        if (!fill && !stroke) continue; // nothing to draw, so nothing to clip either
        const dash = shapeDashPattern(item.strokeStyle, lineWidthMm);
        const pathCacheKey = `${item.type}|${item.lineOrientation ?? ''}|${item.arrowStyle ?? ''}|${item.sides ?? ''}|${item.innerRadiusPercent ?? ''}|${item.borderRadius}|${Math.round(placement.width * 1000)}|${Math.round(placement.height * 1000)}`;
        let svgPath = shapeSvgPathCache.get(pathCacheKey);
        if (!svgPath) {
          svgPath = shapeSvgPath(shapeCommands(item, placement.width, placement.height));
          shapeSvgPathCache.set(pathCacheKey, svgPath);
        }
        outPage.pushOperators(pushGraphicsState());
        if (placement.clip) {
          const r = placement.clip;
          outPage.pushOperators(rectangle(r.x * MM_TO_PT, sheetHeightPt - (r.y + r.height) * MM_TO_PT, r.width * MM_TO_PT, r.height * MM_TO_PT), clip(), endPath());
        }
        const parentAngle = (-placement.parentRotation * Math.PI) / 180,
          pcx = (placement.parentX + placement.parentWidth / 2) * MM_TO_PT,
          pcy = sheetHeightPt - (placement.parentY + placement.parentHeight / 2) * MM_TO_PT;
        if (parentAngle) {
          const c = Math.cos(parentAngle),
            s = Math.sin(parentAngle);
          outPage.pushOperators(concatTransformationMatrix(c, s, -s, c, pcx - c * pcx + s * pcy, pcy - s * pcx - c * pcy));
        }
        outPage.drawSvgPath(svgPath, {
          x: (placement.x + placement.width / 2) * MM_TO_PT,
          y: sheetHeightPt - (placement.y + placement.height / 2) * MM_TO_PT,
          scale: MM_TO_PT,
          rotate: degrees(-item.rotation),
          ...(fill ? { color: rgb(fill[0], fill[1], fill[2]) } : {}),
          ...(stroke ? { borderColor: rgb(stroke[0], stroke[1], stroke[2]) } : {}),
          ...(lineWidthMm > 0 ? { borderWidth: lineWidthMm } : {}),
          ...(dash ? { borderDashArray: dash.map((length) => Math.max(0.01, length)) } : {}),
          ...(item.lineCap === 'round'
            ? { borderLineCap: LineCapStyle.Round }
            : item.lineCap === 'square'
              ? { borderLineCap: LineCapStyle.Projecting }
              : {}),
          opacity: clampOpacity(item.opacity),
        });
        outPage.pushOperators(popGraphicsState());
      }
    }

    if (textOverlays.length > 0) {
      for (const placement of textPlacements(sheetSide, totalSides, allPages, textOverlays, pageIndices)) {
        if (!Number.isFinite(placement.width) || !Number.isFinite(placement.height) || placement.width <= 0 || placement.height <= 0) continue;
        if (typeof document === 'undefined') throw new Error('Text overlay export requires a Canvas 2D renderer');
        if (placement.formulaError) throw new Error(`Invalid ${placement.text.kind === 'numbering' ? 'numbering formula or format' : 'text formula'} in overlay ${placement.text.id}`);
        const item = placement.renderText,
          w = placement.width * MM_TO_PT,
          h = placement.height * MM_TO_PT;
        const scale = Math.min(200 / 72, 4096 / w, 4096 / h);

        if (document.fonts) {
          const fontSpec = `${item.italic ? 'italic ' : ''}${item.bold ? 'bold' : 'normal'} 18px "${item.fontFamily.replace(/["\\]/g, '')}"`;
          const uniqueChars = Array.from(new Set(item.text)).sort().join('');
          const fontKey = `${fontSpec}|${uniqueChars}`;
          if (!loadedTextFonts.has(fontKey)) {
            try {
              await document.fonts.load(fontSpec, uniqueChars);
            } catch {
              /* local system fonts may resolve natively */
            }
            loadedTextFonts.add(fontKey);
          }
        }

        const key = JSON.stringify([item.text, item.fontFamily, item.fontSize, item.color, item.backgroundColor, item.bold, item.italic, item.underline, item.align, item.scriptRanges, item.lineHeight, item.letterSpacingPt, item.wordSpacingPt, w, h]);
        let wholeImage = textImages.get(key);

        // Reuse cached prefix + digit XObjects for dynamic numbering / digit strings so 1,000+ tickets embed ~11 tiny PNGs instead of 4,000+ PNGs!
        let drewCachedTokens = false;
        if (
          !wholeImage &&
          item.verticalAlign === 'middle' &&
          item.align !== 'justify' &&
          !item.text.includes('\n') &&
          !(item.scriptRanges?.length) &&
          !item.underline &&
          !(item.letterSpacingPt) &&
          !(item.wordSpacingPt)
        ) {
          const tokens = decomposeVisualTextTokens(item.text);
          const bgColor = item.backgroundColor && item.backgroundColor !== 'transparent' ? parseCssColorRgba(item.backgroundColor) : null;
          const bgOk = !item.backgroundColor || item.backgroundColor === 'transparent' || bgColor !== null;
          const measureCtx = bgOk ? getMeasureCtx() : null;
          if (tokens && measureCtx && typeof measureCtx.measureText === 'function') {
            const boxPxW = Math.max(1, Math.ceil(w * scale));
            const boxPxH = Math.max(1, Math.ceil(h * scale));
            const pxPerPt = scale;
            const lineHeight = Math.max(0.8, Math.min(3, item.lineHeight ?? 1.25));
            const requestedSize = Math.max(8, Math.min(80, item.fontSize)) * pxPerPt;
            const fontPx = item.verticalAlign === 'middle' && boxPxH > 0 ? Math.max(1, Math.min(requestedSize, (boxPxH * 0.88) / lineHeight)) : requestedSize;
            const insetPx = item.verticalAlign === 'middle' ? Math.min(boxPxW * 0.08, Math.max(fontPx * 0.35, 2 * pxPerPt)) : 0;
            const maxTextWidthPx = Math.max(1, boxPxW - insetPx * 2);
            const verticalOffsetPx = item.verticalAlign === 'middle' ? (boxPxH - fontPx * lineHeight) / 2 + fontPx / 2 : 0;
            const fontStr = `${item.italic ? 'italic ' : ''}${item.bold ? 'bold ' : ''}${fontPx}px "${item.fontFamily.replace(/["\\]/g, '')}", sans-serif`;

            measureCtx.font = fontStr;
            const refZeroAdv = measureCtx.measureText('0').width;
            const refZeroZeroAdv = measureCtx.measureText('00').width;
            if (Number.isFinite(refZeroAdv) && refZeroAdv > 0.5) {
              const padPx = Math.max(4, Math.ceil(fontPx * 0.25));
              const resolvedRuns: Array<
                | { kind: 'space'; widthPx: number }
                | { kind: 'glyph'; entry: { image: Awaited<ReturnType<typeof outPdf.embedPng>>; advPx: number; padPx: number; tokW: number } }
              > = [];
              let totalAdvPx = 0;
              let allValid = true;

              for (const tok of tokens) {
                if (tok.kind === 'space') {
                  const measuredPair = measureCtx.measureText(`0${tok.text}0`).width;
                  const gapPx = Number.isFinite(measuredPair) && refZeroZeroAdv > 0
                    ? Math.max(0, measuredPair - refZeroZeroAdv)
                    : Math.max(0, measureCtx.measureText(tok.text).width);
                  resolvedRuns.push({ kind: 'space', widthPx: gapPx });
                  totalAdvPx += gapPx;
                } else {
                  const tokKey = JSON.stringify([tok.text, tok.isRtl ? 1 : 0, item.fontFamily, fontPx.toFixed(2), item.color, item.bold, item.italic, boxPxH, item.verticalAlign ?? 'top']);
                  let entry = textTokenCache.get(tokKey);
                  if (!entry) {
                    const advPx = measureCtx.measureText(tok.text).width;
                    if (!Number.isFinite(advPx) || advPx <= 0.2) {
                      allValid = false;
                      break;
                    }
                    const tokW = Math.max(1, Math.ceil(advPx + padPx * 2));
                    const tokCanvas = document.createElement('canvas');
                    tokCanvas.width = tokW;
                    tokCanvas.height = boxPxH;
                    const tCtx = tokCanvas.getContext('2d');
                    if (!tCtx) {
                      allValid = false;
                      break;
                    }
                    tCtx.clearRect(0, 0, tokW, boxPxH);
                    tCtx.font = fontStr;
                    tCtx.textBaseline = item.verticalAlign === 'middle' ? 'middle' : 'top';
                    tCtx.textAlign = 'center';
                    tCtx.direction = tok.isRtl ? 'rtl' : 'ltr';
                    tCtx.fillStyle = item.color;
                    tCtx.fillText(tok.text, padPx + advPx / 2, verticalOffsetPx);
                    const pngBytes = await surfaceToPngBytes(tokCanvas);
                    tokCanvas.width = 0;
                    tokCanvas.height = 0;
                    const embedded = await outPdf.embedPng(pngBytes);
                    entry = { image: embedded, advPx, padPx, tokW };
                    textTokenCache.set(tokKey, entry);
                  }
                  resolvedRuns.push({ kind: 'glyph', entry });
                  totalAdvPx += entry.advPx;
                }
              }

              if (allValid && resolvedRuns.length > 0 && totalAdvPx > 0) {
                const fitScale = totalAdvPx > maxTextWidthPx ? maxTextWidthPx / totalAdvPx : 1;
                const drawnWidthPx = totalAdvPx * fitScale;
                let cursorPx =
                  item.align === 'right'
                    ? boxPxW - insetPx - drawnWidthPx
                    : item.align === 'center'
                      ? (boxPxW - drawnWidthPx) / 2
                      : insetPx;
                const opacity = clampOpacity(item.opacity);

                outPage.pushOperators(pushGraphicsState());
                if (placement.clip) {
                  const r = placement.clip;
                  outPage.pushOperators(rectangle(r.x * MM_TO_PT, sheetHeightPt - (r.y + r.height) * MM_TO_PT, r.width * MM_TO_PT, r.height * MM_TO_PT), clip(), endPath());
                }
                const parentAngle = (-placement.parentRotation * Math.PI) / 180,
                  pcx = (placement.parentX + placement.parentWidth / 2) * MM_TO_PT,
                  pcy = sheetHeightPt - (placement.parentY + placement.parentHeight / 2) * MM_TO_PT;
                if (parentAngle) {
                  const c = Math.cos(parentAngle),
                    s = Math.sin(parentAngle);
                  outPage.pushOperators(concatTransformationMatrix(c, s, -s, c, pcx - c * pcx + s * pcy, pcy - s * pcx - c * pcy));
                }
                const cx = (placement.x + placement.width / 2) * MM_TO_PT,
                  cy = sheetHeightPt - (placement.y + placement.height / 2) * MM_TO_PT;
                const angle = (-item.rotation * Math.PI) / 180,
                  c = Math.cos(angle),
                  s = Math.sin(angle);
                const boxOriginX = cx - (c * w) / 2 + (s * h) / 2;
                const boxOriginY = cy - (s * w) / 2 - (c * h) / 2;
                outPage.pushOperators(pushGraphicsState(), concatTransformationMatrix(c, s, -s, c, boxOriginX, boxOriginY));

                if (bgColor) {
                  outPage.drawRectangle({
                    x: 0,
                    y: 0,
                    width: w,
                    height: h,
                    color: rgb(bgColor.r, bgColor.g, bgColor.b),
                    opacity: clampOpacity(opacity * bgColor.alpha),
                  });
                }

                for (const run of resolvedRuns) {
                  if (run.kind === 'space') {
                    cursorPx += run.widthPx * fitScale;
                  } else {
                    const { image, advPx, padPx: entryPadPx, tokW } = run.entry;
                    outPage.drawImage(image, {
                      x: (cursorPx - entryPadPx * fitScale) / pxPerPt,
                      y: 0,
                      width: (tokW * fitScale) / pxPerPt,
                      height: h,
                      opacity,
                    });
                    cursorPx += advPx * fitScale;
                  }
                }
                outPage.pushOperators(popGraphicsState(), popGraphicsState());
                drewCachedTokens = true;
              }
            }
          }
        }

        if (!drewCachedTokens) {
          if (!wholeImage) {
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.ceil(w * scale));
            canvas.height = Math.max(1, Math.ceil(h * scale));
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('Text overlay Canvas 2D is unavailable');
            if (((item.letterSpacingPt ?? 0) !== 0 && !('letterSpacing' in ctx)) || ((item.wordSpacingPt ?? 0) !== 0 && !('wordSpacing' in ctx)))
              throw new Error('This environment cannot export the requested text spacing');
            drawOverlayText(ctx, item, canvas.width, canvas.height, canvas.width / w);
            const pngBytes = await surfaceToPngBytes(canvas);
            canvas.width = 0;
            canvas.height = 0;
            wholeImage = await outPdf.embedPng(pngBytes);
            textImages.set(key, wholeImage);
          }
          outPage.pushOperators(pushGraphicsState());
          if (placement.clip) {
            const r = placement.clip;
            outPage.pushOperators(rectangle(r.x * MM_TO_PT, sheetHeightPt - (r.y + r.height) * MM_TO_PT, r.width * MM_TO_PT, r.height * MM_TO_PT), clip(), endPath());
          }
          const parentAngle = (-placement.parentRotation * Math.PI) / 180,
            pcx = (placement.parentX + placement.parentWidth / 2) * MM_TO_PT,
            pcy = sheetHeightPt - (placement.parentY + placement.parentHeight / 2) * MM_TO_PT;
          if (parentAngle) {
            const c = Math.cos(parentAngle),
              s = Math.sin(parentAngle);
            outPage.pushOperators(concatTransformationMatrix(c, s, -s, c, pcx - c * pcx + s * pcy, pcy - s * pcx - c * pcy));
          }
          const cx = (placement.x + placement.width / 2) * MM_TO_PT,
            cy = sheetHeightPt - (placement.y + placement.height / 2) * MM_TO_PT;
          const angle = (-item.rotation * Math.PI) / 180,
            c = Math.cos(angle),
            s = Math.sin(angle);
          outPage.drawImage(wholeImage, { x: cx - (c * w) / 2 + (s * h) / 2, y: cy - (s * w) / 2 - (c * h) / 2, width: w, height: h, rotate: degrees(-item.rotation), opacity: clampOpacity(item.opacity) });
          outPage.pushOperators(popGraphicsState());
        }
      }
    }

    if (imageOverlays.length > 0) {
      for (const placement of imagePlacements(sheetSide, totalSides, allPages, imageOverlays, pageIndices)) {
        const item = placement.image;
        if (!Number.isFinite(placement.width) || !Number.isFinite(placement.height) || placement.width <= 0 || placement.height <= 0) continue;
        if (!item.src) throw new Error(`Image overlay ${item.id} lost its picture data`);
        const w = placement.width * MM_TO_PT,
          h = placement.height * MM_TO_PT;
        const rect = imageDrawRect(item, w, h);
        // The file's own bytes decide the route, never the declared MIME type: a JPEG saved as
        // data:image/png would otherwise be handed to the PNG decoder. Mirroring cannot be expressed
        // with a plain rectangle either, so those go through the same Canvas the preview composites on.
        let plan = picturePlanCache.get(item.src);
        if (!plan) {
          plan = planPictureEmbedding(item.src);
          picturePlanCache.set(item.src, plan);
        }
        // The file's own bytes decide the route, and so do the two flags that only exist inside the model: a
        // mirrored, inverted or eroded picture cannot be a raw embed any more, because the page has to show
        // something other than what the file contains. The overlay itself is untouched either way.
        const erase = eraseSignature(item.erase);
        const colorManagedInBrowser = typeof document !== 'undefined' && (plan.hasColorProfile || plan.cmyk);
        const needsRaster = plan.route === 'raster' || colorManagedInBrowser || !!item.flipHorizontal || !!item.flipVertical || !!item.invert || erase.length > 0;
        // Raw embeds depend on the bytes alone, so the same picture at two sizes is stored once.
        const key = needsRaster ? JSON.stringify([item.src, item.fit, item.flipHorizontal, item.flipVertical, !!item.invert, colorManagedInBrowser, erase, Math.round(w * 10), Math.round(h * 10)]) : item.src;
        let image = pictureImages.get(key);
        if (!image) {
          if (needsRaster) {
            if (typeof document === 'undefined') throw new Error('Exporting a flipped or unsupported picture needs a Canvas 2D renderer');
            const scale = Math.min(targetRasterDpi / 72, maxRasterSidePx / w, maxRasterSidePx / h);
            const png = await rasterizeOverlayImage(item.src, w * scale, h * scale, {
              fit: item.fit,
              naturalWidth: item.naturalWidth,
              naturalHeight: item.naturalHeight,
              flipHorizontal: item.flipHorizontal,
              flipVertical: item.flipVertical,
              drawRect: {
                x: rect.x * scale,
                y: rect.y * scale,
                width: Math.max(1, rect.width * scale),
                height: Math.max(1, rect.height * scale),
              },
              invert: item.invert,
              erase: item.erase,
              // `rect` is the fit rectangle in points; the eraser's percentages and its millimetre brush are
              // measured on exactly that rectangle, which is the piece of the box the picture actually paints.
              eraseWidthMm: rect.width / MM_TO_PT,
              eraseHeightMm: rect.height / MM_TO_PT,
            });
            image = await outPdf.embedPng(png);
          } else {
            image = plan.route === 'jpeg' ? await outPdf.embedJpg(item.src) : await outPdf.embedPng(item.src);
            // pdf-lib complements every CMYK stream it stores, which turns a plain CMYK file into a
            // colour negative; the image dictionary is shared, so one patch covers all placements.
            if (plan.patchDecode) await applyCmykDecode(outPdf, image);
          }
          pictureImages.set(key, image);
        }
        outPage.pushOperators(pushGraphicsState());
        if (placement.clip) {
          const r = placement.clip;
          outPage.pushOperators(rectangle(r.x * MM_TO_PT, sheetHeightPt - (r.y + r.height) * MM_TO_PT, r.width * MM_TO_PT, r.height * MM_TO_PT), clip(), endPath());
        }
        const parentAngle = (-placement.parentRotation * Math.PI) / 180,
          pcx = (placement.parentX + placement.parentWidth / 2) * MM_TO_PT,
          pcy = sheetHeightPt - (placement.parentY + placement.parentHeight / 2) * MM_TO_PT;
        if (parentAngle) {
          const c = Math.cos(parentAngle),
            s = Math.sin(parentAngle);
          outPage.pushOperators(concatTransformationMatrix(c, s, -s, c, pcx - c * pcx + s * pcy, pcy - s * pcx - c * pcy));
        }
        // The picture sits at its fit offset inside the box, and that offset rotates with the box.
        const offsetX = needsRaster ? 0 : rect.x + rect.width / 2 - w / 2,
          offsetY = needsRaster ? 0 : rect.y + rect.height / 2 - h / 2;
        const tilt = (item.rotation * Math.PI) / 180,
          tc = Math.cos(tilt),
          ts = Math.sin(tilt);
        const cx = (placement.x + placement.width / 2) * MM_TO_PT + offsetX * tc - offsetY * ts;
        const cy = sheetHeightPt - (placement.y + placement.height / 2) * MM_TO_PT - (offsetX * ts + offsetY * tc);
        const drawWidth = needsRaster ? w : rect.width,
          drawHeight = needsRaster ? h : rect.height;
        const angle = (-item.rotation * Math.PI) / 180,
          c = Math.cos(angle),
          s = Math.sin(angle);
        outPage.drawImage(image, {
          x: cx - (c * drawWidth) / 2 + (s * drawHeight) / 2,
          y: cy - (s * drawWidth) / 2 - (c * drawHeight) / 2,
          width: drawWidth,
          height: drawHeight,
          rotate: degrees(-item.rotation),
          opacity: clampOpacity(item.opacity),
        });
        outPage.pushOperators(popGraphicsState());
      }
    }

    const pct = Math.min(95, Math.max(5, Math.round(5 + ((sIdx + 1) / totalSides) * 90)));
    if (pct !== lastProgressReported) {
      lastProgressReported = pct;
      onProgress?.(pct);
    }
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (sIdx + 1 < sheets.length && now - lastYieldAt >= 20) {
      await yieldPdfExportTurn();
      lastYieldAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    }
  }
  } finally {
    for (const task of loadedPdfJsTasks.values()) {
      try {
        await task.destroy();
      } catch {
        // ignore cleanup errors
      }
    }
  }

  onProgress?.(98);
  if (sheets.length >= 20) {
    await yieldPdfExportTurn();
  }
  const finalBytes = await outPdf.save({ useObjectStreams: true });
  onProgress?.(100);
  return finalBytes;
}

/**
 * Helper to trigger browser/Electron file download of generated PDF or .psp bytes.
 */
export function triggerBlobDownload(
  bytes: Uint8Array | string,
  fileName: string,
  mimeType = 'application/pdf'
): void {
  if (
    typeof document === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) {
    return;
  }
  const safeBytes =
    typeof bytes === 'string'
      ? bytes
      : bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
        ? (bytes.buffer as ArrayBuffer)
        : (bytes.slice().buffer as ArrayBuffer);
  const blob = new Blob([safeBytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * Parses a human page/sheet range expression like "1-3, 5, 8-10" into 1-based indices.
 */
export function parsePageRangeText(rangeText: string, maxNumber: number): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const part of rangeText.split(/[,،;\s]+/)) {
    const token = part.trim();
    if (!token) continue;
    const rangeMatch = token.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const a = Math.max(1, Math.min(maxNumber, Number(rangeMatch[1])));
      const b = Math.max(1, Math.min(maxNumber, Number(rangeMatch[2])));
      const step = a <= b ? 1 : -1;
      for (let i = a; step > 0 ? i <= b : i >= b; i += step) {
        if (!seen.has(i)) {
          seen.add(i);
          out.push(i);
        }
      }
      continue;
    }
    if (/^\d+$/.test(token)) {
      const num = Number(token);
      if (num >= 1 && num <= maxNumber && !seen.has(num)) {
        seen.add(num);
        out.push(num);
      }
    }
  }
  return out;
}

/**
 * Renders imposed PDF sheet pages into high-resolution PNG byte arrays for direct
 * dispatch to Windows Spooler / GDI+ PrintDocument & WPF FixedDocument.
 * Returns [] cleanly in headless Node environments lacking Canvas 2D.
 */
export async function renderPdfToSheetPngs(
  pdfBytes: Uint8Array,
  dpi = 300,
  onProgress?: (rendered: number, total: number) => void,
  shouldCancel?: () => boolean
): Promise<Uint8Array[]> {
  if (shouldCancel?.()) {
    throw new Error('PRINT_CANCELED');
  }
  let canUseDomCanvas = false;
  if (typeof document !== 'undefined') {
    try {
      const testCanvas = document.createElement('canvas');
      canUseDomCanvas = Boolean(testCanvas.getContext?.('2d'));
    } catch {
      canUseDomCanvas = false;
    }
  }
  let canUseOffscreen = false;
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      canUseOffscreen = Boolean(new OffscreenCanvas(1, 1).getContext('2d'));
    } catch {
      canUseOffscreen = false;
    }
  }
  if (!canUseDomCanvas && !canUseOffscreen) {
    return [];
  }

  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const workerMod = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerMod.default;

  const targetDpi = Math.max(150, Math.min(300, Number.isFinite(dpi) ? dpi : 300));
  const task = pdfjsLib.getDocument({
    data: new Uint8Array(pdfBytes),
    useSystemFonts: true,
    isEvalSupported: false,
  });

  const pngs: Uint8Array[] = [];
  try {
    const pdf = await task.promise;
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
      if (shouldCancel?.()) {
        throw new Error('PRINT_CANCELED');
      }
      const page = await pdf.getPage(pageNo);
      try {
        const baseViewport = page.getViewport({ scale: 1 });
        const maxSidePx = 4200;
        const scale = Math.min(
          targetDpi / 72,
          maxSidePx / Math.max(1, baseViewport.width),
          maxSidePx / Math.max(1, baseViewport.height)
        );
        const viewport = page.getViewport({ scale });
        const width = Math.max(1, Math.ceil(viewport.width));
        const height = Math.max(1, Math.ceil(viewport.height));

        if (canUseDomCanvas) {
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('Canvas 2D context unavailable for print rasterization');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
          await page.render({ canvasContext: ctx, viewport }).promise;
          const blob = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png');
          });
          pngs.push(new Uint8Array(await blob.arrayBuffer()));
          canvas.width = 0;
          canvas.height = 0;
        } else {
          const canvas = new OffscreenCanvas(width, height);
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable for print rasterization');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
          await page.render({
            canvasContext: ctx as unknown as CanvasRenderingContext2D,
            viewport,
          }).promise;
          const blob = await canvas.convertToBlob({ type: 'image/png' });
          pngs.push(new Uint8Array(await blob.arrayBuffer()));
          canvas.width = 0;
          canvas.height = 0;
        }
        onProgress?.(pageNo, pdf.numPages);
      } finally {
        page.cleanup();
      }
      if (shouldCancel?.()) {
        throw new Error('PRINT_CANCELED');
      }
    }
  } finally {
    await task.destroy();
  }

  return pngs;
}

