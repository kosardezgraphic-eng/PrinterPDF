import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createCanvas, Path2D } from '@napi-rs/canvas';
import { PDFDocument, PDFName, PDFNumber, StandardFonts, cmyk, rgb } from 'pdf-lib';
import UTIF from 'utif';
import { writePsdUint8Array } from 'ag-psd';
import {
  OFFSET_ICC_PROFILES,
  applyTacLimitAndGcr,
  buildSeparationBuffersFromRgba,
  convertRgbToCmyk,
  createDefaultLithoColorSettings,
  parseIccProfileBytes,
  renderSeparationPreviewRgba,
  resolveLithoPlateSizeMm,
} from './lithographyColor';
import {
  autoFixPdfForLithography,
  buildPreflightReportHtml,
  buildPreflightReportPdf,
  createSampleLithoPdfBytes,
  inspectPdfForLithography,
  runLithographyPreflight,
} from './lithographyPreflight';
import {
  createPrepressExtensionRegistry,
  createZipArchive,
  encodeCoverageTo1BitTiff,
  formatPlateFileName,
  generateLithographyExports,
} from './lithographyExport';
import { useAppStore } from '../store/useAppStore';

class TestOffscreenCanvas {
  private canvas;
  constructor(width: number, height: number) {
    this.canvas = createCanvas(width, height);
  }
  get width() {
    return this.canvas.width;
  }
  set width(value: number) {
    this.canvas.width = value;
  }
  get height() {
    return this.canvas.height;
  }
  set height(value: number) {
    this.canvas.height = value;
  }
  getContext() {
    return this.canvas.getContext('2d');
  }
  async convertToBlob() {
    return new Blob([new Uint8Array(await this.canvas.encode('png'))], { type: 'image/png' });
  }
}

const originalCanvas = globalThis.OffscreenCanvas;
const originalPath = globalThis.Path2D;

async function enableNodeCanvasForPdfJs() {
  (globalThis as unknown as { pdfjsWorker: unknown }).pdfjsWorker = await import(
    'pdfjs-dist/legacy/build/pdf.worker.mjs'
  );
  globalThis.OffscreenCanvas = TestOffscreenCanvas as unknown as typeof OffscreenCanvas;
  globalThis.Path2D = Path2D as unknown as typeof globalThis.Path2D;
}

afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  globalThis.OffscreenCanvas = originalCanvas;
  globalThis.Path2D = originalPath;
});

function buildSyntheticIccProfile(name = 'IranOffset_FOGRA39'): Uint8Array {
  const nameAscii = Array.from(name).map((ch) => ch.charCodeAt(0));
  const descTagSize = 12 + nameAscii.length + 1;
  const wtptTagSize = 20;
  const headerAndTableSize = 128 + 4 + 2 * 12;
  const totalSize = headerAndTableSize + descTagSize + wtptTagSize;
  const bytes = new Uint8Array(totalSize);
  const dv = new DataView(bytes.buffer);

  dv.setUint32(0, totalSize, false);
  bytes[8] = 2; // v2.4
  bytes[9] = 0x40;
  // Color space 'CMYK'
  'CMYK'.split('').forEach((c, i) => (bytes[16 + i] = c.charCodeAt(0)));
  // PCS 'Lab '
  'Lab '.split('').forEach((c, i) => (bytes[20 + i] = c.charCodeAt(0)));
  // Signature 'acsp' at 36
  'acsp'.split('').forEach((c, i) => (bytes[36 + i] = c.charCodeAt(0)));

  // Tag count = 2
  dv.setUint32(128, 2, false);

  // Entry 0: 'desc'
  const descOff = headerAndTableSize;
  'desc'.split('').forEach((c, i) => (bytes[132 + i] = c.charCodeAt(0)));
  dv.setUint32(136, descOff, false);
  dv.setUint32(140, descTagSize, false);

  // Entry 1: 'wtpt'
  const wtptOff = descOff + descTagSize;
  'wtpt'.split('').forEach((c, i) => (bytes[144 + i] = c.charCodeAt(0)));
  dv.setUint32(148, wtptOff, false);
  dv.setUint32(152, wtptTagSize, false);

  // Write desc payload
  'desc'.split('').forEach((c, i) => (bytes[descOff + i] = c.charCodeAt(0)));
  dv.setUint32(descOff + 8, nameAscii.length + 1, false);
  nameAscii.forEach((code, idx) => (bytes[descOff + 12 + idx] = code));

  // Write wtpt payload (D50 XYZ approx 0.964, 1.000, 0.825 in s15Fixed16)
  'XYZ '.split('').forEach((c, i) => (bytes[wtptOff + i] = c.charCodeAt(0)));
  dv.setInt32(wtptOff + 8, Math.round(0.9642 * 65536), false);
  dv.setInt32(wtptOff + 12, Math.round(1.0 * 65536), false);
  dv.setInt32(wtptOff + 16, Math.round(0.8249 * 65536), false);

  return bytes;
}

