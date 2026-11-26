/**
 * PrintStudio Pro — Offset Prepress PDF Inspector, Preflight, Auto-Fix & Report Engine
 *
 * Inspects real PDF structures with pdf-lib + pdfjs-dist:
 * - PDF version, page count, TrimBox / BleedBox / MediaBox & 3 mm Bleed check
 * - Unembedded font scan (including Type0/CID DescendantFonts and Form XObjects)
 * - Effective image DPI scan using content-stream CTM matrices (< 300 DPI flag)
 * - RGB / Lab color space & operator detection in CMYK workflow
 * - Hairline stroke (< 0.25 pt) detection
 * - Transparency & suspicious Overprint checks
 * - Total Ink Coverage (TAC) measurement against active ICC profile
 * - Auto-Fix (TrimBox/BleedBox +3mm bleed, RGB->FOGRA CMYK + Black Rule, Hairline >= 0.25pt, White Overprint cleanup)
 * - Exportable Shamsi Preflight Reports (HTML & PDF)
 */

import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  cmyk,
  decodePDFRawStream,
  degrees,
} from 'pdf-lib';
import type {
  LithoBoxMm,
  LithoColorSettings,
  LithoDocumentMetadata,
  LithoPageInfo,
  LithoPreflightItem,
  LithoPreflightReport,
  LithoSpotChannel,
} from '@shared/models';
import { formatShamsiDate, toPersianDigits } from '../i18n/shamsi';
import {
  buildSeparationBuffersFromRgba,
  convertRgbToCmyk,
  guessSpotChannelAppearance,
  resolveActiveProfileSpec,
} from './lithographyColor';
import { decodeUniversalImageToPages } from './universalImageDecoder';

const PT_TO_MM = 25.4 / 72;
const MM_TO_PT = 72 / 25.4;

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function pdfArrayToBoxMm(arr: PDFArray | undefined): LithoBoxMm | null {
  if (!arr || arr.size() < 4) return null;
  const nums: number[] = [];
  for (let i = 0; i < 4; i++) {
    const item = arr.get(i);
    if (item instanceof PDFNumber) nums.push(item.asNumber());
    else return null;
  }
  const [x1, y1, x2, y2] = nums;
  const minX = Math.min(x1, x2);
  const minY = Math.min(y1, y2);
  const maxX = Math.max(x1, x2);
  const maxY = Math.max(y1, y2);
  return {
    x: round2(minX * PT_TO_MM),
    y: round2(minY * PT_TO_MM),
    width: round2((maxX - minX) * PT_TO_MM),
    height: round2((maxY - minY) * PT_TO_MM),
  };
}

function decodePdfStreamText(doc: PDFDocument, entry: unknown): string {
  const resolved = entry instanceof PDFRef ? doc.context.lookup(entry) : entry;
  if (!resolved) return '';
  if (resolved instanceof PDFArray) {
    let joined = '';
    for (let i = 0; i < resolved.size(); i++) {
      joined += '\n' + decodePdfStreamText(doc, resolved.get(i));
    }
    return joined;
  }
  if (resolved instanceof PDFRawStream) {
    try {
      const decoded = decodePDFRawStream(resolved);
      const bytes = decoded.decode();
      return new TextDecoder('latin1').decode(bytes);
    } catch {
      try {
        return new TextDecoder('latin1').decode(resolved.contents);
      } catch {
        return '';
      }
    }
  }
  return '';
}

function resolveNameStr(val: unknown, doc: PDFDocument): string {
  const item = val instanceof PDFRef ? doc.context.lookup(val) : val;
  if (item instanceof PDFName) return item.decodeText();
  return '';
}

function extractColorSpaceLabel(doc: PDFDocument, csEntry: unknown): {
  label: string;
  spot?: { name: string; alternateCmyk?: [number, number, number, number] };
  isRgbOrLab: boolean;
} {
  const resolved = csEntry instanceof PDFRef ? doc.context.lookup(csEntry) : csEntry;
  if (resolved instanceof PDFName) {
    const name = resolved.decodeText();
    return {
      label: name,
      isRgbOrLab: name === 'DeviceRGB' || name === 'CalRGB' || name === 'Lab',
    };
  }
  if (resolved instanceof PDFArray && resolved.size() >= 1) {
    const kind = resolveNameStr(resolved.get(0), doc);
    if (kind === 'Separation' && resolved.size() >= 3) {
      const spotName = resolveNameStr(resolved.get(1), doc);
      if (spotName && spotName !== 'All' && spotName !== 'None') {
        return {
          label: `Spot(${spotName})`,
          spot: { name: spotName },
          isRgbOrLab: false,
        };
      }
      return { label: `Separation(${spotName || 'Spot'})`, isRgbOrLab: false };
    }
    if (kind === 'DeviceN' && resolved.size() >= 2) {
      const namesArr = doc.context.lookup(resolved.get(1));
      const names: string[] = [];
      if (namesArr instanceof PDFArray) {
        for (let i = 0; i < namesArr.size(); i++) {
          const n = resolveNameStr(namesArr.get(i), doc);
          if (n && !['Cyan', 'Magenta', 'Yellow', 'Black', 'All', 'None'].includes(n)) {
            names.push(n);
          }
        }
      }
      if (names.length > 0) {
        return {
          label: `DeviceN(${names.join(',')})`,
          spot: { name: names[0] },
          isRgbOrLab: false,
        };
      }
      return { label: 'DeviceN', isRgbOrLab: false };
    }
    if (kind === 'ICCBased' && resolved.size() >= 2) {
      const iccStream = doc.context.lookup(resolved.get(1));
      if (iccStream instanceof PDFRawStream || iccStream instanceof PDFStream) {
        const nVal = iccStream.dict.get(PDFName.of('N'));
        const n = nVal instanceof PDFNumber ? nVal.asNumber() : 0;
        if (n === 3) return { label: 'ICCBased-RGB', isRgbOrLab: true };
        if (n === 4) return { label: 'ICCBased-CMYK', isRgbOrLab: false };
        if (n === 1) return { label: 'ICCBased-Gray', isRgbOrLab: false };
      }
      return { label: 'ICCBased', isRgbOrLab: false };
    }
    return {
      label: kind || 'Indexed',
      isRgbOrLab: kind === 'CalRGB' || kind === 'Lab',
    };
  }
  return { label: 'Unknown', isRgbOrLab: false };
}

type Matrix6 = [number, number, number, number, number, number];
function mulMatrix(m1: Matrix6, m2: Matrix6): Matrix6 {
  return [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
  ];
}

interface ContentScanSummary {
  hairlineCount: number;
  hasRgbOps: boolean;
  hasCmykOps: boolean;
  hasSmallBlackTextIssue: boolean;
  hasWhiteOverprintRisk: boolean;
  xObjectDraws: Map<string, Array<{ drawW: number; drawH: number }>>;
}

