import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import type {
  EffectsSettings,
  LayoutSettings,
  PageItem,
  SourceDocument,
} from '@shared/models';
import {
  computeImpositionSheets,
  computeManualDuplexPasses,
  getOrderedGridCoordinates,
  getSheetDimensionsMm,
} from './layoutEngine';
import {
  classifyPaperSizeLabel,
  computeCounterSummary,
} from './counterEngine';
import {
  applyEffectsToRgbaBuffer,
  buildCssFilterForPage,
} from './effectsPipeline';
import {
  formatPageNumberLabel,
  getDefaultPageNumberSettings,
  getDefaultWatermarkSettings,
  resolveTextMacros,
} from './watermarkEngine';
import {
  gregorianToJalali,
  toPersianDigits,
  toRomanNumeral,
} from '../i18n/shamsi';
import { CommandHistoryManager } from './commandHistory';
import { exportImposedPdf } from './pdfService';

function createMockPages(count: number): PageItem[] {
  return Array.from({ length: count }, (_, idx) => ({
    id: `p-${idx + 1}`,
    documentId: 'doc-1',
    documentName: 'TestDoc.pdf',
    sourcePageNumber: idx + 1,
    widthMm: 210,
    heightMm: 297,
    rotation: 0,
    selectedForPrint: true,
    isHighlighted: idx === 0,
    isBlankPage: false,
    colorProfile: idx % 2 === 0 ? 'color' : 'grayscale',
    inkCoveragePercent: 15,
  }));
}

const baseLayout: LayoutSettings = {
  paperSize: 'A4',
  customWidthMm: 210,
  customHeightMm: 297,
  orientation: 'portrait',
  rows: 2,
  cols: 2,
  placementMode: 'sequential',
  uniqueScale: false,
  marginsMm: { top: 10, right: 10, bottom: 10, left: 10 },
  horizontalGutterMm: 5,
  verticalGutterMm: 5,
  scaleMode: 'fit',
  customScalePercent: 100,
  alignment: 'center',
  autoRotateToFit: false,
  duplexMode: 'none',
  sheetOrder: 'ltr',
  manualDuplex: false,
  showCellBorders: true,
  showCropMarks: false,
};

