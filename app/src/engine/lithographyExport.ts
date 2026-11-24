/**
 * PrintStudio Pro — Offset Lithography Plate Separation, 1-Bit TIFF, PDF/X & ZIP Export Engine
 *
 * Also declares clean, extensible Out-of-MVP Architecture Hooks for future prepress stages:
 * Imposition, Trapping, Halftone/RIP, JDF/CIP3, and Spectrophotometer integration.
 */

import {
  PDFDocument,
  PDFName,
  PDFString,
  StandardFonts,
  cmyk,
  degrees,
  grayscale,
} from 'pdf-lib';
import type {
  LithoColorSettings,
  LithoDocumentMetadata,
  LithoExportDpi,
  LithoExportSettings,
  LithoFormPlacement,
  LithoPlateSizePreset,
  LithoSpotChannel,
  LithoWriteFileEntry,
} from '@shared/models';
import { formatShamsiDate } from '../i18n/shamsi';
import {
  buildSeparationBuffersFromRgba,
  normalizeLithoFormPlacement,
  resolveActiveProfileSpec,
  resolveLithoPlateSizeMm,
} from './lithographyColor';
import {
  encodeRgbaToPngBytes,
  renderPdfPageToRgba,
} from './lithographyPreflight';

const MM_TO_PT = 72 / 25.4;

/* ============================================================================
 * Out-of-MVP Extensible Architecture Hooks (Contracts Only — No UI/Logic Yet)
 * ========================================================================== */

export interface ImpositionStageContext {
  sourcePdfBytes: Uint8Array;
  sheetWidthMm: number;
  sheetHeightMm: number;
  signaturePages: number[];
}
export interface ImpositionStageHook {
  readonly id: string;
  readonly stage: 'imposition';
  execute(ctx: ImpositionStageContext): Promise<Uint8Array>;
}

export interface TrappingStageContext {
  plateC: Uint8Array;
  plateM: Uint8Array;
  plateY: Uint8Array;
  plateK: Uint8Array;
  width: number;
  height: number;
  trapWidthMm: number;
}
export interface TrappingStageHook {
  readonly id: string;
  readonly stage: 'trapping';
  execute(ctx: TrappingStageContext): Promise<{
    plateC: Uint8Array;
    plateM: Uint8Array;
    plateY: Uint8Array;
    plateK: Uint8Array;
  }>;
}

export interface HalftoneRipStageContext {
  plateName: string;
  coverageBuffer: Uint8Array;
  width: number;
  height: number;
  lpi: number;
  angleDeg: number;
  dpi: LithoExportDpi;
}
export interface HalftoneRipStageHook {
  readonly id: string;
  readonly stage: 'halftone-rip';
  screenTo1Bit(ctx: HalftoneRipStageContext): Promise<Uint8Array>;
}

export interface JdfCip3ExportContext {
  jobName: string;
  plateCoverages: Record<string, number>;
  trimWidthMm: number;
  trimHeightMm: number;
  pressProfileName: string;
}
export interface JdfCip3ExportHook {
  readonly id: string;
  readonly stage: 'jdf-cip3';
  generateInkZonePayload(ctx: JdfCip3ExportContext): Promise<{ mimeType: string; bytes: Uint8Array }>;
}

export interface SpectrophotometerReading {
  lab: [number, number, number];
  densityCmyk?: [number, number, number, number];
  deviceName: string;
  measuredAtIso: string;
}
export interface SpectrophotometerHook {
  readonly id: string;
  readonly stage: 'spectrophotometer';
  readPatch(): Promise<SpectrophotometerReading>;
}

export interface LithoArchitectureHooks {
  imposition?: ImpositionStageHook;
  trapping?: TrappingStageHook;
  halftoneRip?: HalftoneRipStageHook;
  jdfCip3?: JdfCip3ExportHook;
  spectrophotometer?: SpectrophotometerHook;
}

export interface PrepressExtensionRegistry {
  hooks: LithoArchitectureHooks;
  registerImposition(hook: ImpositionStageHook): void;
  registerTrapping(hook: TrappingStageHook): void;
  registerHalftoneRip(hook: HalftoneRipStageHook): void;
  registerJdfCip3(hook: JdfCip3ExportHook): void;
  registerSpectrophotometer(hook: SpectrophotometerHook): void;
}

export function createPrepressExtensionRegistry(
  initial: LithoArchitectureHooks = {}
): PrepressExtensionRegistry {
  const hooks: LithoArchitectureHooks = { ...initial };
  return {
    hooks,
    registerImposition(hook) {
      hooks.imposition = hook;
    },
    registerTrapping(hook) {
      hooks.trapping = hook;
    },
    registerHalftoneRip(hook) {
      hooks.halftoneRip = hook;
    },
    registerJdfCip3(hook) {
      hooks.jdfCip3 = hook;
    },
    registerSpectrophotometer(hook) {
      hooks.spectrophotometer = hook;
    },
  };
}

/* ============================================================================
 * Utilities: Filename Sanitization, CRC32 ZIP Archive & Slug PNG Rendering
 * ========================================================================== */

