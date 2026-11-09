/**
 * PrintStudio Pro — Real PDF & Image Import, Thumbnail Generator,
 * Imposition Vector Merger & Splitter Engine (A1, A4, C1, C2, D1-D5, E1, F1-F2)
 */

import {
  BlendMode,
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
  EffectsSettings,
  LayoutSettings,
  PageItem,
  PageNumberSettings,
  SourceDocument,
  WatermarkSettings,
} from '@shared/models';
import { computeImpositionSheets, sortCellsByLayer } from './layoutEngine';
import { normalizeAngle, pageCropFractions, rotateInsets } from './pageGeometry';
import { shouldApplyEffectsToPage } from './effectsPipeline';
import { formatPageNumberLabel, resolveTextMacros } from './watermarkEngine';
import { globalThumbnailCache } from './pageCache';
import {
  type RealPdfPageAnalysis,
} from './pdfRealRenderer';
import type {
  PdfWorkerRequest,
  PdfWorkerResponse,
} from './pdfRendererWorker';

const MM_TO_PT = 72 / 25.4; // 1 mm = 2.83464567 pt

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
  onProgress?: (current: number, total: number, fileName: string) => void
): Promise<ImportBatchResult> {
  const documents: SourceDocument[] = [];
  const pages: PageItem[] = [];
  const bookmarks: BookmarkItem[] = [];
  const errors: ImportErrorItem[] = [];

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
      const isImage =
        /\.(jpe?g|png|webp|bmp|gif|tiff?|heic|svg)$/i.test(lower) ||
        file.type.startsWith('image/');

      if (!isPdf && !isImage) {
        errors.push({
          fileName: file.name,
          reasonFa: `فرمت فایل «${file.name}» پشتیبانی نمی‌شود.`,
          solutionFa:
            'لطفاً فایل‌های PDF یا تصاویر استاندارد (JPG، PNG، TIFF، WEBP، BMP) را وارد کنید.',
          reasonEn: `Unsupported file format for "${file.name}".`,
          solutionEn:
            'Please import PDF or standard image files (JPG, PNG, TIFF, WEBP, BMP).',
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
        // Image import (A1 / C5)
        const imageDoc = await PDFDocument.create();
        const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
        const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
        if (!isPng && !isJpeg) throw new Error('Image format not supported for PDF export: use PNG or JPEG');
        const image = isPng ? await imageDoc.embedPng(bytes) : await imageDoc.embedJpg(bytes);
        // Fit the source aspect ratio into an A4-sized page without distorting pixels.
        const imageScale = Math.min(210 / image.width, 297 / image.height);
        const docId = `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const blobUrl = URL.createObjectURL(file);
        const pageId = `page-${docId}-1`;

        documents.push({
          id: docId,
          name: file.name,
          filePath: file.name,
          fileSize: file.size,
          fileType: 'image',
          mimeType: isPng ? 'image/png' : 'image/jpeg',
          pageCount: 1,
          createdAt: new Date().toISOString(),
          rawBytes: bytes,
        });

        globalThumbnailCache.set(pageId, blobUrl);

        pages.push({
          id: pageId,
          documentId: docId,
          documentName: file.name,
          sourcePageNumber: 1,
          widthMm: image.width * imageScale,
          heightMm: image.height * imageScale,
          rotation: 0,
          selectedForPrint: true,
          isHighlighted: i === 0,
          isBlankPage: false,
          colorProfile: 'color',
          inkCoveragePercent: 34.5,
          thumbnailDataUrl: blobUrl,
          previewLines: [`تصویر ورودی: ${file.name}`, `حجم: ${(file.size / 1024).toFixed(1)} KB`],
          previewAccentColor: '#059669',
        });

        bookmarks.push({
          id: `bm-${docId}`,
          title: file.name,
          documentId: docId,
          targetPageId: pageId,
          pageIndex: pages.length - 1,
          level: 0,
        });
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
  userName: string;
  onProgress?: (percent: number) => void;
}): Promise<Uint8Array> {
  const {
    documents,
    pages,
    layout,
    effects,
    watermark,
    pageNumbering,
    userName,
    onProgress,
  } = params;

  const outPdf = await PDFDocument.create();
  outPdf.setTitle('PrintStudio Pro — Imposed Output');
  outPdf.setAuthor(userName || 'PrintStudio Pro User');
  outPdf.setCreator('PrintStudio Pro v1.0');
  outPdf.setProducer('PrintStudio Pro Vector Imposition Engine (pdf-lib)');

  const font = await outPdf.embedFont(StandardFonts.Helvetica);
  const boldFont = await outPdf.embedFont(StandardFonts.HelveticaBold);

  // Cache loaded source PDFDocuments by documentId
  const loadedSourceDocs = new Map<string, PDFDocument>();
  const loadedImages = new Map<string, Awaited<ReturnType<typeof outPdf.embedPng>>>();
  for (const doc of documents) {
    if (doc.fileType === 'pdf' && doc.rawBytes) {
      const src = await PDFDocument.load(doc.rawBytes, { ignoreEncryption: false });
      loadedSourceDocs.set(doc.id, src);
    } else if (doc.fileType === 'image' && doc.rawBytes) {
      if (doc.mimeType === 'image/png') loadedImages.set(doc.id, await outPdf.embedPng(doc.rawBytes));
      else if (doc.mimeType === 'image/jpeg' || doc.mimeType === 'image/jpg') loadedImages.set(doc.id, await outPdf.embedJpg(doc.rawBytes));
      else throw new Error(`Unsupported image format: ${doc.mimeType}`);
    }
  }

  const sheets = computeImpositionSheets(pages, layout);
  const totalSides = Math.max(1, sheets.length);

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

      // Embed source PDF page if available
      const srcPdf = loadedSourceDocs.get(cell.page.documentId);
      const srcImage = loadedImages.get(cell.page.documentId);
      const rotation = cell.effectiveRotation;
      // Preview uses clockwise CSS rotation; PDF coordinates increase upwards.
      const rotated = rotation === 90 || rotation === 270;
      const drawPlacement = {
        x: contentXPt + (rotation === 180 || rotation === 270 ? contentWPt : 0),
        y: contentYPt + (rotation === 90 || rotation === 180 ? contentHPt : 0),
        width: rotated ? contentHPt : contentWPt,
        height: rotated ? contentWPt : contentHPt,
        rotate: degrees(-rotation),
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
      if (srcPdf && cell.page.sourcePageNumber > 0) {
        const pageIdxZero = cell.page.sourcePageNumber - 1;
        if (pageIdxZero >= srcPdf.getPageCount()) {
          throw new Error(`Invalid source page ${cell.page.sourcePageNumber} in ${cell.page.documentName}`);
        }
        const sourcePage = srcPdf.getPage(pageIdxZero);
        // The PDF thumbnail is rendered on white paper; keep that opaque paper when layers overlap.
        outPage.drawRectangle({ x:contentXPt, y:contentYPt, width:contentWPt, height:contentHPt, color:rgb(1,1,1) });
        // pdf-lib cannot embed a page with no Contents; such a page is empty.
        if (sourcePage.node.Contents()) {
          const box = sourcePage.getCropBox();
          const crop = pageCropFractions(cell.page);
          const [embeddedPage] = await outPdf.embedPages([sourcePage], [{
            left: box.x + box.width * crop.left,
            right: box.x + box.width * (1 - crop.right),
            bottom: box.y + box.height * crop.bottom,
            top: box.y + box.height * (1 - crop.top),
          }]);
          outPage.drawPage(embeddedPage, drawPlacement);
        }
      } else if (srcImage && cell.page.sourcePageNumber > 0) {
        const crop = rotateInsets(pageCropFractions(cell.page), rotation);
        const fullW = contentWPt / (1 - crop.left - crop.right);
        const fullH = contentHPt / (1 - crop.top - crop.bottom);
        const fullX = contentXPt - crop.left * fullW;
        const fullY = contentYPt - crop.bottom * fullH;
        outPage.pushOperators(pushGraphicsState(), rectangle(contentXPt, contentYPt, contentWPt, contentHPt), clip(), endPath());
        outPage.drawImage(srcImage, {
          x: fullX + (rotation === 180 || rotation === 270 ? fullW : 0),
          y: fullY + (rotation === 90 || rotation === 180 ? fullH : 0),
          width: rotated ? fullH : fullW,
          height: rotated ? fullW : fullH,
          rotate: degrees(-rotation),
        });
        outPage.pushOperators(popGraphicsState());
      } else if (cell.page.sourcePageNumber === 0 && cell.page.isBlankPage) {
        outPage.drawRectangle({ x:contentXPt, y:contentYPt, width:contentWPt, height:contentHPt, color:rgb(1,1,1) });
      } else if (cell.page.sourcePageNumber > 0) {
        throw new Error(`Missing or unsupported source for ${cell.page.documentName}; re-import the original file`);
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

      // E1: Vector Invert via PDF BlendMode.Difference over the cell
      const { effectiveInvert } = shouldApplyEffectsToPage(cell.page, effects);
      if (effectiveInvert) {
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

    // F1: Watermark on sheet
    if (watermark.enabled && watermark.text.trim().length > 0) {
      const firstPage = sheetSide.cells.find((c) => c.page !== null)?.page;
      const resolvedText = resolveTextMacros(watermark.text, {
        pageNumber: firstPage?.sourcePageNumber ?? sIdx + 1,
        totalPages: pages.length,
        sheetNumber: sheetSide.sheetNumber,
        totalSheets: totalSides,
        fileName: firstPage?.documentName ?? 'PrintStudio',
        userName,
      });
      // Use ASCII-safe representation for StandardFonts in PDF stream while keeping full Persian in UI/Canvas
      const asciiSafeText = resolvedText.replace(/[^\x20-\x7E]/g, '').trim() || 'PrintStudio Pro';
      outPage.drawText(asciiSafeText, {
        x: sheetWidthPt * 0.25,
        y: sheetHeightPt * 0.5,
        size: Math.max(12, watermark.fontSizePt),
        font: boldFont,
        color: rgb(0.05, 0.45, 0.75),
        opacity: watermark.opacity,
        rotate: degrees(watermark.rotationDeg),
      });
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

    onProgress?.(Math.round(((sIdx + 1) / totalSides) * 100));
  }

  return outPdf.save();
}

/**
 * Helper to trigger browser/Electron file download of generated PDF or .psp bytes.
 */
export function triggerBlobDownload(
  bytes: Uint8Array | string,
  fileName: string,
  mimeType = 'application/pdf'
): void {
  const blob =
    typeof bytes === 'string'
      ? new Blob([bytes], { type: mimeType })
      : new Blob([bytes.buffer as ArrayBuffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