describe('PrintStudio Pro — Core Engines Unit & Integration Tests', () => {
  it('D1-D5: computes 4-Up sequential and step-and-repeat imposition accurately', () => {
    const pages = createMockPages(6);
    const sheetsSequential = computeImpositionSheets(pages, baseLayout);
    // 6 pages in 2x2 (4-Up) => 2 sheet sides
    expect(sheetsSequential).toHaveLength(2);
    expect(sheetsSequential[0].cells.filter((c) => c.page !== null)).toHaveLength(4);
    expect(sheetsSequential[1].cells.filter((c) => c.page !== null)).toHaveLength(2);

    // Step & Repeat mode: each page fills all 4 cells of its own sheet
    const sheetsRepeat = computeImpositionSheets(pages.slice(0, 3), {
      ...baseLayout,
      placementMode: 'step-and-repeat',
    });
    expect(sheetsRepeat).toHaveLength(3);
    expect(
      sheetsRepeat[0].cells.every((c) => c.page?.id === 'p-1')
    ).toBe(true);
  });

  it('D5: handles Duplex pairing and RTL/Column/Spiral cell ordering', () => {
    const pages = createMockPages(5); // 5 pages @ 4-Up = 2 sides (1 Front, 1 Back = 1 physical sheet)
    const duplexSheets = computeImpositionSheets(pages, {
      ...baseLayout,
      duplexMode: 'long-edge',
      sheetOrder: 'rtl',
    });

    expect(duplexSheets).toHaveLength(2);
    expect(duplexSheets[0].side).toBe('front');
    expect(duplexSheets[1].side).toBe('back');
    expect(duplexSheets[0].sheetNumber).toBe(1);
    expect(duplexSheets[1].sheetNumber).toBe(1);

    // In RTL 2x2, first cell is row 0, col 1
    const rtlCoords = getOrderedGridCoordinates(2, 2, 'rtl');
    expect(rtlCoords[0]).toEqual({ row: 0, col: 1 });
    expect(rtlCoords[1]).toEqual({ row: 0, col: 0 });

    const manualPasses = computeManualDuplexPasses(duplexSheets, 'long-edge');
    expect(manualPasses.pass1FrontSides).toHaveLength(1);
    expect(manualPasses.pass2BackSides).toHaveLength(1);
    expect(manualPasses.flipInstructionFa).toContain('لبه بلند');
  });

  it('B1-B2: computes instant Counter Summary with N-Up, Duplex, and Tariff costs', () => {
    const pages = createMockPages(10); // 5 color, 5 grayscale
    const docs: SourceDocument[] = [
      {
        id: 'doc-1',
        name: 'TestDoc.pdf',
        filePath: 'TestDoc.pdf',
        fileSize: 102400,
        fileType: 'pdf',
        mimeType: 'application/pdf',
        pageCount: 10,
        createdAt: new Date().toISOString(),
      },
    ];

    const summary = computeCounterSummary(
      docs,
      pages,
      { ...baseLayout, rows: 2, cols: 1, duplexMode: 'long-edge' }, // 2-Up + Duplex = 4 pages per physical sheet
      {
        bwPageTariffRials: 10000,
        colorPageTariffRials: 50000,
        duplexDiscountPercent: 10,
      }
    );

    expect(summary.totalFiles).toBe(1);
    expect(summary.totalPages).toBe(10);
    expect(summary.selectedPages).toBe(10);
    expect(summary.colorPages).toBe(5);
    expect(summary.bwPages).toBe(5);
    expect(summary.totalImpressions).toBe(5); // 10 pages / 2-Up = 5 sides
    expect(summary.totalPhysicalSheets).toBe(3); // ceil(5 sides / 2) = 3 physical sheets
    // Cost: (5*50000 + 5*10000) * 0.9 = 300000 * 0.9 = 270000
    expect(summary.estimatedCostRials).toBe(270000);
    expect(classifyPaperSizeLabel(210, 297)).toBe('A4');
  });

  it('E1-E2: executes non-destructive Effects Pipeline (Invert, Grayscale, Threshold)', () => {
    const page = createMockPages(1)[0];
    const effects: EffectsSettings = {
      enabled: true,
      scope: 'all',
      invert: true,
      invertPdfStrategy: 'vector-blend',
      grayscale: true,
      blackAndWhite: false,
      threshold: 128,
      blackText: false,
      brightness: 10,
      contrast: 20,
      gamma: 1,
      sharpness: 0,
    };

    const cssFilter = buildCssFilterForPage(page, effects);
    expect(cssFilter).toContain('grayscale(1)');
    expect(cssFilter).toContain('invert(1)');

    // Test pixel RGBA pipeline: pure white pixel [255,255,255,255] inverted becomes [0,0,0,255]
    const whitePixel = new Uint8ClampedArray([255, 255, 255, 255]);
    const invertedPixel = applyEffectsToRgbaBuffer(whitePixel, {
      ...effects,
      brightness: 0,
      contrast: 0,
    });
    expect(invertedPixel[0]).toBe(0);
    expect(invertedPixel[1]).toBe(0);
    expect(invertedPixel[2]).toBe(0);
    expect(invertedPixel[3]).toBe(255);
  });

  it('F1-F2 & Shamsi Calendar: resolves macros, Shamsi dates, Persian digits, and Bates numbers', () => {
    const jalali = gregorianToJalali(2026, 3, 21); // 1 Farvardin 1405
    expect(jalali.jy).toBe(1405);
    expect(jalali.jm).toBe(1);
    expect(jalali.jd).toBe(1);

    expect(toPersianDigits(1405)).toBe('۱۴۰۵');
    expect(toRomanNumeral(14)).toBe('XIV');

    const resolved = resolveTextMacros(
      'سند {file} - صفحه {page} از {pages} - کاربر {user}',
      {
        pageNumber: 3,
        totalPages: 12,
        sheetNumber: 2,
        totalSheets: 6,
        fileName: 'Thesis.pdf',
        userName: 'Ali',
      }
    );
    expect(resolved).toBe('سند Thesis.pdf - صفحه 3 از 12 - کاربر Ali');

    const bates = formatPageNumberLabel(
      {
        ...getDefaultPageNumberSettings(),
        format: 'bates',
        batesPrefix: 'JOB-',
        batesDigits: 5,
        startNumber: 42,
      },
      1,
      10
    );
    expect(bates).toBe('JOB-00042');
  });

  it('A5: CommandHistoryManager supports unlimited Undo and Redo', () => {
    const history = new CommandHistoryManager<number[]>();
    history.record('افزودن صفحه', 'Add page', [1, 2], [1, 2, 3]);
    history.record('حذف صفحه', 'Remove page', [1, 2, 3], [1, 3]);

    expect(history.canUndo()).toBe(true);
    const undone = history.undo();
    expect(undone?.before).toEqual([1, 2, 3]);
    expect(history.canRedo()).toBe(true);
    const redone = history.redo();
    expect(redone?.after).toEqual([1, 3]);
  });

  it('rejects export when a nonblank source document is missing', async () => {
    await expect(exportImposedPdf({
      documents: [], pages: createMockPages(1), layout: baseLayout,
      effects: { enabled: false, scope: 'all', invert: false, invertPdfStrategy: 'vector-blend', grayscale: false, blackAndWhite: false, threshold: 128, blackText: false, brightness: 0, contrast: 0, gamma: 1, sharpness: 0 },
      watermark: getDefaultWatermarkSettings(), pageNumbering: getDefaultPageNumberSettings(), userName: 'test',
    })).rejects.toThrow('source');
  });

  it('C1-C2 & E1: exports valid imposed PDF with Vector BlendMode.Difference for Invert', async () => {
    const pages = createMockPages(4);
    const source = await PDFDocument.create();
    for (let i = 0; i < 4; i++) source.addPage([595, 842]);
    const documents = [{ id: 'doc-1', fileType: 'pdf', rawBytes: await source.save() }] as SourceDocument[];
    const pdfBytes = await exportImposedPdf({
      documents,
      pages,
      layout: baseLayout,
      effects: {
        enabled: true,
        scope: 'all',
        invert: true,
        invertPdfStrategy: 'vector-blend',
        grayscale: false,
        blackAndWhite: false,
        threshold: 128,
        blackText: false,
        brightness: 0,
        contrast: 0,
        gamma: 1,
        sharpness: 0,
      },
      watermark: { ...getDefaultWatermarkSettings(), enabled: true },
      pageNumbering: getDefaultPageNumberSettings(),
      userName: 'TestOperator',
    });

    expect(pdfBytes.byteLength).toBeGreaterThan(500);
    const parsed = await PDFDocument.load(pdfBytes);
    expect(parsed.getPageCount()).toBe(1); // 4 pages in 2x2 = 1 sheet
    const { widthMm, heightMm } = getSheetDimensionsMm(baseLayout);
    expect(widthMm).toBe(210);
    expect(heightMm).toBe(297);
  });
});