describe('Lithography Color Engine & ICC Parser', () => {
  it('parses valid ICC profiles and rejects corrupt files', () => {
    const iccBytes = buildSyntheticIccProfile('TehranPress_Coated_v2');
    const parsed = parseIccProfileBytes(iccBytes, 'TehranPress.icc');
    expect(parsed.colorSpace).toBe('CMYK');
    expect(parsed.pcs).toBe('Lab');
    expect(parsed.version).toBe('2.4');
    expect(parsed.description).toBe('TehranPress_Coated_v2');
    expect(parsed.whitePoint?.[1]).toBeCloseTo(1, 2);

    expect(() => parseIccProfileBytes(new Uint8Array(64), 'bad.icc')).toThrow();
    expect(() => parseIccProfileBytes(new Uint8Array(200), 'no-acsp.icc')).toThrow();
  });

  it('enforces TAC limit via GCR/UCR and preserves Pure Black K-only', () => {
    const settings = createDefaultLithoColorSettings();
    settings.maxTacPercent = 280;
    settings.gcrLevel = 'heavy';

    const clamped = applyTacLimitAndGcr(95, 90, 90, 85, settings);
    expect(clamped[0] + clamped[1] + clamped[2] + clamped[3]).toBeLessThanOrEqual(280.1);
    expect(clamped[3]).toBeGreaterThanOrEqual(85);

    // Pure black RGB (0, 0, 0) must stay on K plate only (0, 0, 0, K)
    const pureBlack = convertRgbToCmyk(4, 4, 4, settings);
    expect(pureBlack[0]).toBe(0);
    expect(pureBlack[1]).toBe(0);
    expect(pureBlack[2]).toBe(0);
    expect(pureBlack[3]).toBeGreaterThan(90);

    // Paper white stays 0/0/0/0
    expect(convertRgbToCmyk(255, 255, 255, settings)).toEqual([0, 0, 0, 0]);
  });

  it('separates RGBA pixels into C/M/Y/K + Spot plates and supports Overprint vs Knockout preview', () => {
    const settings = createDefaultLithoColorSettings();
    const spots = [
      {
        name: 'Pantone 185 C',
        alternateCmyk: [0, 96, 82, 0] as [number, number, number, number],
        previewHex: '#e4002b',
        handling: 'keep-spot' as const,
        maxCoveragePercent: 0,
      },
    ];
    // 2x2 image: Cyan-ish, Spot Red, Pure Black, White
    const rgba = new Uint8ClampedArray([
      0, 160, 230, 255,
      228, 0, 43, 255,
      0, 0, 0, 255,
      255, 255, 255, 255,
    ]);
    const sep = buildSeparationBuffersFromRgba(rgba, 2, 2, settings, spots, 300);
    expect(sep.c[0]).toBeGreaterThan(60);
    expect(sep.spots.get('Pantone 185 C')?.[1]).toBeGreaterThan(50);
    expect(sep.k[2]).toBeGreaterThan(90);
    expect(sep.tac[3]).toBe(0);

    const composite = renderSeparationPreviewRgba(sep, {
      enabledC: true,
      enabledM: true,
      enabledY: true,
      enabledK: true,
      enabledSpots: { 'Pantone 185 C': true },
      spotChannels: spots,
      simulateOverprint: true,
      highlightTacExceed: false,
      tacThresholdPercent: 300,
      settings,
    });
    expect(composite[0]).toBeLessThan(composite[2]); // Cyan keeps blue > red
    expect(composite[4]).toBeGreaterThan(150); // Spot Red stays red

    // Monochrome solo plate K renders pixel 2 dark (ink) and pixel 3 white (255)
    const monoK = renderSeparationPreviewRgba(sep, {
      enabledC: false,
      enabledM: false,
      enabledY: false,
      enabledK: true,
      enabledSpots: { 'Pantone 185 C': false },
      spotChannels: spots,
      simulateOverprint: true,
      highlightTacExceed: false,
      tacThresholdPercent: 300,
      monochromeSinglePlate: true,
      settings,
    });
    expect(monoK[2 * 4]).toBeLessThan(30);
    expect(monoK[3 * 4]).toBe(255);
  });
});