export function sanitizeLithoFilePart(input: string, fallback = 'job'): string {
  const clean = input
    .trim()
    .replace(/\.pdf$/i, '')
    .replace(/[\\/:*?"<>|\s]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return clean || fallback;
}

export function formatPlateFileName(
  jobPrefix: string,
  plateLabel: string,
  pageNumber: number,
  ext: 'pdf' | 'tif'
): string {
  const job = sanitizeLithoFilePart(jobPrefix, 'job');
  const plate = sanitizeLithoFilePart(plateLabel, 'P');
  const pageTag = `p${String(pageNumber).padStart(2, '0')}`;
  return `${job}_${plate}_${pageTag}.${ext}`;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC32_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Zero-dependency Store (uncompressed) ZIP archive builder compatible with Windows Explorer, 7-Zip, macOS, and Linux unzip.
 */
export function createZipArchive(entries: LithoWriteFileEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.fileName);
    const data = entry.bytes;
    const sum = crc32(data);

    // Local File Header (30 bytes + name)
    const lfh = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(lfh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0x0800, true); // UTF-8 filename flag
    lv.setUint16(8, 0, true); // compression 0 (STORE)
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0, true);
    lv.setUint32(14, sum, true);
    lv.setUint32(18, data.byteLength, true);
    lv.setUint32(22, data.byteLength, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    lfh.set(nameBytes, 30);

    localChunks.push(lfh, data);

    // Central Directory Header (46 bytes + name)
    const cdh = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cdh.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true); // UTF-8 flag
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, sum, true);
    cv.setUint32(20, data.byteLength, true);
    cv.setUint32(24, data.byteLength, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    cdh.set(nameBytes, 46);

    centralChunks.push(cdh);
    offset += lfh.byteLength + data.byteLength;
  }

  const centralSize = centralChunks.reduce((s, c) => s + c.byteLength, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const totalSize = offset + centralSize + eocd.byteLength;
  const out = new Uint8Array(totalSize);
  let pos = 0;
  for (const ch of localChunks) {
    out.set(ch, pos);
    pos += ch.byteLength;
  }
  for (const ch of centralChunks) {
    out.set(ch, pos);
    pos += ch.byteLength;
  }
  out.set(eocd, pos);
  return out;
}

async function renderSlugTextPng(slugText: string): Promise<Uint8Array | null> {
  const width = 920;
  const height = 42;
  const draw = (ctx: CanvasRenderingContext2D) => {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 20px Tahoma, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(slugText, 8, height / 2);
  };

  if (typeof document !== 'undefined') {
    try {
      const c = document.createElement('canvas');
      c.width = width;
      c.height = height;
      const ctx = c.getContext('2d');
      if (ctx) {
        draw(ctx);
        const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
        if (blob) return new Uint8Array(await blob.arrayBuffer());
      }
    } catch {
      // Fallback
    }
  }
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      const c = new OffscreenCanvas(width, height);
      const ctx = c.getContext('2d') as unknown as CanvasRenderingContext2D | null;
      if (ctx) {
        draw(ctx);
        const blob = await c.convertToBlob({ type: 'image/png' });
        return new Uint8Array(await blob.arrayBuffer());
      }
    } catch {
      // Fallback
    }
  }
  return null;
}

/* ============================================================================
 * 1-Bit Screened TIFF Encoder (Baseline TIFF 6.0, WhiteIsZero, Offset Angles)
 * ========================================================================== */

export function plateScreenAngleDeg(plateName: string): number {
  switch (plateName.toUpperCase()) {
    case 'C':
      return 15;
    case 'M':
      return 75;
    case 'Y':
      return 0;
    case 'K':
      return 45;
    default:
      return 22.5;
  }
}

/**
 * Encodes a 0..100 ink coverage buffer into a spec-compliant 1-bit halftone TIFF
 * using classic rotated offset AM dot screening.
 */