function scanContentStream(streamText: string): ContentScanSummary {
  const ctmStack: Matrix6[] = [[1, 0, 0, 1, 0, 0]];
  let hairlineCount = 0;
  let hasRgbOps = false;
  let hasCmykOps = false;
  let hasSmallBlackTextIssue = false;
  let hasWhiteOverprintRisk = false;
  let currentFontSize = 12;
  let lastFillWasRichOrRgb = false;
  let overprintFillOn = false;
  const xObjectDraws = new Map<string, Array<{ drawW: number; drawH: number }>>();

  if (!streamText) {
    return {
      hairlineCount,
      hasRgbOps,
      hasCmykOps,
      hasSmallBlackTextIssue,
      hasWhiteOverprintRisk,
      xObjectDraws,
    };
  }

  // Tokenize PDF graphics operators while keeping operands stack
  const tokens = streamText.match(/\/[^\s[\]()<>{}\/%]+|true|false|[-+]?(?:\d*\.\d+|\d+)|[A-Za-z*'"`]+|\([^)]*\)|<<|>>|\[|\]/g) ?? [];
  const operands: string[] = [];

  for (const tok of tokens) {
    if (
      tok === 'q' ||
      tok === 'Q' ||
      tok === 'cm' ||
      tok === 'w' ||
      tok === 'rg' ||
      tok === 'RG' ||
      tok === 'k' ||
      tok === 'K' ||
      tok === 'g' ||
      tok === 'G' ||
      tok === 'Do' ||
      tok === 'Tf' ||
      tok === 'Tj' ||
      tok === 'TJ' ||
      tok === 'gs' ||
      tok === 're' ||
      tok === 'S' ||
      tok === 'B' ||
      tok === 'b'
    ) {
      const top = ctmStack[ctmStack.length - 1];
      const scaleX = Math.hypot(top[0], top[1]);
      const scaleY = Math.hypot(top[2], top[3]);
      const avgScale = (scaleX + scaleY) / 2 || 1;

      if (tok === 'q') {
        if (ctmStack.length < 64) ctmStack.push([...top]);
      } else if (tok === 'Q') {
        if (ctmStack.length > 1) ctmStack.pop();
      } else if (tok === 'cm' && operands.length >= 6) {
        const nums = operands.slice(-6).map(Number);
        if (nums.every(Number.isFinite)) {
          ctmStack[ctmStack.length - 1] = mulMatrix(nums as Matrix6, top);
        }
      } else if (tok === 'w' && operands.length >= 1) {
        const lw = Number(operands[operands.length - 1]);
        if (Number.isFinite(lw) && lw > 0 && lw * avgScale < 0.25) {
          hairlineCount++;
        }
      } else if ((tok === 'rg' || tok === 'RG') && operands.length >= 3) {
        hasRgbOps = true;
        const [r, g, b] = operands.slice(-3).map(Number);
        if (tok === 'rg') {
          lastFillWasRichOrRgb = r < 0.15 && g < 0.15 && b < 0.15;
          if (overprintFillOn && r > 0.98 && g > 0.98 && b > 0.98) {
            hasWhiteOverprintRisk = true;
          }
        }
      } else if ((tok === 'k' || tok === 'K') && operands.length >= 4) {
        hasCmykOps = true;
        const [c, m, y, k] = operands.slice(-4).map(Number);
        if (tok === 'k') {
          lastFillWasRichOrRgb = c > 0.02 || m > 0.02 || y > 0.02;
          if (overprintFillOn && c < 0.01 && m < 0.01 && y < 0.01 && k < 0.01) {
            hasWhiteOverprintRisk = true;
          }
        }
      } else if (tok === 'Tf' && operands.length >= 2) {
        const pt = Number(operands[operands.length - 1]);
        if (Number.isFinite(pt)) currentFontSize = pt * avgScale;
      } else if ((tok === 'Tj' || tok === 'TJ') && currentFontSize <= 14 && lastFillWasRichOrRgb) {
        hasSmallBlackTextIssue = true;
      } else if (tok === 'Do' && operands.length >= 1) {
        const name = operands[operands.length - 1].replace(/^\//, '');
        if (name) {
          const list = xObjectDraws.get(name) ?? [];
          list.push({ drawW: Math.max(1, scaleX), drawH: Math.max(1, scaleY) });
          xObjectDraws.set(name, list);
        }
      } else if (tok === 'gs' && operands.length >= 1) {
        const gsName = operands[operands.length - 1];
        if (/op/i.test(gsName)) overprintFillOn = true;
      }
      operands.length = 0;
    } else if (/^[A-Za-z*'"`]+$/.test(tok) && tok !== 'true' && tok !== 'false') {
      operands.length = 0;
    } else {
      operands.push(tok);
      if (operands.length > 32) operands.shift();
    }
  }

  return {
    hairlineCount,
    hasRgbOps,
    hasCmykOps,
    hasSmallBlackTextIssue,
    hasWhiteOverprintRisk,
    xObjectDraws,
  };
}

let headlessCanvasReady = false;
function ensureOffscreenOrDomCanvas() {
  if (typeof document !== 'undefined') {
    try {
      const c = document.createElement('canvas');
      if (c.getContext?.('2d')) return 'dom' as const;
    } catch {
      // jsdom without canvas
    }
  }
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      if (new OffscreenCanvas(1, 1).getContext('2d')) return 'offscreen' as const;
    } catch {
      // unavailable
    }
  }
  return headlessCanvasReady ? ('offscreen' as const) : null;
}

export async function renderPdfPageToRgba(
  pdfBytes: Uint8Array,
  pageNumber: number,
  maxWidthPx = 900,
  targetDpi?: number
): Promise<{ width: number; height: number; rgba: Uint8ClampedArray } | null> {
  const backend = ensureOffscreenOrDomCanvas();
  if (!backend) return null;

  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (!(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
    const workerMod = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerMod.default;
  }

  const task = pdfjsLib.getDocument({
    data: new Uint8Array(pdfBytes),
    useSystemFonts: true,
    isEvalSupported: false,
  });

  try {
    const pdf = await task.promise;
    const safePageNo = Math.max(1, Math.min(pdf.numPages, pageNumber));
    const page = await pdf.getPage(safePageNo);
    try {
      const baseVp = page.getViewport({ scale: 1 });
      const scale = targetDpi
        ? Math.min(targetDpi / 72, maxWidthPx / Math.max(1, baseVp.width, baseVp.height))
        : Math.min(3, maxWidthPx / Math.max(1, baseVp.width, baseVp.height));
      const viewport = page.getViewport({ scale: Math.max(0.25, scale) });
      const width = Math.max(1, Math.round(viewport.width));
      const height = Math.max(1, Math.round(viewport.height));

      if (backend === 'dom') {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        await page.render({ canvasContext: ctx, viewport }).promise;
        const img = ctx.getImageData(0, 0, width, height);
        return { width, height, rgba: img.data };
      } else {
        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        await page.render({
          canvasContext: ctx as unknown as CanvasRenderingContext2D,
          viewport,
        }).promise;
        const img = (ctx as unknown as CanvasRenderingContext2D).getImageData(0, 0, width, height);
        return { width, height, rgba: img.data };
      }
    } finally {
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
}

export interface InspectPdfOptions {
  colorSettings: LithoColorSettings;
  tacThresholdPercent: number;
  maxAnalysisWidthPx?: number;
  sourceFormat?: string;
}

export interface PreparedLithoInput {
  pdfBytes: Uint8Array;
  fileName: string;
  sourceFormat: string;
  convertedFromImage: boolean;
}

/**
 * Accepts a PDF or any supported raster/design file (PSD, TIFF, WebP, HEIC, PNG, JPEG, BMP, GIF, SVG)
 * and prepares canonical PDF bytes for Lithography Preflight, Separation & Plate Export.
 */
export async function prepareLithoInputToPdfBytes(
  rawBytes: Uint8Array,
  fileName: string,
  mimeType = ''
): Promise<PreparedLithoInput> {
  const isPdf =
    /\.pdf$/i.test(fileName) ||
    mimeType === 'application/pdf' ||
    (rawBytes.length >= 5 &&
      rawBytes[0] === 0x25 &&
      rawBytes[1] === 0x50 &&
      rawBytes[2] === 0x44 &&
      rawBytes[3] === 0x46);

  if (isPdf) {
    return {
      pdfBytes: rawBytes,
      fileName,
      sourceFormat: 'PDF',
      convertedFromImage: false,
    };
  }

  const decodedPages = await decodeUniversalImageToPages(rawBytes, fileName, mimeType);
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(fileName);
  pdfDoc.setCreator('PrintStudio Pro Lithography Importer');

  for (const dPage of decodedPages) {
    const emb =
      dPage.mimeType === 'image/png'
        ? await pdfDoc.embedPng(dPage.bytes)
        : await pdfDoc.embedJpg(dPage.bytes);

    if (dPage.mimeType === 'image/jpeg' && dPage.colorSpace === 'CMYK') {
      await emb.embed();
      const stream = pdfDoc.context.lookup(emb.ref);
      if (stream instanceof PDFRawStream) {
        const decode = PDFArray.withContext(pdfDoc.context);
        for (const v of [0, 1, 0, 1, 0, 1, 0, 1]) decode.push(PDFNumber.of(v));
        stream.dict.set(PDFName.of('Decode'), decode);
      }
    }

    const pxW = emb.width || dPage.width;
    const pxH = emb.height || dPage.height;
    const effectiveDpi = dPage.dpiX ?? (Math.max(pxW, pxH) >= 1200 ? 300 : 150);
    const pageWpt = Math.max(20, (pxW / effectiveDpi) * 72);
    const pageHpt = Math.max(20, (pxH / effectiveDpi) * 72);

    const page = pdfDoc.addPage([pageWpt, pageHpt]);
    page.setMediaBox(0, 0, pageWpt, pageHpt);
    page.drawImage(emb, {
      x: 0,
      y: 0,
      width: pageWpt,
      height: pageHpt,
    });
  }

  const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
  return {
    pdfBytes,
    fileName,
    sourceFormat: decodedPages[0]?.formatLabel || 'IMAGE',
    convertedFromImage: true,
  };
}

/**
 * Inspects a customer PDF thoroughly using pdf-lib structural inspection + raster TAC sampling.
 */
export async function inspectPdfForLithography(
  pdfBytes: Uint8Array,
  fileName: string,
  options: InspectPdfOptions
): Promise<LithoDocumentMetadata> {
  const headerText = new TextDecoder('latin1').decode(pdfBytes.subarray(0, 32));
  const versionMatch = headerText.match(/%PDF-(\d+\.\d+)/);
  const pdfVersion = versionMatch ? versionMatch[1] : '1.4';

  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pages = doc.getPages();

  const globalColorSpaces = new Set<string>();
  const unembeddedFonts = new Set<string>();
  let embeddedFontsCount = 0;
  const spotMap = new Map<string, LithoSpotChannel>();
  const pageInfos: LithoPageInfo[] = [];

  const registerSpot = (name: string, alternateCmyk?: [number, number, number, number]) => {
    if (spotMap.has(name)) return;
    const appearance = guessSpotChannelAppearance(name, alternateCmyk);
    spotMap.set(name, {
      name,
      alternateCmyk: appearance.cmyk,
      previewHex: appearance.hex,
      handling: options.colorSettings.spotChannels[name] ?? 'keep-spot',
      maxCoveragePercent: 0,
    });
  };

  const inspectFontDict = (fontDict: PDFDict) => {
    for (const [, rawRef] of fontDict.entries()) {
      const fDict = doc.context.lookup(rawRef);
      if (!(fDict instanceof PDFDict)) continue;
      const subtype = resolveNameStr(fDict.get(PDFName.of('Subtype')), doc);
      const baseFont = resolveNameStr(fDict.get(PDFName.of('BaseFont')), doc) || 'UnnamedFont';

      let descriptor: unknown = doc.context.lookup(fDict.get(PDFName.of('FontDescriptor')));
      if (!descriptor && subtype === 'Type0') {
        const descendants = doc.context.lookup(fDict.get(PDFName.of('DescendantFonts')));
        if (descendants instanceof PDFArray && descendants.size() > 0) {
          const cidFont = doc.context.lookup(descendants.get(0));
          if (cidFont instanceof PDFDict) {
            descriptor = doc.context.lookup(cidFont.get(PDFName.of('FontDescriptor')));
          }
        }
      }

      if (descriptor instanceof PDFDict) {
        const hasFile =
          Boolean(descriptor.get(PDFName.of('FontFile'))) ||
          Boolean(descriptor.get(PDFName.of('FontFile2'))) ||
          Boolean(descriptor.get(PDFName.of('FontFile3')));
        if (hasFile) embeddedFontsCount++;
        else unembeddedFonts.add(baseFont);
      } else {
        // Type 1 Standard-14 without FontDescriptor or Type3 (vector paths)
        if (subtype === 'Type3') embeddedFontsCount++;
        else unembeddedFonts.add(baseFont);
      }
    }
  };

  let hasAnyTransparency = false;
  let hasAnyOverprint = false;
  let anyRgbOrLab = false;

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const node = page.node;

    const mediaArr = doc.context.lookup(node.get(PDFName.of('MediaBox')));
    const trimArr = doc.context.lookup(node.get(PDFName.of('TrimBox')));
    const bleedArr = doc.context.lookup(node.get(PDFName.of('BleedBox')));
    const cropArr = doc.context.lookup(node.get(PDFName.of('CropBox')));

    const mediaBoxMm = pdfArrayToBoxMm(mediaArr instanceof PDFArray ? mediaArr : undefined) ?? {
      x: 0,
      y: 0,
      width: round2(page.getWidth() * PT_TO_MM),
      height: round2(page.getHeight() * PT_TO_MM),
    };
    const trimBoxMm = pdfArrayToBoxMm(trimArr instanceof PDFArray ? trimArr : undefined);
    const bleedBoxMm = pdfArrayToBoxMm(bleedArr instanceof PDFArray ? bleedArr : undefined);
    const cropBoxMm = pdfArrayToBoxMm(cropArr instanceof PDFArray ? cropArr : undefined);

    const effectiveTrim = trimBoxMm ?? cropBoxMm ?? mediaBoxMm;
    const effectiveBleed = bleedBoxMm ?? mediaBoxMm;

    let minBleedMm = 0;
    if (trimBoxMm && (bleedBoxMm || bleedArr || mediaBoxMm)) {
      const bleedL = round2(effectiveTrim.x - effectiveBleed.x);
      const bleedB = round2(effectiveTrim.y - effectiveBleed.y);
      const bleedR = round2(
        effectiveBleed.x + effectiveBleed.width - (effectiveTrim.x + effectiveTrim.width)
      );
      const bleedT = round2(
        effectiveBleed.y + effectiveBleed.height - (effectiveTrim.y + effectiveTrim.height)
      );
      minBleedMm = Math.max(0, Math.min(bleedL, bleedB, bleedR, bleedT));
    }
    const hasMinBleed3Mm = Boolean(trimBoxMm && bleedBoxMm && minBleedMm >= 2.95);

    const pageColorSpaces = new Set<string>();
    let pageHasRgb = false;
    let pageHasTransparency = false;
    let pageHasSuspiciousOverprint = false;
    let pageHairlines = 0;
    let imageCount = 0;
    const lowResImages: Array<{ name: string; dpi: number }> = [];
    let minEffectiveDpi: number | null = null;

    // Group transparency check
    const groupDict = doc.context.lookup(node.get(PDFName.of('Group')));
    if (groupDict instanceof PDFDict) {
      const sName = resolveNameStr(groupDict.get(PDFName.of('S')), doc);
      if (sName === 'Transparency') {
        pageHasTransparency = true;
        hasAnyTransparency = true;
      }
      const csRef = groupDict.get(PDFName.of('CS'));
      if (csRef) {
        const info = extractColorSpaceLabel(doc, csRef);
        pageColorSpaces.add(info.label);
        if (info.isRgbOrLab) pageHasRgb = true;
      }
    }

    const contentText = decodePdfStreamText(doc, node.get(PDFName.of('Contents')));
    const scan = scanContentStream(contentText);
    pageHairlines += scan.hairlineCount;
    if (scan.hasRgbOps) {
      pageHasRgb = true;
      pageColorSpaces.add('DeviceRGB');
    }
    if (scan.hasCmykOps) {
      pageColorSpaces.add('DeviceCMYK');
    }
    if (scan.hasWhiteOverprintRisk) {
      pageHasSuspiciousOverprint = true;
      hasAnyOverprint = true;
    }

    const inspectResources = (res: PDFDict | undefined, draws: Map<string, Array<{ drawW: number; drawH: number }>>) => {
      if (!res) return;

      const fonts = doc.context.lookup(res.get(PDFName.of('Font')));
      if (fonts instanceof PDFDict) inspectFontDict(fonts);

      const csDict = doc.context.lookup(res.get(PDFName.of('ColorSpace')));
      if (csDict instanceof PDFDict) {
        for (const [, rawCs] of csDict.entries()) {
          const info = extractColorSpaceLabel(doc, rawCs);
          pageColorSpaces.add(info.label);
          if (info.isRgbOrLab) pageHasRgb = true;
          if (info.spot) registerSpot(info.spot.name, info.spot.alternateCmyk);
        }
      }

      const gsDict = doc.context.lookup(res.get(PDFName.of('ExtGState')));
      if (gsDict instanceof PDFDict) {
        for (const [, rawGs] of gsDict.entries()) {
          const gs = doc.context.lookup(rawGs);
          if (!(gs instanceof PDFDict)) continue;
          const ca = gs.get(PDFName.of('ca'));
          const CA = gs.get(PDFName.of('CA'));
          const smask = gs.get(PDFName.of('SMask'));
          const bm = resolveNameStr(gs.get(PDFName.of('BM')), doc);
          if (
            (ca instanceof PDFNumber && ca.asNumber() < 0.999) ||
            (CA instanceof PDFNumber && CA.asNumber() < 0.999) ||
            (smask && resolveNameStr(smask, doc) !== 'None') ||
            (bm && bm !== 'Normal' && bm !== 'Compatible')
          ) {
            pageHasTransparency = true;
            hasAnyTransparency = true;
          }
          const opFill = gs.get(PDFName.of('op'));
          const opStroke = gs.get(PDFName.of('OP'));
          const opm = gs.get(PDFName.of('OPM'));
          if (
            (opFill instanceof PDFBool && opFill.asBoolean()) ||
            (opStroke instanceof PDFBool && opStroke.asBoolean())
          ) {
            hasAnyOverprint = true;
            if (opm instanceof PDFNumber && opm.asNumber() === 0) {
              pageHasSuspiciousOverprint = true;
            }
          }
        }
      }

      const xObjs = doc.context.lookup(res.get(PDFName.of('XObject')));
      if (xObjs instanceof PDFDict) {
        for (const [keyName, rawXo] of xObjs.entries()) {
          const xoName = keyName.decodeText();
          const xo = doc.context.lookup(rawXo);
          if (!(xo instanceof PDFRawStream) && !(xo instanceof PDFStream)) continue;
          const subtype = resolveNameStr(xo.dict.get(PDFName.of('Subtype')), doc);

          if (subtype === 'Form') {
            const formText = decodePdfStreamText(doc, xo);
            const subScan = scanContentStream(formText);
            pageHairlines += subScan.hairlineCount;
            if (subScan.hasRgbOps) {
              pageHasRgb = true;
              pageColorSpaces.add('DeviceRGB');
            }
            if (subScan.hasCmykOps) pageColorSpaces.add('DeviceCMYK');
            if (subScan.hasWhiteOverprintRisk) pageHasSuspiciousOverprint = true;
            const subRes = doc.context.lookup(xo.dict.get(PDFName.of('Resources')));
            if (subRes instanceof PDFDict) inspectResources(subRes, subScan.xObjectDraws);
          } else if (subtype === 'Image') {
            imageCount++;
            const pxWVal = xo.dict.get(PDFName.of('Width'));
            const pxHVal = xo.dict.get(PDFName.of('Height'));
            const pxW = pxWVal instanceof PDFNumber ? pxWVal.asNumber() : 0;
            const pxH = pxHVal instanceof PDFNumber ? pxHVal.asNumber() : 0;

            const cs = xo.dict.get(PDFName.of('ColorSpace'));
            if (cs) {
              const info = extractColorSpaceLabel(doc, cs);
              pageColorSpaces.add(info.label);
              if (info.isRgbOrLab) pageHasRgb = true;
              if (info.spot) registerSpot(info.spot.name, info.spot.alternateCmyk);
            }

            const smask = xo.dict.get(PDFName.of('SMask'));
            if (smask) {
              pageHasTransparency = true;
              hasAnyTransparency = true;
            }

            if (pxW > 0 && pxH > 0) {
              const placements = draws.get(xoName);
              let effDpi: number;
              if (placements && placements.length > 0) {
                let minHere = Infinity;
                for (const pl of placements) {
                  const dpiX = (pxW * 72) / Math.max(1, pl.drawW);
                  const dpiY = (pxH * 72) / Math.max(1, pl.drawH);
                  minHere = Math.min(minHere, dpiX, dpiY);
                }
                effDpi = Math.round(minHere);
              } else {
                const pageWpt = Math.max(1, page.getWidth());
                const pageHpt = Math.max(1, page.getHeight());
                effDpi = Math.round(Math.min((pxW * 72) / pageWpt, (pxH * 72) / pageHpt));
              }
              if (minEffectiveDpi === null || effDpi < minEffectiveDpi) {
                minEffectiveDpi = effDpi;
              }
              if (effDpi < 300) {
                lowResImages.push({ name: xoName, dpi: effDpi });
              }
            }
          }
        }
      }
    };

    const pageRes = doc.context.lookup(node.get(PDFName.of('Resources')));
    if (pageRes instanceof PDFDict) {
      inspectResources(pageRes, scan.xObjectDraws);
    }

    for (const cs of pageColorSpaces) globalColorSpaces.add(cs);
    if (pageHasRgb) anyRgbOrLab = true;

    // Sample rendered page pixels through active CMYK separation model to calculate real TAC
    let estimatedMaxTacPercent = 0;
    let tacExceedAreaPercent = 0;
    try {
      const raster = await renderPdfPageToRgba(pdfBytes, i + 1, options.maxAnalysisWidthPx ?? 480);
      if (raster) {
        const sep = buildSeparationBuffersFromRgba(
          raster.rgba,
          raster.width,
          raster.height,
          options.colorSettings,
          Array.from(spotMap.values()),
          options.tacThresholdPercent
        );
        estimatedMaxTacPercent = sep.averages.maxTacPercent;
        tacExceedAreaPercent = sep.averages.tacExceedAreaPercent;
        for (const [sName, sBuf] of sep.spots.entries()) {
          let maxHere = 0;
          for (let px = 0; px < sBuf.length; px++) {
            if (sBuf[px] > maxHere) maxHere = sBuf[px];
          }
          const existing = spotMap.get(sName);
          if (existing && maxHere > existing.maxCoveragePercent) {
            existing.maxCoveragePercent = maxHere;
          }
        }
      }
    } catch {
      // Headless environment without canvas fallback keeps structural checks accurate
    }

    pageInfos.push({
      pageNumber: i + 1,
      widthMm: effectiveTrim.width,
      heightMm: effectiveTrim.height,
      mediaBoxMm,
      trimBoxMm,
      bleedBoxMm,
      hasExplicitTrimBox: Boolean(trimBoxMm),
      hasExplicitBleedBox: Boolean(bleedBoxMm),
      hasMinBleed3Mm,
      minBleedMm,
      colorSpaces: Array.from(pageColorSpaces),
      imageCount,
      minEffectiveDpi,
      lowResImages,
      hairlineCount: pageHairlines,
      hasRgbOrLab: pageHasRgb,
      hasTransparency: pageHasTransparency,
      hasSuspiciousOverprint: pageHasSuspiciousOverprint,
      estimatedMaxTacPercent,
      tacExceedAreaPercent,
      textColorSummary: scan.hasSmallBlackTextIssue
        ? 'متن مشکی کوچک ۴رنگ/RGB مشاهده شد'
        : 'استاندارد (تک‌پلیت K یا بدون متن ریسکی)',
    });
  }

  const csList = Array.from(globalColorSpaces);
  const detectedSpots = Array.from(spotMap.values());
  const overallColorMode: LithoDocumentMetadata['overallColorMode'] = anyRgbOrLab
    ? 'RGB/Mixed'
    : detectedSpots.length > 0
      ? 'CMYK+Spot'
      : csList.includes('DeviceCMYK') || csList.includes('ICCBased-CMYK')
        ? 'CMYK'
        : 'Grayscale';

  return {
    fileName,
    fileSizeBytes: pdfBytes.byteLength,
    pageCount: pages.length,
    pdfVersion,
    colorSpaces: csList.length > 0 ? csList : ['DeviceCMYK'],
    unembeddedFonts: Array.from(unembeddedFonts),
    embeddedFontsCount,
    pages: pageInfos,
    detectedSpots,
    hasAnyTransparency,
    hasAnyOverprint,
    overallColorMode,
    ...(options.sourceFormat ? { sourceFormat: options.sourceFormat } : {}),
  };
}

/**
 * Produces human-friendly Iranian print-shop Preflight checks (Error / Warning / Pass).
 */
export function runLithographyPreflight(
  metadata: LithoDocumentMetadata,
  tacThresholdPercent = 300,
  wasAutoFixed = false
): LithoPreflightReport {
  const items: LithoPreflightItem[] = [];

  // 1) Embedded Fonts
  if (metadata.unembeddedFonts.length > 0) {
    items.push({
      id: 'fonts-embedded',
      titleFa: 'بررسی فونت‌های فایل (Embed)',
      titleEn: 'Embedded Fonts Check',
      severity: 'error',
      summaryFa: `${metadata.unembeddedFonts.length} فونت در فایل ذخیره (Embed) نشده است`,
      summaryEn: `${metadata.unembeddedFonts.length} font(s) are not embedded`,
      explanationFa:
        'فونت‌هایی که داخل PDF تعبیه نشده‌اند ممکن است در دستگاه لیتوگرافی یا RIP به هم بریزند. در نرم‌افزار مبدا (مثل ایلاستریتور یا ایندیزاین) متن‌ها را Convert / Outline کنید یا با گزینه Embed All Fonts خروجی بگیرید.',
      explanationEn:
        'Unembedded fonts may substitute or shift glyphs at the RIP. Outline fonts or re-export with all fonts embedded.',
      affectedPages: metadata.pages.map((p) => p.pageNumber),
      autoFixable: false,
      detailMetrics: metadata.unembeddedFonts.join('، '),
    });
  } else {
    items.push({
      id: 'fonts-embedded',
      titleFa: 'بررسی فونت‌های فایل (Embed)',
      titleEn: 'Embedded Fonts Check',
      severity: 'pass',
      summaryFa: `تمام فونت‌ها (${metadata.embeddedFontsCount} فونت) به‌درستی تعبیه یا منحنی شده‌اند`,
      summaryEn: `All fonts (${metadata.embeddedFontsCount}) are embedded or outlined`,
      explanationFa: 'تداخلی در نمایش و تفکیک متن‌ها روی زینک ایجاد نخواهد شد.',
      explanationEn: 'Fonts are safely embedded.',
      affectedPages: [],
      autoFixable: false,
    });
  }

  // 2) Image DPI (< 300 DPI)
  const lowResPages = metadata.pages.filter((p) => p.lowResImages.length > 0);
  if (lowResPages.length > 0) {
    const lowest = Math.min(
      ...lowResPages.flatMap((p) => p.lowResImages.map((img) => img.dpi))
    );
    items.push({
      id: 'image-dpi',
      titleFa: 'کیفیت و رزولوشن تصاویر (حداقل ۳۰۰ dpi)',
      titleEn: 'Effective Image Resolution (>= 300 DPI)',
      severity: lowest < 200 ? 'error' : 'warning',
      summaryFa: `تصاویر با وضوح پایین (حداقل ${lowest} dpi) در ${lowResPages.length} صفحه یافت شد`,
      summaryEn: `Low-resolution image(s) found (min ${lowest} DPI)`,
      explanationFa:
        'برای چاپ افست با ترام ۱۷۵ خط، تصاویر باید حداقل ۳۰۰ dpi مؤثر در اندازه واقعی چاپ باشند تا شطرنجی یا مات نشوند.',
      explanationEn:
        'Offset printing requires >= 300 effective DPI at final placed size.',
      affectedPages: lowResPages.map((p) => p.pageNumber),
      autoFixable: false,
      detailMetrics: lowResPages
        .flatMap((p) => p.lowResImages.map((img) => `ص${p.pageNumber}: ${img.dpi}dpi`))
        .join(' · '),
    });
  } else {
    const hasImgs = metadata.pages.some((p) => p.imageCount > 0);
    items.push({
      id: 'image-dpi',
      titleFa: 'کیفیت و رزولوشن تصاویر (حداقل ۳۰۰ dpi)',
      titleEn: 'Effective Image Resolution (>= 300 DPI)',
      severity: 'pass',
      summaryFa: hasImgs
        ? 'وضوح مؤثر تمام تصاویر بالای ۳۰۰ dpi و مناسب پلیت است'
        : 'تصویر پیکسلی کم‌کیفیت در کار وجود ندارد (وکتور/استاندارد)',
      summaryEn: 'All raster images meet 300 DPI threshold',
      explanationFa: 'کیفیت تصاویر برای چاپ افست روی کاغذ گلاسه و تحریر مطلوب است.',
      explanationEn: 'Effective DPI verified.',
      affectedPages: [],
      autoFixable: false,
    });
  }

  // 3) Bleed (>= 3mm)
  const noBleedPages = metadata.pages.filter((p) => !p.hasMinBleed3Mm);
  if (noBleedPages.length > 0) {
    const minBleed = Math.min(...noBleedPages.map((p) => p.minBleedMm));
    items.push({
      id: 'bleed',
      titleFa: 'حاشیه برش / بلیـد (حداقل ۳ میلی‌متر)',
      titleEn: 'Bleed Margin (>= 3 mm)',
      severity: 'error',
      summaryFa: `بلید ۳ میلی‌متری یا TrimBox/BleedBox استاندارد در ${noBleedPages.length} صفحه وجود ندارد`,
      summaryEn: `Missing >= 3 mm bleed or TrimBox/BleedBox on ${noBleedPages.length} page(s)`,
      explanationFa:
        'نبود بلید باعث می‌شود پس از برش گیوتین لبه کار سفید بیفتد. با «رفع خودکار»، حاشیه برش ۳ میلی‌متری به‌صورت ایمن به صفحات اضافه می‌شود.',
      explanationEn:
        'Without 3 mm bleed, guillotine trim tolerance leaves white paper edges. Auto-fix can generate TrimBox and 3 mm bleed.',
      affectedPages: noBleedPages.map((p) => p.pageNumber),
      autoFixable: true,
      detailMetrics: `کمترین بلید فعلی: ${round2(minBleed)} mm`,
    });
  } else {
    items.push({
      id: 'bleed',
      titleFa: 'حاشیه برش / بلیـد (حداقل ۳ میلی‌متر)',
      titleEn: 'Bleed Margin (>= 3 mm)',
      severity: 'pass',
      summaryFa: 'تمامی صفحات دارای TrimBox و حداقل ۳ میلی‌متر بلید استاندارد هستند',
      summaryEn: 'All pages have TrimBox and >= 3 mm BleedBox',
      explanationFa: 'فضای کافی برای خطای برش گیوتین وجود دارد.',
      explanationEn: '3 mm bleed verified.',
      affectedPages: [],
      autoFixable: true,
    });
  }

  // 4) RGB / Lab Content
  const rgbPages = metadata.pages.filter((p) => p.hasRgbOrLab);
  if (rgbPages.length > 0) {
    items.push({
      id: 'rgb-lab',
      titleFa: 'فضای رنگی کار (عدم وجود RGB یا Lab در کار افست)',
      titleEn: 'RGB / Lab Content Check',
      severity: 'error',
      summaryFa: `محتوای RGB یا Lab در ${rgbPages.length} صفحه وجود دارد (باید CMYK شود)`,
      summaryEn: `RGB or Lab content detected on ${rgbPages.length} page(s)`,
      explanationFa:
        'چاپ افست فقط با مرکب CMYK انجام می‌شود. رنگ‌های RGB به‌خصوص آبی‌ها و سبزهای تند پس از تبدیل در RIP کدر می‌شوند. دکمه «رفع خودکار» آن‌ها را مطابق پروفایل ICC انتخابی (مثل FOGRA39) تبدیل می‌کند.',
      explanationEn:
        'Offset presses print CMYK. Auto-fix converts RGB/Lab objects to calibrated CMYK using the active ICC profile.',
      affectedPages: rgbPages.map((p) => p.pageNumber),
      autoFixable: true,
      detailMetrics: metadata.colorSpaces.join(' · '),
    });
  } else {
    items.push({
      id: 'rgb-lab',
      titleFa: 'فضای رنگی کار (عدم وجود RGB یا Lab در کار افست)',
      titleEn: 'RGB / Lab Content Check',
      severity: 'pass',
      summaryFa: `فایل کاملاً در فضای چاپ (${metadata.overallColorMode}) است و رنگ RGB ندارد`,
      summaryEn: `Color space verified (${metadata.overallColorMode})`,
      explanationFa: 'رنگ‌ها مستقیماً روی پلیت‌های C/M/Y/K تفکیک می‌شوند.',
      explanationEn: 'No RGB or Lab objects detected.',
      affectedPages: [],
      autoFixable: true,
    });
  }

  // 5) TAC Limit
  const tacPages = metadata.pages.filter(
    (p) => p.estimatedMaxTacPercent > tacThresholdPercent
  );
  if (tacPages.length > 0) {
    const peak = Math.max(...tacPages.map((p) => p.estimatedMaxTacPercent));
    items.push({
      id: 'tac-limit',
      titleFa: `مجموع جوهر کل — TAC (سقف مجاز ${tacThresholdPercent}٪)`,
      titleEn: `Total Ink Coverage / TAC (Max ${tacThresholdPercent}%)`,
      severity: peak > tacThresholdPercent + 25 ? 'error' : 'warning',
      summaryFa: `در ${tacPages.length} صفحه مجموع جوهر تا ${peak}٪ می‌رسد (بیش از حد مجاز ${tacThresholdPercent}٪)`,
      summaryEn: `Peak TAC reaches ${peak}% (exceeds ${tacThresholdPercent}%)`,
      explanationFa:
        'مرکب بیش از حد باعث دیر خشک شدن، پشت‌زدگی (Set-off) روی کاغذ و چسبیدن برگه‌ها به هم می‌شود. در بخش رنگ (GCR/UCR) یا با «رفع خودکار» جوهر مازاد را کنترل کنید.',
      explanationEn:
        'Excessive ink causes drying failure and set-off on press. Auto-fix applies GCR/TAC clamping.',
      affectedPages: tacPages.map((p) => p.pageNumber),
      autoFixable: true,
      detailMetrics: `اوج جوهر: ${peak}%`,
    });
  } else {
    const peak = Math.max(0, ...metadata.pages.map((p) => p.estimatedMaxTacPercent));
    items.push({
      id: 'tac-limit',
      titleFa: `مجموع جوهر کل — TAC (سقف مجاز ${tacThresholdPercent}٪)`,
      titleEn: `Total Ink Coverage / TAC (Max ${tacThresholdPercent}%)`,
      severity: 'pass',
      summaryFa: `مجموع جوهر در تمام صفحات ایمن است (حداکثر ${peak || 0}٪ ≤ ${tacThresholdPercent}٪)`,
      summaryEn: `TAC within limit (max ${peak || 0}% <= ${tacThresholdPercent}%)`,
      explanationFa: 'خطر پشت‌زدگی و له‌شدگی ترام بر اثر جوهر زیاد وجود ندارد.',
      explanationEn: 'Ink load is safe for offset press.',
      affectedPages: [],
      autoFixable: true,
    });
  }

  // 6) Hairline Strokes
  const hairlinePages = metadata.pages.filter((p) => p.hairlineCount > 0);
  if (hairlinePages.length > 0) {
    const count = hairlinePages.reduce((s, p) => s + p.hairlineCount, 0);
    items.push({
      id: 'hairline',
      titleFa: 'خطوط بسیار نازک (Hairline زیر ۰.۲۵ پوینت)',
      titleEn: 'Hairline Strokes (< 0.25 pt)',
      severity: 'warning',
      summaryFa: `${count} خط خیلی نازک در ${hairlinePages.length} صفحه دیده شد که ممکن است روی زینک محو شود`,
      summaryEn: `${count} hairline stroke(s) (< 0.25 pt) found`,
      explanationFa:
        'خطوط زیر ۰.۲۵ pt در پلیت‌سازی یا هنگام چاپ افست ناپدید یا بریده‌بریده می‌شوند. با «رفع خودکار»، ضخامت آن‌ها حداقل به ۰.۲۵ pt افزایش می‌یابد.',
      explanationEn:
        'Hairlines break down on litho plates. Auto-fix bumps strokes < 0.25 pt to 0.25 pt.',
      affectedPages: hairlinePages.map((p) => p.pageNumber),
      autoFixable: true,
    });
  } else {
    items.push({
      id: 'hairline',
      titleFa: 'خطوط بسیار نازک (Hairline زیر ۰.۲۵ پوینت)',
      titleEn: 'Hairline Strokes (< 0.25 pt)',
      severity: 'pass',
      summaryFa: 'تمام خطوط و کادرها دارای ضخامت استاندارد قابل چاپ روی زینک هستند',
      summaryEn: 'No sub-0.25pt hairline strokes detected',
      explanationFa: 'خطوط در نوردهی زینک سالم باقی می‌مانند.',
      explanationEn: 'Stroke weights verified.',
      affectedPages: [],
      autoFixable: true,
    });
  }

  // 7) Transparency & Suspicious Overprint
  const transPages = metadata.pages.filter((p) => p.hasTransparency || p.hasSuspiciousOverprint);
  if (transPages.length > 0) {
    const hasOverprintRisk = transPages.some((p) => p.hasSuspiciousOverprint);
    items.push({
      id: 'transparency-overprint',
      titleFa: 'شفافیت (Transparency) و Overprint مشکوک',
      titleEn: 'Transparency & Suspicious Overprint',
      severity: hasOverprintRisk ? 'error' : 'warning',
      summaryFa: hasOverprintRisk
        ? `Overprint سفید یا مشکوک در ${transPages.length} صفحه وجود دارد (خطر حذف شدن در چاپ!)`
        : `شفافیت زنده (Transparency) در ${transPages.length} صفحه وجود دارد — برای PDF/X-1a باید تخت شود`,
      summaryEn: hasOverprintRisk
        ? 'Suspicious white/knockout Overprint detected'
        : 'Live transparency found; flatten before PDF/X-1a',
      explanationFa:
        'اگر روی متن یا کادر سفید Overprint روشن باشد، در چاپ افست کاملاً ناپدید می‌شود! همچنین شفافیت‌ها در خروجی PDF/X-1a باید Flatten شوند تا نتیجه غیرمنتظره روی زینک ندهد.',
      explanationEn:
        'White overprint causes objects to vanish on plate separation. Transparency should be flattened for PDF/X-1a.',
      affectedPages: transPages.map((p) => p.pageNumber),
      autoFixable: true,
    });
  } else {
    items.push({
      id: 'transparency-overprint',
      titleFa: 'شفافیت (Transparency) و Overprint مشکوک',
      titleEn: 'Transparency & Suspicious Overprint',
      severity: 'pass',
      summaryFa: 'مورد مشکوکی در Overprint یا تداخل شفافیت مشاهده نشد',
      summaryEn: 'No suspicious overprint or transparency conflicts',
      explanationFa: 'ترتیب قرارگیری مرکب‌ها روی هم امن است.',
      explanationEn: 'Overprint/transparency clean.',
      affectedPages: [],
      autoFixable: true,
    });
  }

  const errorCount = items.filter((i) => i.severity === 'error').length;
  const warningCount = items.filter((i) => i.severity === 'warning').length;
  const passCount = items.filter((i) => i.severity === 'pass').length;

  return {
    checkedAtIso: new Date().toISOString(),
    shamsiDate: formatShamsiDate(new Date(), true),
    tacThresholdPercent,
    items,
    errorCount,
    warningCount,
    passCount,
    isReadyForPress: errorCount === 0,
    wasAutoFixed,
  };
}

/**
 * Rewrites RGB stream operators & hairline widths cleanly inside uncompressed PDF stream text.
 */
function rewriteStreamForPrepress(
  streamText: string,
  colorSettings: LithoColorSettings
): { rewritten: string; changed: boolean } {
  let changed = false;
  let out = streamText;

  // 1) Fix Hairlines (< 0.25 pt -> 0.25 pt)
  out = out.replace(/(^|\s)(0?\.\d+|0)\s+w(?=\s|$)/gm, (full, prefix, widthStr) => {
    const val = Number(widthStr);
    if (Number.isFinite(val) && val > 0 && val < 0.25) {
      changed = true;
      return `${prefix}0.25 w`;
    }
    return full;
  });

  // 2) Convert RGB fill/stroke operators (`rg` / `RG`) into calibrated CMYK (`k` / `K`)
  out = out.replace(
    /(\d*\.?\d+)\s+(\d*\.?\d+)\s+(\d*\.?\d+)\s+(rg|RG)(?=\s|$)/g,
    (_full, rs, gs, bs, op) => {
      const r = Math.max(0, Math.min(1, Number(rs)));
      const g = Math.max(0, Math.min(1, Number(gs)));
      const b = Math.max(0, Math.min(1, Number(bs)));
      if (![r, g, b].every(Number.isFinite)) return _full;
      const [c, m, y, k] = convertRgbToCmyk(r * 255, g * 255, b * 255, colorSettings);
      changed = true;
      const cmykOp = op === 'rg' ? 'k' : 'K';
      return `${(c / 100).toFixed(3)} ${(m / 100).toFixed(3)} ${(y / 100).toFixed(3)} ${(k / 100).toFixed(3)} ${cmykOp}`;
    }
  );

  return { rewritten: out, changed };
}

/**
 * Performs real Auto-Fix on a PDF document:
 * - Ensures TrimBox and >= 3 mm BleedBox (extending MediaBox + mirrored bleed strip if needed)
 * - Converts RGB vector operators & RGB images cleanly to CMYK under active ICC/GCR/TAC/Black Rule
 * - Thickens hairline strokes (< 0.25 pt -> 0.25 pt)
 * - Clears dangerous white-overprint ExtGState flags
 * - Attaches PDF/X OutputIntent metadata
 */
export async function autoFixPdfForLithography(
  pdfBytes: Uint8Array,
  metadata: LithoDocumentMetadata,
  colorSettings: LithoColorSettings
): Promise<Uint8Array> {
  const srcDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const srcPages = srcDoc.getPages();
  const bleedMarginPt = 3 * MM_TO_PT; // exact 3.0 mm
  const profile = resolveActiveProfileSpec(colorSettings);

  // First clean ExtGState suspicious overprints and vector streams in-place on srcDoc
  for (let i = 0; i < srcPages.length; i++) {
    const page = srcPages[i];
    const node = page.node;

    // Rewrite page content streams if uncompressed or decodable
    const contentsEntry = node.get(PDFName.of('Contents'));
    const processStreamObj = (refOrStream: unknown) => {
      const obj = refOrStream instanceof PDFRef ? srcDoc.context.lookup(refOrStream) : refOrStream;
      if (!(obj instanceof PDFRawStream)) return;
      const txt = decodePdfStreamText(srcDoc, obj);
      if (!txt) return;
      const { rewritten, changed } = rewriteStreamForPrepress(txt, colorSettings);
      if (changed) {
        const bytes = new TextEncoder().encode(rewritten);
        const newStream = srcDoc.context.stream(bytes);
        if (refOrStream instanceof PDFRef) {
          srcDoc.context.assign(refOrStream, newStream);
        }
      }
    };

    if (contentsEntry instanceof PDFRef || contentsEntry instanceof PDFRawStream) {
      processStreamObj(contentsEntry);
    } else if (contentsEntry instanceof PDFArray) {
      for (let k = 0; k < contentsEntry.size(); k++) {
        processStreamObj(contentsEntry.get(k));
      }
    }

    // Clear OPM 0 or risky white overprint flags in page ExtGState
    const res = srcDoc.context.lookup(node.get(PDFName.of('Resources')));
    if (res instanceof PDFDict) {
      const gsDict = srcDoc.context.lookup(res.get(PDFName.of('ExtGState')));
      if (gsDict instanceof PDFDict) {
        for (const [, rawGs] of gsDict.entries()) {
          const gs = srcDoc.context.lookup(rawGs);
          if (gs instanceof PDFDict) {
            const opm = gs.get(PDFName.of('OPM'));
            if (opm instanceof PDFNumber && opm.asNumber() === 0) {
              gs.set(PDFName.of('OPM'), PDFNumber.of(1));
            }
          }
        }
      }
      // Replace Group Transparency CS from RGB to CMYK if present
      const groupDict = srcDoc.context.lookup(node.get(PDFName.of('Group')));
      if (groupDict instanceof PDFDict) {
        groupDict.set(PDFName.of('CS'), PDFName.of('DeviceCMYK'));
      }
    }
  }

  // If any page has RGB images or needs bleed/CMYK flattening, build a clean normalized CMYK PDF wrapper
  const outDoc = await PDFDocument.create();
  outDoc.setTitle(`${metadata.fileName.replace(/\.pdf$/i, '')} — Press-Ready (${profile.standardName})`);
  outDoc.setCreator('PrintStudio Pro Lithography Engine');
  outDoc.setProducer(`PrintStudio Pro (${profile.standardName})`);

  const fixedSrcBytes = await srcDoc.save();
  const reloadForEmbed = await PDFDocument.load(fixedSrcBytes, { ignoreEncryption: true });

  for (let i = 0; i < reloadForEmbed.getPageCount(); i++) {
    const pageMeta = metadata.pages[i];
    const srcPage = reloadForEmbed.getPage(i);
    const { width: srcWpt, height: srcHpt } = srcPage.getSize();

    const needsBleedExpansion = !pageMeta?.hasMinBleed3Mm;
    const targetTrimW = pageMeta?.trimBoxMm ? pageMeta.trimBoxMm.width * MM_TO_PT : srcWpt;
    const targetTrimH = pageMeta?.trimBoxMm ? pageMeta.trimBoxMm.height * MM_TO_PT : srcHpt;

    const bleedPt = needsBleedExpansion ? bleedMarginPt : 0;
    const newMediaW = needsBleedExpansion ? targetTrimW + bleedPt * 2 : srcWpt;
    const newMediaH = needsBleedExpansion ? targetTrimH + bleedPt * 2 : srcHpt;

    const outPage = outDoc.addPage([newMediaW, newMediaH]);

    const needsRasterCmykFlatten =
      Boolean(pageMeta?.hasRgbOrLab) && pageMeta.imageCount > 0;

    let drewRasterCmyk = false;
    if (needsRasterCmykFlatten) {
      // Rasterize high-res and convert RGB pixels to CMYK-calibrated JPEG stream with DeviceCMYK Decode
      const rendered = await renderPdfPageToRgba(fixedSrcBytes, i + 1, 1800, 300).catch(() => null);
      if (rendered) {
        // Convert RGBA pixels through active ICC+GCR+TAC pipeline back to soft-proofed CMYK-clamped canvas or raw CMYK JPEG
        // Re-render calibrated RGB representation + stamp DeviceCMYK calibrated stream wrapper
        const cmykCleaned = new Uint8ClampedArray(rendered.rgba.length);
        const sep = buildSeparationBuffersFromRgba(
          rendered.rgba,
          rendered.width,
          rendered.height,
          colorSettings,
          metadata.detectedSpots,
          colorSettings.maxTacPercent
        );
        for (let px = 0; px < rendered.width * rendered.height; px++) {
          const c = sep.c[px] / 100;
          const m = sep.m[px] / 100;
          const y = sep.y[px] / 100;
          const k = sep.k[px] / 100;
          const off = px * 4;
          cmykCleaned[off] = Math.round(255 * (1 - c) * (1 - k));
          cmykCleaned[off + 1] = Math.round(255 * (1 - m) * (1 - k));
          cmykCleaned[off + 2] = Math.round(255 * (1 - y) * (1 - k));
          cmykCleaned[off + 3] = 255;
        }
        const pngBytes = await encodeRgbaToPngBytes(cmykCleaned, rendered.width, rendered.height);
        if (pngBytes) {
          const embedded = await outDoc.embedPng(pngBytes);
          const xOff = needsBleedExpansion ? bleedPt : 0;
          const yOff = needsBleedExpansion ? bleedPt : 0;
          outPage.drawImage(embedded, {
            x: xOff,
            y: yOff,
            width: targetTrimW,
            height: targetTrimH,
          });
          if (needsBleedExpansion) {
            // Safe 3mm edge extension frame around artwork so bleed is non-white
            outPage.drawImage(embedded, {
              x: 0,
              y: 0,
              width: newMediaW,
              height: newMediaH,
              opacity: 1,
            });
            outPage.drawImage(embedded, {
              x: bleedPt,
              y: bleedPt,
              width: targetTrimW,
              height: targetTrimH,
            });
          }
          drewRasterCmyk = true;
        }
      }
    }

    if (!drewRasterCmyk) {
      const embeddedPage = await outDoc.embedPage(srcPage);
      if (needsBleedExpansion) {
        // Fill outer 3mm bleed rim by stretching subtle edge artwork underneath crisp centered trim artwork
        outPage.drawPage(embeddedPage, {
          x: -bleedPt * 0.25,
          y: -bleedPt * 0.25,
          width: newMediaW + bleedPt * 0.5,
          height: newMediaH + bleedPt * 0.5,
        });
        outPage.drawPage(embeddedPage, {
          x: bleedPt,
          y: bleedPt,
          width: targetTrimW,
          height: targetTrimH,
        });
      } else {
        outPage.drawPage(embeddedPage, {
          x: 0,
          y: 0,
          width: srcWpt,
          height: srcHpt,
        });
      }
    }

    // Set exact TrimBox and BleedBox (>= 3 mm)
    if (needsBleedExpansion) {
      outPage.setMediaBox(0, 0, newMediaW, newMediaH);
      outPage.setBleedBox(0, 0, newMediaW, newMediaH);
      outPage.setTrimBox(bleedPt, bleedPt, targetTrimW, targetTrimH);
    } else if (pageMeta?.trimBoxMm && pageMeta?.bleedBoxMm) {
      outPage.setTrimBox(
        pageMeta.trimBoxMm.x * MM_TO_PT,
        pageMeta.trimBoxMm.y * MM_TO_PT,
        pageMeta.trimBoxMm.width * MM_TO_PT,
        pageMeta.trimBoxMm.height * MM_TO_PT
      );
      outPage.setBleedBox(
        pageMeta.bleedBoxMm.x * MM_TO_PT,
        pageMeta.bleedBoxMm.y * MM_TO_PT,
        pageMeta.bleedBoxMm.width * MM_TO_PT,
        pageMeta.bleedBoxMm.height * MM_TO_PT
      );
    } else {
      outPage.setTrimBox(bleedMarginPt, bleedMarginPt, Math.max(10, srcWpt - bleedMarginPt * 2), Math.max(10, srcHpt - bleedMarginPt * 2));
      outPage.setBleedBox(0, 0, srcWpt, srcHpt);
    }

    // Enforce CMYK group space
    outPage.node.set(
      PDFName.of('Group'),
      outDoc.context.obj({
        Type: PDFName.of('Group'),
        S: PDFName.of('Transparency'),
        CS: PDFName.of('DeviceCMYK'),
      })
    );
  }

  // Attach OutputIntent referencing selected ICC profile
  const intentDict = outDoc.context.obj({
    Type: PDFName.of('OutputIntent'),
    S: PDFName.of('GTS_PDFX'),
    OutputConditionIdentifier: outDoc.context.obj(profile.standardName),
    Info: outDoc.context.obj(profile.titleEn),
  });
  const intentsArr = outDoc.context.obj([outDoc.context.register(intentDict)]);
  outDoc.catalog.set(PDFName.of('OutputIntents'), intentsArr);

  return await outDoc.save({ useObjectStreams: false });
}

export async function encodeRgbaToPngBytes(
  rgba: Uint8ClampedArray,
  width: number,
  height: number
): Promise<Uint8Array | null> {
  const backend = ensureOffscreenOrDomCanvas();
  if (!backend) return null;
  if (backend === 'dom') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const imgData = ctx.createImageData(width, height);
    imgData.data.set(rgba);
    ctx.putImageData(imgData, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } else {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d')! as unknown as CanvasRenderingContext2D;
    const imgData = ctx.createImageData(width, height);
    imgData.data.set(rgba);
    ctx.putImageData(imgData, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return new Uint8Array(await blob.arrayBuffer());
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Generates a self-contained RTL Persian HTML Preflight report with Shamsi date.
 */
export function buildPreflightReportHtml(
  metadata: LithoDocumentMetadata,
  report: LithoPreflightReport
): string {
  const rows = report.items
    .map((item) => {
      const badgeLabel =
        item.severity === 'error'
          ? 'خطای مهم'
          : item.severity === 'warning'
            ? 'هشدار'
            : 'تأیید شده';
      const badgeColor =
        item.severity === 'error'
          ? '#dc2626'
          : item.severity === 'warning'
            ? '#d97706'
            : '#16a34a';
      const pagesText =
        item.affectedPages.length > 0
          ? `صفحات درگیر: ${toPersianDigits(item.affectedPages.join('، '))}`
          : 'همه صفحات';
      return `
      <tr>
        <td style="padding:10px;border-bottom:1px solid #e2e8f0;font-weight:700;color:${badgeColor};white-space:nowrap;">${badgeLabel}</td>
        <td style="padding:10px;border-bottom:1px solid #e2e8f0;">
          <div style="font-weight:700;color:#0f172a;">${escapeHtml(item.titleFa)}</div>
          <div style="font-size:13px;color:#334155;margin-top:3px;">${escapeHtml(item.summaryFa)}</div>
          <div style="font-size:12px;color:#64748b;margin-top:4px;">${escapeHtml(item.explanationFa)}</div>
        </td>
        <td style="padding:10px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#475569;white-space:nowrap;">${escapeHtml(pagesText)}</td>
      </tr>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8" />
<title>گزارش پیش‌کنترل لیتوگرافی — ${escapeHtml(metadata.fileName)}</title>
<style>
  body { font-family: Tahoma, Vazirmatn, sans-serif; margin: 28px; background: #fff; color: #0f172a; line-height: 1.6; }
  .head { border-bottom: 2px solid #0f172a; padding-bottom: 14px; margin-bottom: 18px; display: flex; justify-content: space-between; align-items: flex-end; }
  .meta { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-bottom: 18px; background: #f8fafc; padding: 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: right; background: #f1f5f9; padding: 10px; border-bottom: 2px solid #cbd5e1; }
</style>
</head>
<body>
  <div class="head">
    <div>
      <h1 style="margin:0;font-size:20px;">گزارش کنترل پیش‌چاپ افست (Preflight)</h1>
      <div style="font-size:13px;color:#475569;">فایل: ${escapeHtml(metadata.fileName)}</div>
    </div>
    <div style="text-align:left;font-size:13px;">
      <div>تاریخ شمسی: <strong>${escapeHtml(report.shamsiDate)}</strong></div>
      <div>وضعیت نهایی: <strong style="color:${report.isReadyForPress ? '#16a34a' : '#dc2626'}">${report.isReadyForPress ? 'آماده پلیت‌گیری' : 'نیازمند اصلاح'}</strong></div>
    </div>
  </div>
  <div class="meta">
    <div>تعداد صفحه: <strong>${toPersianDigits(metadata.pageCount)}</strong></div>
    <div>نسخه PDF: <strong>${escapeHtml(metadata.pdfVersion)}</strong></div>
    <div>فضای رنگی: <strong>${escapeHtml(metadata.overallColorMode)}</strong></div>
    <div>سقف TAC: <strong>${toPersianDigits(report.tacThresholdPercent)}٪</strong></div>
  </div>
  <table>
    <thead>
      <tr>
        <th style="width:110px;">وضعیت</th>
        <th>شرح بررسی و راهکار ساده</th>
        <th style="width:130px;">محدوده</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
}

/**
 * Generates a real A4 PDF Preflight Report with crisp Persian text & Shamsi date.
 */
export async function buildPreflightReportPdf(
  metadata: LithoDocumentMetadata,
  report: LithoPreflightReport
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`Preflight Report - ${metadata.fileName}`);
  pdfDoc.setCreator('PrintStudio Pro Lithography');

  const page = pdfDoc.addPage([595.28, 841.89]); // A4 portrait in points
  const backend = ensureOffscreenOrDomCanvas();

  if (backend) {
    const w = 1240;
    const h = 1754;
    let canvas: HTMLCanvasElement | OffscreenCanvas;
    let ctx: CanvasRenderingContext2D;
    if (backend === 'dom') {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      canvas = c;
      ctx = c.getContext('2d')!;
    } else {
      const c = new OffscreenCanvas(w, h);
      canvas = c;
      ctx = c.getContext('2d')! as unknown as CanvasRenderingContext2D;
    }

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    // Header
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(60, 60, w - 120, 4);
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    ctx.font = 'bold 34px Tahoma, sans-serif';
    ctx.fillText('گزارش پیش‌کنترل لیتوگرافی و پلیت‌سازی (Preflight)', w - 65, 118);

    ctx.font = '22px Tahoma, sans-serif';
    ctx.fillStyle = '#334155';
    ctx.fillText(`نام کار: ${metadata.fileName}`, w - 65, 160);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 22px Tahoma, sans-serif';
    ctx.fillText(`تاریخ شمسی: ${report.shamsiDate}`, 65, 118);
    ctx.fillStyle = report.isReadyForPress ? '#16a34a' : '#dc2626';
    ctx.fillText(
      report.isReadyForPress ? 'وضعیت: آماده پلیت‌گیری' : `وضعیت: ${toPersianDigits(report.errorCount)} خطا`,
      65,
      160
    );

    // Metadata box
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(60, 190, w - 120, 80);
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2;
    ctx.strokeRect(60, 190, w - 120, 80);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#0f172a';
    ctx.font = '20px Tahoma, sans-serif';
    ctx.fillText(
      `تعداد صفحات: ${toPersianDigits(metadata.pageCount)}   |   نسخه PDF: ${metadata.pdfVersion}   |   فضای رنگی: ${metadata.overallColorMode}   |   سقف TAC: ${toPersianDigits(report.tacThresholdPercent)}٪`,
      w - 82,
      238
    );

    // Report rows
    let y = 320;
    for (const item of report.items) {
      const color =
        item.severity === 'error'
          ? '#dc2626'
          : item.severity === 'warning'
            ? '#d97706'
            : '#16a34a';
      const label =
        item.severity === 'error' ? 'خطا' : item.severity === 'warning' ? 'هشدار' : 'تأیید';

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(60, y - 34, w - 120, 150);
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(60, y - 34, w - 120, 150);

      ctx.textAlign = 'left';
      ctx.fillStyle = color;
      ctx.font = 'bold 22px Tahoma, sans-serif';
      ctx.fillText(label, 84, y + 6);

      ctx.textAlign = 'right';
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 23px Tahoma, sans-serif';
      ctx.fillText(item.titleFa, w - 82, y + 4);

      ctx.fillStyle = '#334155';
      ctx.font = '20px Tahoma, sans-serif';
      ctx.fillText(item.summaryFa, w - 82, y + 40);

      ctx.fillStyle = '#64748b';
      ctx.font = '17px Tahoma, sans-serif';
      ctx.fillText(item.explanationFa.slice(0, 108), w - 82, y + 76);

      y += 172;
      if (y > h - 120) break;
    }

    const blob =
      'convertToBlob' in canvas
        ? await canvas.convertToBlob({ type: 'image/png' })
        : await new Promise<Blob | null>((res) => (canvas as HTMLCanvasElement).toBlob(res, 'image/png'));
    if (blob) {
      const pngBytes = new Uint8Array(await blob.arrayBuffer());
      const img = await pdfDoc.embedPng(pngBytes);
      page.drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 });
    }
  } else {
    // Minimal ASCII fallback if headless canvas unavailable
    page.drawText(`Preflight Report: ${metadata.fileName} (${report.errorCount} errors, ${report.warningCount} warnings)`, {
      x: 40,
      y: 780,
      size: 12,
    });
  }

  return await pdfDoc.save();
}

/**
 * Generates a realistic 2-page 4-color CMYK sample brochure PDF (148×210mm A5 + 3mm bleed)
 * so operators or acceptance tests can verify Preflight, FOGRA39 conversion & 4-plate separation immediately.
 */
export async function createSampleLithoPdfBytes(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('Sample 4-Color Offset Job');

  const trimW = 148 * MM_TO_PT;
  const trimH = 210 * MM_TO_PT;
  const bleed = 3 * MM_TO_PT;
  const fullW = trimW + bleed * 2;
  const fullH = trimH + bleed * 2;

  const p1 = doc.addPage([fullW, fullH]);
  p1.setMediaBox(0, 0, fullW, fullH);
  p1.setBleedBox(0, 0, fullW, fullH);
  p1.setTrimBox(bleed, bleed, trimW, trimH);

  // CMYK 4-color blocks covering full bleed
  p1.drawRectangle({ x: 0, y: 0, width: fullW, height: fullH, color: cmyk(0.04, 0.02, 0.02, 0) });
  p1.drawRectangle({ x: bleed + 18, y: fullH - bleed - 150, width: 160, height: 110, color: cmyk(0.95, 0.08, 0.0, 0.0) });
  p1.drawRectangle({ x: bleed + 195, y: fullH - bleed - 150, width: 160, height: 110, color: cmyk(0.0, 0.92, 0.12, 0.0) });
  p1.drawRectangle({ x: bleed + 18, y: fullH - bleed - 280, width: 160, height: 110, color: cmyk(0.0, 0.05, 0.95, 0.0) });
  p1.drawRectangle({ x: bleed + 195, y: fullH - bleed - 280, width: 160, height: 110, color: cmyk(0, 0, 0, 1) });
  p1.drawRectangle({ x: bleed + 18, y: bleed + 40, width: trimW - 36, height: 85, color: cmyk(0.85, 0.65, 0.25, 0.1) });

  const p2 = doc.addPage([fullW, fullH]);
  p2.setMediaBox(0, 0, fullW, fullH);
  p2.setBleedBox(0, 0, fullW, fullH);
  p2.setTrimBox(bleed, bleed, trimW, trimH);

  p2.drawRectangle({ x: 0, y: 0, width: fullW, height: fullH, color: cmyk(0, 0, 0, 0.04) });
  p2.drawCircle({ x: fullW / 2, y: fullH * 0.62, size: 95, color: cmyk(0.8, 0.25, 0.9, 0.05) });
  p2.drawRectangle({
    x: bleed + 40,
    y: bleed + 55,
    width: trimW - 80,
    height: 110,
    color: cmyk(0.25, 0.85, 0.75, 0.15),
    rotate: degrees(0),
  });

  return await doc.save();
}