describe('Lithography Preflight, Auto-Fix, Reports & Acceptance Workflow', () => {
  it('flags unembedded font, missing bleed, RGB content, hairline, and suspicious white overprint, then Auto-Fixes fixable checks', async () => {
    await enableNodeCanvasForPdfJs();
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica); // standard unembedded font
    const page = doc.addPage([300, 300]); // no TrimBox/BleedBox -> missing bleed

    // Create ExtGState with op=true, OPM=0 (suspicious overprint)
    const gsRef = doc.context.register(
      doc.context.obj({ Type: PDFName.of('ExtGState'), op: true, OP: true, OPM: PDFNumber.of(0) })
    );
    page.node.normalize();
    const res = page.node.Resources();
    if (res) {
      res.set(PDFName.of('ExtGState'), doc.context.obj({ GSop: gsRef }));
    }

    // Inject raw RGB fill, white overprint risk, and hairline (0.1 w)
    page.drawText('Test Print', { x: 20, y: 240, size: 12, font, color: rgb(0.1, 0.2, 0.9) });
    page.drawLine({
      start: { x: 20, y: 200 },
      end: { x: 220, y: 200 },
      thickness: 0.1,
      color: rgb(0.9, 0.1, 0.1),
    });

    const rawBytes = await doc.save();
    const settings = createDefaultLithoColorSettings();
    const meta = await inspectPdfForLithography(rawBytes, 'broken-job.pdf', {
      colorSettings: settings,
      tacThresholdPercent: 300,
    });
    const report = runLithographyPreflight(meta, 300, false);

    const byId = Object.fromEntries(report.items.map((it) => [it.id, it]));
    expect(byId['fonts-embedded'].severity).toBe('error');
    expect(byId['bleed'].severity).toBe('error');
    expect(byId['rgb-lab'].severity).toBe('error');
    expect(byId['hairline'].severity).toBe('warning');
    expect(byId['transparency-overprint'].severity).toBe('error');

    // Run Auto-Fix and re-inspect
    const fixedBytes = await autoFixPdfForLithography(rawBytes, meta, settings);
    const fixedMeta = await inspectPdfForLithography(fixedBytes, 'broken-job.pdf', {
      colorSettings: settings,
      tacThresholdPercent: 300,
    });
    const fixedReport = runLithographyPreflight(fixedMeta, 300, true);
    const fixedById = Object.fromEntries(fixedReport.items.map((it) => [it.id, it]));

    expect(fixedById['bleed'].severity).toBe('pass');
    expect(fixedById['rgb-lab'].severity).toBe('pass');
    expect(fixedById['hairline'].severity).toBe('pass');
    expect(fixedReport.wasAutoFixed).toBe(true);

    // HTML & PDF reports with Shamsi date
    const html = buildPreflightReportHtml(fixedMeta, fixedReport);
    expect(html).toContain('dir="rtl"');
    expect(html).toContain(fixedReport.shamsiDate);
    const pdfReport = await buildPreflightReportPdf(fixedMeta, fixedReport);
    const loadedReport = await PDFDocument.load(pdfReport);
    expect(loadedReport.getPageCount()).toBe(1);
  });

  it('completes end-to-end 2-page 4-color CMYK acceptance flow: Preflight -> FOGRA39 -> 8 separation plates + 1-bit TIFF + PDF/X + ZIP', async () => {
    await enableNodeCanvasForPdfJs();
    const sampleBytes = await createSampleLithoPdfBytes();
    const settings = createDefaultLithoColorSettings();
    settings.iccProfile = 'FOGRA39';

    const meta = await inspectPdfForLithography(sampleBytes, 'brochure-4c.pdf', {
      colorSettings: settings,
      tacThresholdPercent: 300,
    });
    expect(meta.pageCount).toBe(2);
    expect(meta.overallColorMode).toBe('CMYK');

    const report = runLithographyPreflight(meta, 300);
    expect(report.isReadyForPress).toBe(true);

    // 1) Export Separate Plate PDFs (2 pages × 4 plates = 8 files)
    const platePdfExport = await generateLithographyExports({
      pdfBytes: sampleBytes,
      metadata: meta,
      colorSettings: settings,
      exportSettings: {
        format: 'plate-pdf',
        dpi: 300,
        includeCropMarks: true,
        includeRegistrationMarks: true,
        includeColorBar: true,
        includeSlug: true,
        jobNamePrefix: 'brochure',
      },
      tacThresholdPercent: 300,
    });
    expect(platePdfExport.files).toHaveLength(8);
    expect(platePdfExport.files.map((f) => f.fileName)).toEqual([
      'brochure_C_p01.pdf',
      'brochure_M_p01.pdf',
      'brochure_Y_p01.pdf',
      'brochure_K_p01.pdf',
      'brochure_C_p02.pdf',
      'brochure_M_p02.pdf',
      'brochure_Y_p02.pdf',
      'brochure_K_p02.pdf',
    ]);

    // Every generated plate PDF must load validly and contain ink on the plate
    for (const file of platePdfExport.files) {
      const loaded = await PDFDocument.load(file.bytes);
      expect(loaded.getPageCount()).toBe(1);
    }

    // 2) Export 1-Bit Screened TIFFs
    const tiffExport = await generateLithographyExports({
      pdfBytes: sampleBytes,
      metadata: meta,
      colorSettings: settings,
      exportSettings: {
        format: 'tiff-1bit',
        dpi: 1200,
        includeCropMarks: false,
        includeRegistrationMarks: false,
        includeColorBar: false,
        includeSlug: false,
        jobNamePrefix: 'brochure',
      },
      tacThresholdPercent: 300,
    });
    expect(tiffExport.files).toHaveLength(8);
    const firstTiff = tiffExport.files[0].bytes;
    expect(firstTiff[0]).toBe(0x49); // 'I'
    expect(firstTiff[1]).toBe(0x49); // 'I'
    const dv = new DataView(firstTiff.buffer, firstTiff.byteOffset, firstTiff.byteLength);
    expect(dv.getUint16(2, true)).toBe(42);
    // BitsPerSample tag 258 at index 2 -> value 1
    expect(dv.getUint16(10 + 2 * 12, true)).toBe(258);
    expect(dv.getUint32(10 + 2 * 12 + 8, true)).toBe(1);

    // 3) Export PDF/X-1a and PDF/X-4
    const pdfX1a = await generateLithographyExports({
      pdfBytes: sampleBytes,
      metadata: meta,
      colorSettings: settings,
      exportSettings: {
        format: 'pdf-x1a',
        dpi: 300,
        includeCropMarks: true,
        includeRegistrationMarks: true,
        includeColorBar: true,
        includeSlug: true,
        jobNamePrefix: 'brochure',
      },
      tacThresholdPercent: 300,
    });
    expect(pdfX1a.files).toHaveLength(1);
    const loadedX1a = await PDFDocument.load(pdfX1a.files[0].bytes);
    expect(loadedX1a.getPageCount()).toBe(2);
    expect(String(loadedX1a.catalog.get(PDFName.of('GTS_PDFXVersion')))).toContain('PDF/X-1a:2001');

    const pdfX4 = await generateLithographyExports({
      pdfBytes: sampleBytes,
      metadata: meta,
      colorSettings: settings,
      exportSettings: {
        format: 'pdf-x4',
        dpi: 600,
        includeCropMarks: true,
        includeRegistrationMarks: false,
        includeColorBar: false,
        includeSlug: true,
        jobNamePrefix: 'brochure',
      },
      tacThresholdPercent: 300,
    });
    expect(pdfX4.files).toHaveLength(1);
    const loadedX4 = await PDFDocument.load(pdfX4.files[0].bytes);
    expect(String(loadedX4.catalog.get(PDFName.of('GTS_PDFXVersion')))).toContain('PDF/X-4');

    // 4) ZIP packaging check
    const zipBytes = createZipArchive(platePdfExport.files);
    expect(zipBytes[0]).toBe(0x50); // 'P'
    expect(zipBytes[1]).toBe(0x4b); // 'K'
    expect(zipBytes[2]).toBe(0x03);
    expect(zipBytes[3]).toBe(0x04);
  }, 20000);

  it('provides clean extension hooks for out-of-MVP modules and encodes 1-bit halftone TIFF accurately', async () => {
    const registry = createPrepressExtensionRegistry();
    expect(registry.hooks.trapping).toBeUndefined();
    registry.registerTrapping({
      id: 'test-trap',
      stage: 'trapping',
      async execute(ctx) {
        return { plateC: ctx.plateC, plateM: ctx.plateM, plateY: ctx.plateY, plateK: ctx.plateK };
      },
    });
    expect(registry.hooks.trapping?.id).toBe('test-trap');

    const cov = new Uint8Array(64).fill(50);
    const tiff = encodeCoverageTo1BitTiff(cov, 8, 8, 2400, 'K');
    expect(tiff.byteLength).toBeGreaterThan(174);
    expect(formatPlateFileName('کارت ویزیت.pdf', 'C', 1, 'pdf')).toBe('کارت_ویزیت_C_p01.pdf');
  });

  it('integrates cleanly with Zustand store actions (sample job, presets, ICC profile, export)', async () => {
    await enableNodeCanvasForPdfJs();
    useAppStore.getState().clearLithoJobs();
    useAppStore.getState().setAppMode('lithography');
    expect(useAppStore.getState().appMode).toBe('lithography');

    await useAppStore.getState().loadSampleLithoJob();
    const jobs = useAppStore.getState().lithoJobs;
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe('done');
    expect(jobs[0].metadata?.pageCount).toBe(2);

    const savedId = useAppStore.getState().saveLithoPreset('قالب چاپ افست تست');
    expect(savedId).toBeTruthy();
    useAppStore.getState().setLithoTacThreshold(280);
    expect(useAppStore.getState().lithoJobs[0].preflight?.tacThresholdPercent).toBe(280);

    expect(OFFSET_ICC_PROFILES.FOGRA39.defaultTacPercent).toBe(300);
    const exported = await useAppStore.getState().exportLithoJobOutputs(jobs[0].id);
    expect(exported?.files).toHaveLength(8);
  });

  it('imports non-PDF formats (TIFF & PSD) into Lithography, runs Preflight & exports plates cleanly', async () => {
    globalThis.OffscreenCanvas = originalCanvas;
    useAppStore.getState().clearLithoJobs();

    // 1) Synthetic CMYK-rich TIFF file
    const rgba = new Uint8Array(24 * 16 * 4);
    for (let i = 0; i < 24 * 16; i++) {
      rgba[i * 4] = 15;
      rgba[i * 4 + 1] = 165;
      rgba[i * 4 + 2] = 235;
      rgba[i * 4 + 3] = 255;
    }
    const tifBytes = new Uint8Array(UTIF.encodeImage(rgba, 24, 16));
    const tifFile = new File([tifBytes], 'label-artwork.tif', { type: 'image/tiff' });

    // 2) Synthetic PSD file
    const psdRgba = new Uint8ClampedArray(20 * 20 * 4);
    for (let i = 0; i < 20 * 20; i++) {
      psdRgba[i * 4] = 217;
      psdRgba[i * 4 + 1] = 70;
      psdRgba[i * 4 + 2] = 239;
      psdRgba[i * 4 + 3] = 255;
    }
    const psdBytes = writePsdUint8Array({
      width: 20,
      height: 20,
      imageData: { width: 20, height: 20, data: psdRgba },
    });
    const psdFile = new File([new Uint8Array(psdBytes)], 'poster-master.psd');

    await useAppStore.getState().importLithoFiles([tifFile, psdFile]);
    const jobs = useAppStore.getState().lithoJobs;
    expect(jobs).toHaveLength(2);
    expect(jobs[0].status).toBe('done');
    expect(jobs[0].sourceFormat).toBe('TIFF');
    expect(jobs[0].metadata?.sourceFormat).toBe('TIFF');
    expect(jobs[1].status).toBe('done');
    expect(jobs[1].sourceFormat).toBe('PSD');
    expect(jobs[1].preflight?.items.length).toBeGreaterThan(0);

    const exported = await useAppStore.getState().exportLithoJobOutputs(jobs[1].id);
    expect(exported?.files).toHaveLength(4);
    expect(exported?.files[0].fileName).toContain('.pdf');
  }, 20000);

  it('supports built-in, custom, and user-saved Plate Sizes in both preview resolution and exported plate PDFs', async () => {
    await enableNodeCanvasForPdfJs();
    const resolvedSm52 = resolveLithoPlateSizeMm(
      {
        plateSizeId: 'sm52',
        plateOrientation: 'portrait',
        includeCropMarks: true,
        includeRegistrationMarks: true,
        includeColorBar: true,
        includeSlug: true,
      },
      148,
      210
    );
    expect(resolvedSm52.isFitDocument).toBe(false);
    expect(resolvedSm52.widthMm).toBe(459);
    expect(resolvedSm52.heightMm).toBe(525);

    const savedId = useAppStore.getState().saveLithoPlateSize('پلیت اختصاصی فرم ۳', 390, 540);
    expect(savedId).toBeTruthy();
    expect(useAppStore.getState().lithoSavedPlateSizes).toHaveLength(1);
    expect(useAppStore.getState().lithoExportSettings.plateSizeId).toBe(savedId);

    const sampleBytes = await createSampleLithoPdfBytes();
    const settings = createDefaultLithoColorSettings();
    const meta = await inspectPdfForLithography(sampleBytes, 'plate-size-test.pdf', {
      colorSettings: settings,
      tacThresholdPercent: 300,
    });

    const out = await generateLithographyExports({
      pdfBytes: sampleBytes,
      metadata: meta,
      colorSettings: settings,
      exportSettings: {
        format: 'plate-pdf',
        dpi: 300,
        includeCropMarks: true,
        includeRegistrationMarks: true,
        includeColorBar: true,
        includeSlug: true,
        jobNamePrefix: 'customplate',
        plateSizeId: savedId!,
        plateWidthMm: 390,
        plateHeightMm: 540,
        plateOrientation: 'portrait',
      },
      savedPlateSizes: useAppStore.getState().lithoSavedPlateSizes,
      tacThresholdPercent: 300,
    });

    const loadedFirstPlate = await PDFDocument.load(out.files[0].bytes);
    const { width, height } = loadedFirstPlate.getPages()[0].getMediaBox();
    const ptToMm = 25.4 / 72;
    expect(Math.round(width * ptToMm)).toBe(390);
    expect(Math.round(height * ptToMm)).toBe(540);

    useAppStore.getState().deleteLithoPlateSize(savedId!);
    expect(useAppStore.getState().lithoSavedPlateSizes).toHaveLength(0);
    expect(useAppStore.getState().lithoExportSettings.plateSizeId).toBe('fit-document');
  }, 20000);

  it('transfers composed Studio sheets directly into Lithography workspace and queue', async () => {
    globalThis.OffscreenCanvas = originalCanvas;
    useAppStore.getState().clearWorkspace();
    useAppStore.getState().clearLithoJobs();

    // Put a real 2-page PDF document + pages into Studio state
    const srcPdf = await createSampleLithoPdfBytes();
    const docId = 'doc-studio-transfer';
    useAppStore.setState({
      appMode: 'studio',
      documents: [
        {
          id: docId,
          name: 'studio-brochure.pdf',
          filePath: 'studio-brochure.pdf',
          fileSize: srcPdf.byteLength,
          fileType: 'pdf',
          mimeType: 'application/pdf',
          pageCount: 2,
          createdAt: new Date().toISOString(),
          rawBytes: srcPdf,
        },
      ],
      pages: [1, 2].map((num) => ({
        id: `p-transfer-${num}`,
        documentId: docId,
        documentName: 'studio-brochure.pdf',
        sourcePageNumber: num,
        widthMm: 154,
        heightMm: 216,
        rotation: 0,
        selectedForPrint: true,
        isHighlighted: num === 1,
        isBlankPage: false,
        colorProfile: 'color',
        inkCoveragePercent: 35,
      })),
    });

    const ok = await useAppStore.getState().sendStudioSheetsToLithography('all');
    expect(ok).toBe(true);
    const st = useAppStore.getState();
    expect(st.appMode).toBe('lithography');
    expect(st.lithoJobs).toHaveLength(1);
    expect(st.lithoJobs[0].status).toBe('done');
    expect(st.lithoJobs[0].fileName).toContain('Studio-Composed');
  }, 20000);
});