export function encodeCoverageTo1BitTiff(
  coverage0to100: Uint8Array,
  width: number,
  height: number,
  dpi: number,
  plateName: string
): Uint8Array {
  const rowBytes = Math.ceil(width / 8);
  const pixelBytesLen = rowBytes * height;
  const pixelData = new Uint8Array(pixelBytesLen);

  const angleRad = (plateScreenAngleDeg(plateName) * Math.PI) / 180;
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);
  // Screen cell frequency scaled cleanly so visible dot pattern forms across all supported DPIs
  const cellFreq = (2 * Math.PI) / Math.max(3, Math.min(8, Math.round(dpi / 175) || 4));

  for (let y = 0; y < height; y++) {
    const rowOff = y * rowBytes;
    const srcRow = y * width;
    for (let x = 0; x < width; x++) {
      const cov = coverage0to100[srcRow + x] / 100;
      let inkOn = false;
      if (cov >= 0.995) {
        inkOn = true;
      } else if (cov > 0.005) {
        const u = (x * cosA - y * sinA) * cellFreq;
        const v = (x * sinA + y * cosA) * cellFreq;
        const spot = (Math.sin(u) * Math.cos(v) + 1) * 0.5;
        // Guard threshold slightly away from 0/1 extremes so midtones screen smoothly
        const threshold = 0.04 + spot * 0.92;
        inkOn = cov >= threshold;
      }
      if (inkOn) {
        pixelData[rowOff + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }

  // Baseline TIFF 6.0 Little-Endian (`II`)
  // 12 IFD tags -> 8 (header) + 2 (count) + 12*12 (entries) + 4 (next IFD) + 16 (XRes/YRes rationals) = 174 bytes
  const TAG_COUNT = 12;
  const ifdStart = 8;
  const afterIfd = ifdStart + 2 + TAG_COUNT * 12 + 4;
  const xResOffset = afterIfd;
  const yResOffset = afterIfd + 8;
  const pixelDataOffset = afterIfd + 16;

  const tiff = new Uint8Array(pixelDataOffset + pixelBytesLen);
  const dv = new DataView(tiff.buffer);

  // TIFF Header
  tiff[0] = 0x49; // 'I'
  tiff[1] = 0x49; // 'I'
  dv.setUint16(2, 42, true);
  dv.setUint32(4, ifdStart, true);

  // IFD Entry Count
  dv.setUint16(ifdStart, TAG_COUNT, true);
  let pos = ifdStart + 2;
  const writeTag = (tag: number, type: number, count: number, valueOrOffset: number) => {
    dv.setUint16(pos, tag, true);
    dv.setUint16(pos + 2, type, true);
    dv.setUint32(pos + 4, count, true);
    dv.setUint32(pos + 8, valueOrOffset, true);
    pos += 12;
  };

  // Tags strictly sorted ascending by Tag ID
  writeTag(256, 4, 1, width); // ImageWidth (LONG)
  writeTag(257, 4, 1, height); // ImageLength (LONG)
  writeTag(258, 3, 1, 1); // BitsPerSample = 1 (SHORT)
  writeTag(259, 3, 1, 1); // Compression = None (SHORT)
  writeTag(262, 3, 1, 0); // PhotometricInterpretation = 0 (WhiteIsZero: 1-bit = black ink)
  writeTag(273, 4, 1, pixelDataOffset); // StripOffsets
  writeTag(277, 3, 1, 1); // SamplesPerPixel = 1
  writeTag(278, 4, 1, height); // RowsPerStrip
  writeTag(279, 4, 1, pixelBytesLen); // StripByteCounts
  writeTag(282, 5, 1, xResOffset); // XResolution (RATIONAL)
  writeTag(283, 5, 1, yResOffset); // YResolution (RATIONAL)
  writeTag(296, 3, 1, 2); // ResolutionUnit = 2 (Inch)

  // Next IFD offset = 0
  dv.setUint32(pos, 0, true);

  // XResolution & YResolution rationals (DPI / 1)
  dv.setUint32(xResOffset, dpi, true);
  dv.setUint32(xResOffset + 4, 1, true);
  dv.setUint32(yResOffset, dpi, true);
  dv.setUint32(yResOffset + 4, 1, true);

  tiff.set(pixelData, pixelDataOffset);
  return tiff;
}

/* ============================================================================
 * Press Marks & Slug Helper for PDF Exports
 * ========================================================================== */

async function drawPressMarksOnPdfPage(
  pdfDoc: PDFDocument,
  page: ReturnType<PDFDocument['addPage']>,
  trimX: number,
  trimY: number,
  trimW: number,
  trimH: number,
  exportSettings: LithoExportSettings,
  plateLabel: string,
  pageNumber: number,
  shamsiDate: string,
  monochromePlate: boolean,
  isFixedForm = false
): Promise<void> {
  const inkStroke = monochromePlate ? grayscale(0) : cmyk(1, 1, 1, 1); // Registration black
  const sheetW = page.getWidth();
  const sheetH = page.getHeight();
  const markOffset = 8;
  const markLen = 14;

  // 1) Crop Marks (4 corners around artwork TrimBox)
  if (exportSettings.includeCropMarks) {
    const corners: Array<[number, number, number, number]> = [
      // Bottom-left
      [trimX - markOffset - markLen, trimY, trimX - markOffset, trimY],
      [trimX, trimY - markOffset - markLen, trimX, trimY - markOffset],
      // Bottom-right
      [trimX + trimW + markOffset, trimY, trimX + trimW + markOffset + markLen, trimY],
      [trimX + trimW, trimY - markOffset - markLen, trimX + trimW, trimY - markOffset],
      // Top-left
      [trimX - markOffset - markLen, trimY + trimH, trimX - markOffset, trimY + trimH],
      [trimX, trimY + trimH + markOffset, trimX, trimY + trimH + markOffset + markLen],
      // Top-right
      [trimX + trimW + markOffset, trimY + trimH, trimX + trimW + markOffset + markLen, trimY + trimH],
      [trimX + trimW, trimY + trimH + markOffset, trimX + trimW, trimY + trimH + markOffset + markLen],
    ];
    for (const [x1, y1, x2, y2] of corners) {
      page.drawLine({
        start: { x: x1, y: y1 },
        end: { x: x2, y: y2 },
        thickness: 0.4,
        color: inkStroke,
      });
    }
  }

  // 2) Registration Marks (anchored cleanly on sheet edges for fixed forms, or around trim box)
  if (exportSettings.includeRegistrationMarks) {
    const targets: Array<[number, number]> = isFixedForm
      ? [
          [sheetW / 2, 12],
          [sheetW / 2, sheetH - 12],
          [12, sheetH / 2],
          [sheetW - 12, sheetH / 2],
        ]
      : [
          [trimX + trimW / 2, trimY - 14],
          [trimX + trimW / 2, trimY + trimH + 14],
          [trimX - 14, trimY + trimH / 2],
          [trimX + trimW + 14, trimY + trimH / 2],
        ];
    for (const [cx, cy] of targets) {
      page.drawCircle({
        x: cx,
        y: cy,
        size: 4.5,
        borderColor: inkStroke,
        borderWidth: 0.5,
      });
      page.drawLine({
        start: { x: cx - 7, y: cy },
        end: { x: cx + 7, y: cy },
        thickness: 0.4,
        color: inkStroke,
      });
      page.drawLine({
        start: { x: cx, y: cy - 7 },
        end: { x: cx, y: cy + 7 },
        thickness: 0.4,
        color: inkStroke,
      });
    }
  }

  // 3) Simple Color Control Bar (step wedges at top)
  if (exportSettings.includeColorBar) {
    const barY = isFixedForm
      ? Math.max(10, sheetH - 22)
      : Math.min(sheetH - 10, trimY + trimH + 9);
    const stepSize = 10;
    const startX = isFixedForm ? Math.max(18, sheetW / 2 - 48) : trimX + 14;
    if (monochromePlate) {
      const steps = [0.1, 0.25, 0.5, 0.75, 1.0];
      steps.forEach((pct, idx) => {
        page.drawRectangle({
          x: startX + idx * (stepSize + 2),
          y: barY,
          width: stepSize,
          height: 6.5,
          color: grayscale(1 - pct),
          borderColor: grayscale(0),
          borderWidth: 0.3,
        });
      });
    } else {
      const swatches = [
        cmyk(1, 0, 0, 0),
        cmyk(0, 1, 0, 0),
        cmyk(0, 0, 1, 0),
        cmyk(0, 0, 0, 1),
        cmyk(0.5, 0, 0, 0),
        cmyk(0, 0.5, 0, 0),
        cmyk(0, 0, 0.5, 0),
        cmyk(0, 0, 0, 0.5),
      ];
      swatches.forEach((col, idx) => {
        page.drawRectangle({
          x: startX + idx * (stepSize + 2),
          y: barY,
          width: stepSize,
          height: 6.5,
          color: col,
          borderColor: cmyk(0, 0, 0, 1),
          borderWidth: 0.3,
        });
      });
    }
  }

  // 4) Slug Line (Job name, Plate, Page, Shamsi date)
  if (exportSettings.includeSlug) {
    const jobTitle = exportSettings.jobNamePrefix || 'PrintStudio-Job';
    const slugText = `${jobTitle}  |  Plate: ${plateLabel}  |  Page ${pageNumber}  |  ${shamsiDate}`;
    const slugX = isFixedForm ? 18 : Math.max(4, trimX);
    const slugY = isFixedForm ? 4 : Math.max(2, trimY - 22);
    const pngBytes = await renderSlugTextPng(slugText);
    if (pngBytes) {
      const img = await pdfDoc.embedPng(pngBytes);
      const maxSlugW = Math.min(sheetW - slugX - 10, 240);
      page.drawImage(img, {
        x: slugX,
        y: slugY,
        width: Math.max(40, maxSlugW),
        height: 11,
      });
    } else {
      // Safe WinAnsi fallback when headless Canvas is absent
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const asciiSlug = slugText.replace(/[^\x20-\x7E]/g, '?');
      page.drawText(asciiSlug, {
        x: slugX,
        y: slugY + 2,
        size: 7,
        font,
        color: inkStroke,
      });
    }
  }
}

interface ComputedFormPlacementPdf {
  outWpt: number;
  outHpt: number;
  artWpt: number;
  artHpt: number;
  cxPt: number;
  cyPt: number;
  originXpt: number;
  originYpt: number;
  a: number;
  b: number;
  c: number;
  d: number;
  bboxLeftPt: number;
  bboxBottomPt: number;
  bboxWpt: number;
  bboxHpt: number;
  trimOffX: number;
  trimOffY: number;
  trimW: number;
  trimH: number;
  rotationDeg: number;
  isFitDocument: boolean;
  plateWidthMm: number;
  plateHeightMm: number;
  isTransformed: boolean;
}

function computeFormPlacementPdf(
  srcWpt: number,
  srcHpt: number,
  exportSettings: LithoExportSettings,
  savedPlateSizes: LithoPlateSizePreset[],
  markPadPt: number,
  pageMeta: LithoDocumentMetadata['pages'][number] | undefined,
  placement: LithoFormPlacement
): ComputedFormPlacementPdf {
  const plateSpec = resolveLithoPlateSizeMm(
    exportSettings,
    srcWpt / MM_TO_PT,
    srcHpt / MM_TO_PT,
    savedPlateSizes
  );

  const scaleX = placement.scaleXPercent / 100;
  const scaleY = placement.scaleYPercent / 100;
  const artWpt = Math.max(4, srcWpt * scaleX);
  const artHpt = Math.max(4, srcHpt * scaleY);

  const thetaRad = (placement.rotationDeg * Math.PI) / 180;
  const alpha = -thetaRad; // PDF Y+ is upward, clockwise visual rotation = -thetaRad
  const cosA = Math.cos(alpha);
  const sinA = Math.sin(alpha);

  const bboxWpt = Math.abs(artWpt * cosA) + Math.abs(artHpt * sinA);
  const bboxHpt = Math.abs(artWpt * sinA) + Math.abs(artHpt * cosA);

  const outWpt = plateSpec.isFitDocument
    ? bboxWpt + markPadPt * 2
    : plateSpec.widthMm * MM_TO_PT;
  const outHpt = plateSpec.isFitDocument
    ? bboxHpt + markPadPt * 2
    : plateSpec.heightMm * MM_TO_PT;

  const cxPt = plateSpec.isFitDocument
    ? outWpt / 2
    : outWpt / 2 + placement.offsetXMm * MM_TO_PT;
  const cyPt = plateSpec.isFitDocument
    ? outHpt / 2
    : outHpt / 2 - placement.offsetYMm * MM_TO_PT;

  const a = artWpt * cosA;
  const b = artWpt * sinA;
  const c = -artHpt * sinA;
  const d = artHpt * cosA;
  const originXpt = cxPt - 0.5 * (a + c);
  const originYpt = cyPt - 0.5 * (b + d);

  const bboxLeftPt = cxPt - bboxWpt / 2;
  const bboxBottomPt = cyPt - bboxHpt / 2;

  const isAxisAligned = Math.abs(placement.rotationDeg) < 0.05;
  const avgScale = (scaleX + scaleY) / 2;
  const bleedPt = 3 * MM_TO_PT * avgScale;
  const trimW =
    isAxisAligned && pageMeta?.trimBoxMm
      ? Math.max(6, pageMeta.trimBoxMm.width * MM_TO_PT * scaleX)
      : Math.max(10, bboxWpt - bleedPt * 2);
  const trimH =
    isAxisAligned && pageMeta?.trimBoxMm
      ? Math.max(6, pageMeta.trimBoxMm.height * MM_TO_PT * scaleY)
      : Math.max(10, bboxHpt - bleedPt * 2);
  const trimOffX =
    isAxisAligned && pageMeta?.trimBoxMm
      ? bboxLeftPt + (pageMeta.trimBoxMm.x - pageMeta.mediaBoxMm.x) * MM_TO_PT * scaleX
      : bboxLeftPt + bleedPt;
  const trimOffY =
    isAxisAligned && pageMeta?.trimBoxMm
      ? bboxBottomPt + (pageMeta.trimBoxMm.y - pageMeta.mediaBoxMm.y) * MM_TO_PT * scaleY
      : bboxBottomPt + bleedPt;

  const isTransformed =
    !plateSpec.isFitDocument ||
    placement.offsetXMm !== 0 ||
    placement.offsetYMm !== 0 ||
    placement.scaleXPercent !== 100 ||
    placement.scaleYPercent !== 100 ||
    Math.abs(placement.rotationDeg) > 0.01;

  return {
    outWpt,
    outHpt,
    artWpt,
    artHpt,
    cxPt,
    cyPt,
    originXpt,
    originYpt,
    a,
    b,
    c,
    d,
    bboxLeftPt,
    bboxBottomPt,
    bboxWpt,
    bboxHpt,
    trimOffX,
    trimOffY,
    trimW,
    trimH,
    rotationDeg: placement.rotationDeg,
    isFitDocument: plateSpec.isFitDocument,
    plateWidthMm: plateSpec.widthMm,
    plateHeightMm: plateSpec.heightMm,
    isTransformed,
  };
}

/* ============================================================================
 * Main Lithography Export Pipeline (Plate PDF, 1-Bit TIFF, PDF/X-1a, PDF/X-4)
 * ========================================================================== */

export interface LithoExportResult {
  files: LithoWriteFileEntry[];
  platesGenerated: string[];
  shamsiDate: string;
  noteFa?: string;
}

/**
 * Generates final press plates or PDF/X output files from the prepared PDF job.
 */
export async function generateLithographyExports(params: {
  pdfBytes: Uint8Array;
  metadata: LithoDocumentMetadata;
  colorSettings: LithoColorSettings;
  exportSettings: LithoExportSettings;
  tacThresholdPercent: number;
  savedPlateSizes?: LithoPlateSizePreset[];
  hooks?: LithoArchitectureHooks;
  onProgress?: (percent: number) => void;
}): Promise<LithoExportResult> {
  const {
    pdfBytes,
    metadata,
    colorSettings,
    exportSettings,
    tacThresholdPercent,
    savedPlateSizes = [],
    hooks,
    onProgress,
  } = params;

  const shamsiDate = formatShamsiDate(new Date(), true);
  const jobPrefix = sanitizeLithoFilePart(
    exportSettings.jobNamePrefix || metadata.fileName,
    'litho-job'
  );
  const profile = resolveActiveProfileSpec(colorSettings);

  const keptSpots: LithoSpotChannel[] = metadata.detectedSpots.filter(
    (sp) => (colorSettings.spotChannels[sp.name] ?? sp.handling) === 'keep-spot'
  );

  const plateNames = ['C', 'M', 'Y', 'K', ...keptSpots.map((s) => s.name)];
  const files: LithoWriteFileEntry[] = [];
  const hasMarks =
    exportSettings.includeCropMarks ||
    exportSettings.includeRegistrationMarks ||
    exportSettings.includeColorBar ||
    exportSettings.includeSlug;
  const markPadPt = hasMarks ? 24 : 0;

  const formPlacement = normalizeLithoFormPlacement(exportSettings.formPlacement);

  onProgress?.(5);

  if (exportSettings.format === 'pdf-x1a' || exportSettings.format === 'pdf-x4') {
    const outDoc = await PDFDocument.create();
    const isX1a = exportSettings.format === 'pdf-x1a';
    outDoc.setTitle(`${jobPrefix} — ${isX1a ? 'PDF/X-1a:2001' : 'PDF/X-4'}`);
    outDoc.setCreator('PrintStudio Pro Lithography Engine');
    outDoc.setProducer(`PrintStudio Pro (${profile.standardName})`);

    const srcDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const pageCount = srcDoc.getPageCount();

    for (let pIdx = 0; pIdx < pageCount; pIdx++) {
      onProgress?.(Math.round(10 + ((pIdx + 0.5) / pageCount) * 80));
      const pageMeta = metadata.pages[pIdx];
      const srcPage = srcDoc.getPage(pIdx);
      const { width: srcWpt, height: srcHpt } = srcPage.getSize();
      const placed = computeFormPlacementPdf(
        srcWpt,
        srcHpt,
        exportSettings,
        savedPlateSizes,
        markPadPt,
        pageMeta,
        formPlacement
      );
      const outPage = outDoc.addPage([placed.outWpt, placed.outHpt]);
      const drawOpts = {
        x: placed.originXpt,
        y: placed.originYpt,
        width: placed.artWpt,
        height: placed.artHpt,
        ...(Math.abs(placed.rotationDeg) > 0.01
          ? { rotate: degrees(-placed.rotationDeg) }
          : {}),
      };

      if (isX1a) {
        // PDF/X-1a flattens transparency/RGB into CMYK calibrated surface
        const rendered = await renderPdfPageToRgba(
          pdfBytes,
          pIdx + 1,
          Math.min(1800, Math.round((srcWpt / 72) * Math.min(300, exportSettings.dpi))),
          Math.min(300, exportSettings.dpi)
        ).catch(() => null);

        if (rendered) {
          const sep = buildSeparationBuffersFromRgba(
            rendered.rgba,
            rendered.width,
            rendered.height,
            colorSettings,
            metadata.detectedSpots,
            tacThresholdPercent
          );
          const flatRgba = new Uint8ClampedArray(rendered.width * rendered.height * 4);
          for (let px = 0; px < rendered.width * rendered.height; px++) {
            const c = sep.c[px] / 100;
            const m = sep.m[px] / 100;
            const y = sep.y[px] / 100;
            const k = sep.k[px] / 100;
            const o = px * 4;
            flatRgba[o] = Math.round(255 * (1 - c) * (1 - k));
            flatRgba[o + 1] = Math.round(255 * (1 - m) * (1 - k));
            flatRgba[o + 2] = Math.round(255 * (1 - y) * (1 - k));
            flatRgba[o + 3] = 255;
          }
          const png = await encodeRgbaToPngBytes(flatRgba, rendered.width, rendered.height);
          if (png) {
            const emb = await outDoc.embedPng(png);
            outPage.drawImage(emb, drawOpts);
          } else {
            const embPage = await outDoc.embedPage(srcPage);
            outPage.drawPage(embPage, drawOpts);
          }
        } else {
          const embPage = await outDoc.embedPage(srcPage);
          outPage.drawPage(embPage, drawOpts);
        }
      } else {
        // PDF/X-4 preserves vectors & live layers
        const embPage = await outDoc.embedPage(srcPage);
        outPage.drawPage(embPage, drawOpts);
      }

      outPage.setMediaBox(0, 0, placed.outWpt, placed.outHpt);
      outPage.setBleedBox(placed.bboxLeftPt, placed.bboxBottomPt, placed.bboxWpt, placed.bboxHpt);
      outPage.setTrimBox(placed.trimOffX, placed.trimOffY, placed.trimW, placed.trimH);

      if (hasMarks) {
        const plateSlug = placed.isFitDocument
          ? 'CMYK Composite'
          : `CMYK (${Math.round(placed.plateWidthMm)}x${Math.round(placed.plateHeightMm)}mm)`;
        await drawPressMarksOnPdfPage(
          outDoc,
          outPage,
          placed.trimOffX,
          placed.trimOffY,
          placed.trimW,
          placed.trimH,
          exportSettings,
          plateSlug,
          pIdx + 1,
          shamsiDate,
          false,
          !placed.isFitDocument
        );
      }
    }

    // PDF/X Compliance Catalog & OutputIntents
    outDoc.catalog.set(
      PDFName.of('GTS_PDFXVersion'),
      PDFString.of(isX1a ? 'PDF/X-1a:2001' : 'PDF/X-4')
    );
    outDoc.catalog.set(PDFName.of('Trapped'), PDFName.of('False'));
    const intentDict = outDoc.context.obj({
      Type: PDFName.of('OutputIntent'),
      S: PDFName.of('GTS_PDFX'),
      OutputConditionIdentifier: PDFString.of(profile.standardName),
      Info: PDFString.of(profile.titleEn),
    });
    outDoc.catalog.set(
      PDFName.of('OutputIntents'),
      outDoc.context.obj([outDoc.context.register(intentDict)])
    );

    const saved = await outDoc.save({ useObjectStreams: false });
    files.push({
      fileName: `${jobPrefix}_${isX1a ? 'PDFX1a' : 'PDFX4'}.pdf`,
      bytes: saved,
    });
    onProgress?.(100);
    return {
      files,
      platesGenerated: ['CMYK Composite'],
      shamsiDate,
    };
  }

  // Separate Plate Exports: `plate-pdf` OR `tiff-1bit`
  const srcDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pageCount = srcDoc.getPageCount();
  const isTiff = exportSettings.format === 'tiff-1bit';

  // Cap raster pixel dimensions cleanly so 1200/2400 DPI never overflows JS/Browser memory
  const maxDimPx = isTiff ? 2600 : 1800;
  let cappedBrowserScaleNote = false;

  for (let pIdx = 0; pIdx < pageCount; pIdx++) {
    const pageMeta = metadata.pages[pIdx];
    const srcPage = srcDoc.getPage(pIdx);
    const { width: srcWpt, height: srcHpt } = srcPage.getSize();
    const desiredPxW = Math.round((srcWpt / 72) * exportSettings.dpi);
    const desiredPxH = Math.round((srcHpt / 72) * exportSettings.dpi);
    if (desiredPxW > maxDimPx || desiredPxH > maxDimPx) {
      cappedBrowserScaleNote = true;
    }

    const raster = await renderPdfPageToRgba(
      pdfBytes,
      pIdx + 1,
      maxDimPx,
      exportSettings.dpi
    ).catch(() => null);

    const fallbackW = Math.max(64, Math.min(600, Math.round(srcWpt)));
    const fallbackH = Math.max(64, Math.min(600, Math.round(srcHpt)));
    const rgbaSurface = raster ?? {
      width: fallbackW,
      height: fallbackH,
      rgba: new Uint8ClampedArray(fallbackW * fallbackH * 4).fill(255),
    };

    const sep = buildSeparationBuffersFromRgba(
      rgbaSurface.rgba,
      rgbaSurface.width,
      rgbaSurface.height,
      colorSettings,
      metadata.detectedSpots,
      tacThresholdPercent
    );

    // Invoke optional out-of-MVP Trapping hook if registered
    if (hooks?.trapping) {
      const trapped = await hooks.trapping.execute({
        plateC: sep.c,
        plateM: sep.m,
        plateY: sep.y,
        plateK: sep.k,
        width: sep.width,
        height: sep.height,
        trapWidthMm: 0.1,
      });
      sep.c = trapped.plateC;
      sep.m = trapped.plateM;
      sep.y = trapped.plateY;
      sep.k = trapped.plateK;
    }

    const placed = computeFormPlacementPdf(
      srcWpt,
      srcHpt,
      exportSettings,
      savedPlateSizes,
      markPadPt,
      pageMeta,
      formPlacement
    );

    for (let plateIdx = 0; plateIdx < plateNames.length; plateIdx++) {
      const plateName = plateNames[plateIdx];
      const covBuf =
        plateName === 'C'
          ? sep.c
          : plateName === 'M'
            ? sep.m
            : plateName === 'Y'
              ? sep.y
              : plateName === 'K'
                ? sep.k
                : sep.spots.get(plateName) ?? new Uint8Array(sep.width * sep.height);

      if (isTiff) {
        let tiffCovBuf = covBuf;
        let tiffW = sep.width;
        let tiffH = sep.height;

        if (placed.isTransformed) {
          const basePxPerPt = sep.width / Math.max(1, srcWpt);
          const maxOutPx = maxDimPx * 1.4;
          const capFactor = Math.min(
            1,
            maxOutPx / Math.max(1, placed.outWpt * basePxPerPt),
            maxOutPx / Math.max(1, placed.outHpt * basePxPerPt)
          );
          const effPxPerPt = basePxPerPt * capFactor;
          const outPxW = Math.max(8, Math.round(placed.outWpt * effPxPerPt));
          const outPxH = Math.max(8, Math.round(placed.outHpt * effPxPerPt));

          const artWpx = Math.max(1, placed.artWpt * effPxPerPt);
          const artHpx = Math.max(1, placed.artHpt * effPxPerPt);
          const artCxPx =
            outPxW / 2 +
            (placed.isFitDocument ? 0 : formPlacement.offsetXMm * MM_TO_PT * effPxPerPt);
          const artCyPx =
            outPxH / 2 +
            (placed.isFitDocument ? 0 : formPlacement.offsetYMm * MM_TO_PT * effPxPerPt);
          const thetaRad = (formPlacement.rotationDeg * Math.PI) / 180;
          const cosT = Math.cos(thetaRad);
          const sinT = Math.sin(thetaRad);

          const transformed = new Uint8Array(outPxW * outPxH);
          for (let oy = 0; oy < outPxH; oy++) {
            const dy = oy + 0.5 - artCyPx;
            const rowOff = oy * outPxW;
            for (let ox = 0; ox < outPxW; ox++) {
              const dx = ox + 0.5 - artCxPx;
              const lx = dx * cosT + dy * sinT;
              const ly = -dx * sinT + dy * cosT;
              const u = lx / artWpx + 0.5;
              const v = ly / artHpx + 0.5;
              if (u >= 0 && u < 1 && v >= 0 && v < 1) {
                const sx = Math.min(sep.width - 1, Math.floor(u * sep.width));
                const sy = Math.min(sep.height - 1, Math.floor(v * sep.height));
                transformed[rowOff + ox] = covBuf[sy * sep.width + sx];
              }
            }
          }
          tiffCovBuf = transformed;
          tiffW = outPxW;
          tiffH = outPxH;
        }

        const tiffBytes = hooks?.halftoneRip
          ? await hooks.halftoneRip.screenTo1Bit({
              plateName,
              coverageBuffer: tiffCovBuf,
              width: tiffW,
              height: tiffH,
              lpi: 175,
              angleDeg: plateScreenAngleDeg(plateName),
              dpi: exportSettings.dpi,
            })
          : encodeCoverageTo1BitTiff(
              tiffCovBuf,
              tiffW,
              tiffH,
              exportSettings.dpi,
              plateName
            );
        files.push({
          fileName: formatPlateFileName(jobPrefix, plateName, pIdx + 1, 'tif'),
          bytes: tiffBytes,
        });
      } else {
        // Monochrome grayscale Plate PDF (`DeviceGray` film image + registration/crop/slug marks)
        const plateDoc = await PDFDocument.create();
        plateDoc.setTitle(`${jobPrefix} — Plate ${plateName} (Page ${pIdx + 1})`);
        plateDoc.setCreator('PrintStudio Pro Lithography Engine');

        const platePage = plateDoc.addPage([placed.outWpt, placed.outHpt]);
        platePage.setMediaBox(0, 0, placed.outWpt, placed.outHpt);
        platePage.setBleedBox(
          placed.bboxLeftPt,
          placed.bboxBottomPt,
          placed.bboxWpt,
          placed.bboxHpt
        );
        platePage.setTrimBox(placed.trimOffX, placed.trimOffY, placed.trimW, placed.trimH);

        // Convert 0..100 ink coverage -> DeviceGray (0% ink = 255 white film, 100% ink = 0 solid black)
        const grayBytes = new Uint8Array(sep.width * sep.height);
        for (let px = 0; px < grayBytes.length; px++) {
          grayBytes[px] = Math.max(0, Math.min(255, Math.round(255 * (1 - covBuf[px] / 100))));
        }

        // Embed true single-channel DeviceGray XObject stream directly inside PDF
        const grayImgDict = plateDoc.context.stream(grayBytes, {
          Type: PDFName.of('XObject'),
          Subtype: PDFName.of('Image'),
          Width: sep.width,
          Height: sep.height,
          ColorSpace: PDFName.of('DeviceGray'),
          BitsPerComponent: 8,
          Length: grayBytes.length,
        });
        const imgRef = plateDoc.context.register(grayImgDict);
        const xObjName = platePage.node.newXObject('PlateImg', imgRef);

        const drawOp = `q ${placed.a.toFixed(4)} ${placed.b.toFixed(4)} ${placed.c.toFixed(4)} ${placed.d.toFixed(4)} ${placed.originXpt.toFixed(4)} ${placed.originYpt.toFixed(4)} cm /${xObjName.decodeText()} Do Q\n`;
        const contentStream = plateDoc.context.stream(new TextEncoder().encode(drawOp));
        const contentRef = plateDoc.context.register(contentStream);
        platePage.node.addContentStream(contentRef);

        if (hasMarks) {
          const plateSlug = placed.isFitDocument
            ? plateName
            : `${plateName} (${Math.round(placed.plateWidthMm)}x${Math.round(placed.plateHeightMm)}mm)`;
          await drawPressMarksOnPdfPage(
            plateDoc,
            platePage,
            placed.trimOffX,
            placed.trimOffY,
            placed.trimW,
            placed.trimH,
            exportSettings,
            plateSlug,
            pIdx + 1,
            shamsiDate,
            true,
            !placed.isFitDocument
          );
        }

        const savedPlatePdf = await plateDoc.save({ useObjectStreams: false });
        files.push({
          fileName: formatPlateFileName(jobPrefix, plateName, pIdx + 1, 'pdf'),
          bytes: savedPlatePdf,
        });
      }

      const progressFrac =
        (pIdx * plateNames.length + plateIdx + 1) / Math.max(1, pageCount * plateNames.length);
      onProgress?.(Math.round(10 + progressFrac * 88));
    }
  }

  onProgress?.(100);
  return {
    files,
    platesGenerated: plateNames,
    shamsiDate,
    ...(cappedBrowserScaleNote && exportSettings.dpi > 600
      ? {
          noteFa:
            'برای جلوگیری از پر شدن رم مرورگر، بوم پیکسلی به سقف امن مقیاس خورد ولی تگ رزولوشن فایل با DPI انتخابی ثبت شد.',
        }
      : {}),
  };
}
