import {
  STANDARD_PAPER_SIZES,
  type LayoutSettings,
  type MarginsMm,
  type NumberingSequenceBasis,
  type NumberingSequenceDirection,
  type PageItem,
  type PageOrientation,
  type PageOverlay,
  type PageOverlayNumbering,
  type PageOverlayShape,
  type PaperSizeId,
  type SheetOrderMode,
  type SourceDocument,
} from '@shared/models';
import { computeImpositionSheets } from './layoutEngine';
import { resolveNumberingTemplate } from './textOverlays';

export const MAX_TICKET_COUNT = 2000;
export const MAX_TICKET_GRID = 12;

export type TicketOrderingMode = 'per-sheet' | 'cut-stack';
export type TicketDirection = 'rtl' | 'ltr' | 'ttb' | 'zigzag';
export type TicketQuantityMode = 'sheets' | 'tickets';
export type TicketGuideKind = 'perforation' | 'cut';
export type TicketGuideOrientation = 'vertical' | 'horizontal';

export interface TicketNumberSlot {
  id: string;
  label: string;
  template: string;
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  heightPercent: number;
  fontSize: number;
  fontFamily: string;
  color: string;
  backgroundColor: string;
  bold: boolean;
  italic: boolean;
  align: 'left' | 'center' | 'right';
  rotation: number;
  slotOffset: number;
}

export interface TicketGuideLine {
  id: string;
  label: string;
  kind: TicketGuideKind;
  orientation: TicketGuideOrientation;
  /** Position along the perpendicular axis inside each ticket cell (0..100%). */
  positionPercent: number;
  /** When true, extends the line across the full output sheet height/width per column/row. */
  extendFullSheet: boolean;
  strokeColor: string;
  strokeStyle: 'solid' | 'dashed' | 'dotted';
  strokeWidth: number;
}

export interface TicketConfig {
  paperSize: PaperSizeId;
  customWidthMm: number;
  customHeightMm: number;
  orientation: PageOrientation;
  rows: number;
  cols: number;
  marginsMm: MarginsMm;
  horizontalGutterMm: number;
  verticalGutterMm: number;
  quantityMode: TicketQuantityMode;
  sheetCount: number;
  ticketCount: number;
  startNumber: number;
  step: number;
  padZeros: number;
  format: 'english' | 'persian';
  orderingMode: TicketOrderingMode;
  direction: TicketDirection;
  autoGridCutLines: boolean;
  gridCutLineColor: string;
  gridCutLineStyle: 'solid' | 'dashed' | 'dotted';
  gridCutLineWidthPt: number;
  numberSlots: TicketNumberSlot[];
  guideLines: TicketGuideLine[];
}

export interface TicketGridMetrics {
  sheetWidthMm: number;
  sheetHeightMm: number;
  printableWidthMm: number;
  printableHeightMm: number;
  rows: number;
  cols: number;
  ticketsPerSheet: number;
  cellWidthMm: number;
  cellHeightMm: number;
  effectiveSheetCount: number;
  totalTickets: number;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function createDefaultTicketConfig(): TicketConfig {
  return {
    paperSize: 'A4',
    customWidthMm: 210,
    customHeightMm: 297,
    orientation: 'portrait',
    rows: 3,
    cols: 1,
    marginsMm: { top: 4, right: 4, bottom: 4, left: 4 },
    horizontalGutterMm: 0,
    verticalGutterMm: 0,
    quantityMode: 'sheets',
    sheetCount: 10,
    ticketCount: 30,
    startNumber: 1001,
    step: 1,
    padZeros: 0,
    format: 'english',
    orderingMode: 'per-sheet',
    direction: 'rtl',
    autoGridCutLines: true,
    gridCutLineColor: '#0284c7',
    gridCutLineStyle: 'solid',
    gridCutLineWidthPt: 0.8,
    numberSlots: [
      {
        id: 'slot-main',
        label: 'شماره راست (اصلی)',
        template: 'شماره {serial}',
        xPercent: 56,
        yPercent: 6,
        widthPercent: 34,
        heightPercent: 14,
        fontSize: 11,
        fontFamily: 'Vazirmatn',
        color: '#0f172a',
        backgroundColor: 'transparent',
        bold: true,
        italic: false,
        align: 'center',
        rotation: 0,
        slotOffset: 0,
      },
      {
        id: 'slot-stub',
        label: 'شماره چپ (ته‌چک)',
        template: 'شماره {serial}',
        xPercent: 5,
        yPercent: 6,
        widthPercent: 28,
        heightPercent: 14,
        fontSize: 11,
        fontFamily: 'Vazirmatn',
        color: '#0f172a',
        backgroundColor: 'transparent',
        bold: true,
        italic: false,
        align: 'center',
        rotation: 0,
        slotOffset: 0,
      },
    ],
    guideLines: [
      {
        id: 'guide-perf-1',
        label: 'خط پرفراژ عمودی',
        kind: 'perforation',
        orientation: 'vertical',
        positionPercent: 36,
        extendFullSheet: true,
        strokeColor: '#0284c7',
        strokeStyle: 'dashed',
        strokeWidth: 0.9,
      },
    ],
  };
}

export const DEFAULT_TICKET_CONFIG: TicketConfig = createDefaultTicketConfig();

export function getTicketSheetDimensionsMm(config: TicketConfig): {
  widthMm: number;
  heightMm: number;
} {
  let baseW = config.customWidthMm;
  let baseH = config.customHeightMm;
  if (config.paperSize !== 'Custom') {
    const std = STANDARD_PAPER_SIZES[config.paperSize];
    baseW = std.widthMm;
    baseH = std.heightMm;
  }
  const shortSide = Math.min(Math.max(20, baseW), Math.max(20, baseH));
  const longSide = Math.max(Math.max(20, baseW), Math.max(20, baseH));
  return config.orientation === 'landscape'
    ? { widthMm: longSide, heightMm: shortSide }
    : { widthMm: shortSide, heightMm: longSide };
}

export function getTicketGridMetrics(config: TicketConfig): TicketGridMetrics {
  const { widthMm: sheetWidthMm, heightMm: sheetHeightMm } = getTicketSheetDimensionsMm(config);
  const rows = Math.round(clamp(config.rows, 1, MAX_TICKET_GRID));
  const cols = Math.round(clamp(config.cols, 1, MAX_TICKET_GRID));
  const ticketsPerSheet = rows * cols;

  const left = clamp(config.marginsMm.left, 0, sheetWidthMm * 0.4);
  const right = clamp(config.marginsMm.right, 0, sheetWidthMm * 0.4);
  const top = clamp(config.marginsMm.top, 0, sheetHeightMm * 0.4);
  const bottom = clamp(config.marginsMm.bottom, 0, sheetHeightMm * 0.4);

  const printableWidthMm = Math.max(10, sheetWidthMm - left - right);
  const printableHeightMm = Math.max(10, sheetHeightMm - top - bottom);

  const hGutter = Math.max(0, config.horizontalGutterMm);
  const vGutter = Math.max(0, config.verticalGutterMm);

  const cellWidthMm = Math.max(5, (printableWidthMm - Math.max(0, cols - 1) * hGutter) / cols);
  const cellHeightMm = Math.max(5, (printableHeightMm - Math.max(0, rows - 1) * vGutter) / rows);

  let effectiveSheetCount = 1;
  let totalTickets = ticketsPerSheet;

  if (config.quantityMode === 'tickets') {
    totalTickets = Math.round(clamp(config.ticketCount, 1, MAX_TICKET_COUNT));
    effectiveSheetCount = Math.max(1, Math.ceil(totalTickets / ticketsPerSheet));
  } else {
    const maxSheets = Math.max(1, Math.floor(MAX_TICKET_COUNT / ticketsPerSheet));
    effectiveSheetCount = Math.round(clamp(config.sheetCount, 1, maxSheets));
    totalTickets = effectiveSheetCount * ticketsPerSheet;
  }

  return {
    sheetWidthMm,
    sheetHeightMm,
    printableWidthMm,
    printableHeightMm,
    rows,
    cols,
    ticketsPerSheet,
    cellWidthMm,
    cellHeightMm,
    effectiveSheetCount,
    totalTickets,
  };
}

export function ticketDirectionToSheetOrder(direction: TicketDirection): SheetOrderMode {
  switch (direction) {
    case 'rtl':
      return 'rtl';
    case 'ttb':
      return 'column';
    case 'zigzag':
      return 'spiral';
    case 'ltr':
    default:
      return 'ltr';
  }
}

export function buildNumberingOverlayForSlot(
  slot: TicketNumberSlot,
  config: TicketConfig,
  indexOffsetForCustomId = 0
): PageOverlayNumbering {
  const safeStep = Number.isFinite(config.step) && config.step !== 0 ? Math.trunc(config.step) : 1;
  const customScript = safeStep === 1 ? '' : `(page - 1) * ${safeStep} + 1`;
  const sequenceBasis: NumberingSequenceBasis =
    config.orderingMode === 'cut-stack' ? 'cut-stack' : 'page';
  const sequenceDirection: NumberingSequenceDirection = config.direction;

  return {
    id: `ticket-num-${slot.id || indexOffsetForCustomId}`,
    kind: 'numbering',
    enabled: true,
    target: 'page',
    targetScope: 'all',
    targetPageIds: [],
    targetSheetIndex: 1,
    xPercent: clamp(slot.xPercent, 0, 96),
    yPercent: clamp(slot.yPercent, 0, 96),
    widthPercent: clamp(slot.widthPercent, 4, 100),
    heightPercent: clamp(slot.heightPercent, 4, 100),
    opacity: 1,
    rotation: ((slot.rotation % 360) + 360) % 360,
    lockAspect: false,
    fontSize: clamp(slot.fontSize, 6, 80),
    fontFamily: slot.fontFamily || 'Vazirmatn',
    color: slot.color || '#0f172a',
    ...(slot.backgroundColor && slot.backgroundColor !== 'transparent'
      ? { backgroundColor: slot.backgroundColor }
      : {}),
    bold: Boolean(slot.bold),
    italic: Boolean(slot.italic),
    align: slot.align ?? 'center',
    format: config.format,
    template: slot.template || 'شماره {serial}',
    startOffset: Math.trunc(config.startNumber + (slot.slotOffset || 0)),
    padZeros: Math.round(clamp(config.padZeros, 0, 10)),
    customScript,
    sequenceBasis,
    sequenceDirection,
  };
}

export function resolveTicketSlotText(
  slot: TicketNumberSlot,
  seqIndex1Based: number,
  totalTickets: number,
  config: TicketConfig
): string {
  const overlay = buildNumberingOverlayForSlot(slot, config);
  try {
    return resolveNumberingTemplate(overlay, Math.max(1, seqIndex1Based), Math.max(1, totalTickets)).text;
  } catch {
    return slot.template;
  }
}

export function computeAutoGridCutLinesMm(config: TicketConfig): {
  horizontalMm: number[];
  verticalMm: number[];
} {
  const metrics = getTicketGridMetrics(config);
  const horizontalMm: number[] = [];
  const verticalMm: number[] = [];
  const vGutter = Math.max(0, config.verticalGutterMm);
  const hGutter = Math.max(0, config.horizontalGutterMm);

  for (let r = 1; r < metrics.rows; r++) {
    horizontalMm.push(
      config.marginsMm.top + r * metrics.cellHeightMm + (r - 0.5) * vGutter
    );
  }
  for (let c = 1; c < metrics.cols; c++) {
    verticalMm.push(
      config.marginsMm.left + c * metrics.cellWidthMm + (c - 0.5) * hGutter
    );
  }
  return { horizontalMm, verticalMm };
}

export function buildTicketStudioLayout(
  baseLayout: LayoutSettings,
  config: TicketConfig
): LayoutSettings {
  const metrics = getTicketGridMetrics(config);
  return {
    ...baseLayout,
    paperSize: config.paperSize,
    customWidthMm: config.customWidthMm,
    customHeightMm: config.customHeightMm,
    orientation: config.orientation,
    rows: metrics.rows,
    cols: metrics.cols,
    placementMode: 'sequential',
    uniqueScale: true,
    marginsMm: {
      top: clamp(config.marginsMm.top, 0, metrics.sheetHeightMm * 0.4),
      right: clamp(config.marginsMm.right, 0, metrics.sheetWidthMm * 0.4),
      bottom: clamp(config.marginsMm.bottom, 0, metrics.sheetHeightMm * 0.4),
      left: clamp(config.marginsMm.left, 0, metrics.sheetWidthMm * 0.4),
    },
    marginMode: 'custom',
    horizontalGutterMm: Math.max(0, config.horizontalGutterMm),
    verticalGutterMm: Math.max(0, config.verticalGutterMm),
    scaleMode: 'fit',
    customScalePercent: 100,
    alignment: 'center',
    autoRotateToFit: false,
    duplexMode: 'none',
    sheetOrder: ticketDirectionToSheetOrder(config.direction),
    manualDuplex: false,
    showCellBorders: false,
    showCropMarks: false,
    cellOverrides: {},
    booklet: {
      ...(baseLayout.booklet ?? {
        enabled: false,
        direction: 'rtl',
        signatureSize: 0,
        spineWidthMm: 4,
        creepMm: 0.2,
        duplexMode: 'short-edge',
        outerMarginMm: 10,
        compensateCreep: true,
      }),
      enabled: false,
    },
  };
}

function makeLineShapeOverlay(params: {
  id: string;
  target: 'page' | 'sheet';
  orientation: TicketGuideOrientation;
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  heightPercent: number;
  strokeColor: string;
  strokeStyle: 'solid' | 'dashed' | 'dotted';
  strokeWidth: number;
}): PageOverlayShape {
  return {
    id: params.id,
    kind: 'shape',
    type: 'line',
    lineOrientation: params.orientation,
    lineCap: 'butt',
    target: params.target,
    targetScope: 'all',
    targetPageIds: [],
    targetSheetIndex: 1,
    xPercent: params.xPercent,
    yPercent: params.yPercent,
    widthPercent: params.widthPercent,
    heightPercent: params.heightPercent,
    opacity: 1,
    rotation: 0,
    lockAspect: false,
    fillColor: 'transparent',
    strokeColor: params.strokeColor,
    strokeStyle: params.strokeStyle,
    strokeWidth: clamp(params.strokeWidth, 0.2, 8),
    borderRadius: 0,
  };
}

/**
 * Produces real Studio overlays (PageOverlayNumbering + PageOverlayShape line guides)
 * so every generated sheet is immediately previewable and editable in Studio.
 */
export function buildTicketStudioOverlays(
  config: TicketConfig,
  studioLayout: LayoutSettings,
  samplePages?: PageItem[]
): PageOverlay[] {
  const overlays: PageOverlay[] = [];
  const metrics = getTicketGridMetrics(config);

  // Measure representative first sheet cells so sheet-spanning guides align cleanly with content
  const firstSheet =
    samplePages && samplePages.length > 0
      ? computeImpositionSheets(samplePages.slice(0, metrics.ticketsPerSheet), studioLayout)[0]
      : undefined;

  // 1. Auto grid cut lines between rows & cols
  if (config.autoGridCutLines) {
    const { horizontalMm, verticalMm } = computeAutoGridCutLinesMm(config);
    const hBoxPercent = clamp((2.4 / Math.max(10, metrics.sheetHeightMm)) * 100, 0.4, 4);
    const wBoxPercent = clamp((2.4 / Math.max(10, metrics.sheetWidthMm)) * 100, 0.4, 4);

    horizontalMm.forEach((yMm, idx) => {
      const centerPercent = clamp((yMm / metrics.sheetHeightMm) * 100, 0, 100);
      overlays.push(
        makeLineShapeOverlay({
          id: `ticket-grid-cut-h-${idx + 1}`,
          target: 'sheet',
          orientation: 'horizontal',
          xPercent: 0,
          yPercent: centerPercent - hBoxPercent / 2,
          widthPercent: 100,
          heightPercent: hBoxPercent,
          strokeColor: config.gridCutLineColor,
          strokeStyle: config.gridCutLineStyle,
          strokeWidth: config.gridCutLineWidthPt,
        })
      );
    });

    verticalMm.forEach((xMm, idx) => {
      const centerPercent = clamp((xMm / metrics.sheetWidthMm) * 100, 0, 100);
      overlays.push(
        makeLineShapeOverlay({
          id: `ticket-grid-cut-v-${idx + 1}`,
          target: 'sheet',
          orientation: 'vertical',
          xPercent: centerPercent - wBoxPercent / 2,
          yPercent: 0,
          widthPercent: wBoxPercent,
          heightPercent: 100,
          strokeColor: config.gridCutLineColor,
          strokeStyle: config.gridCutLineStyle,
          strokeWidth: config.gridCutLineWidthPt,
        })
      );
    });
  }

  // 2. Custom Cut & Perforation guide lines
  for (const guide of config.guideLines) {
    const pos = clamp(guide.positionPercent, 0, 100);
    if (!guide.extendFullSheet) {
      if (guide.orientation === 'vertical') {
        const boxW = clamp((2.4 / Math.max(5, metrics.cellWidthMm)) * 100, 0.6, 8);
        overlays.push(
          makeLineShapeOverlay({
            id: `ticket-guide-${guide.id}`,
            target: 'page',
            orientation: 'vertical',
            xPercent: pos - boxW / 2,
            yPercent: 0,
            widthPercent: boxW,
            heightPercent: 100,
            strokeColor: guide.strokeColor,
            strokeStyle: guide.strokeStyle,
            strokeWidth: guide.strokeWidth,
          })
        );
      } else {
        const boxH = clamp((2.4 / Math.max(5, metrics.cellHeightMm)) * 100, 0.6, 8);
        overlays.push(
          makeLineShapeOverlay({
            id: `ticket-guide-${guide.id}`,
            target: 'page',
            orientation: 'horizontal',
            xPercent: 0,
            yPercent: pos - boxH / 2,
            widthPercent: 100,
            heightPercent: boxH,
            strokeColor: guide.strokeColor,
            strokeStyle: guide.strokeStyle,
            strokeWidth: guide.strokeWidth,
          })
        );
      }
      continue;
    }

    // Extended sheet-wide guides: emit once per unique column (vertical) or row (horizontal)
    if (guide.orientation === 'vertical') {
      const boxW = clamp((2.4 / Math.max(10, metrics.sheetWidthMm)) * 100, 0.4, 4);
      const colPositions = new Map<number, number>();
      if (firstSheet) {
        for (const cell of firstSheet.cells) {
          if (colPositions.has(cell.col)) continue;
          const xMm =
            cell.contentWidthMm > 0
              ? cell.contentXMm + (pos / 100) * cell.contentWidthMm
              : cell.cellXMm + (pos / 100) * cell.cellWidthMm;
          colPositions.set(cell.col, xMm);
        }
      } else {
        for (let c = 0; c < metrics.cols; c++) {
          const xMm =
            config.marginsMm.left +
            c * (metrics.cellWidthMm + Math.max(0, config.horizontalGutterMm)) +
            (pos / 100) * metrics.cellWidthMm;
          colPositions.set(c, xMm);
        }
      }
      Array.from(colPositions.entries())
        .sort((a, b) => a[0] - b[0])
        .forEach(([colIdx, xMm]) => {
          const centerPercent = clamp((xMm / metrics.sheetWidthMm) * 100, 0, 100);
          overlays.push(
            makeLineShapeOverlay({
              id: `ticket-guide-${guide.id}-col-${colIdx}`,
              target: 'sheet',
              orientation: 'vertical',
              xPercent: centerPercent - boxW / 2,
              yPercent: 0,
              widthPercent: boxW,
              heightPercent: 100,
              strokeColor: guide.strokeColor,
              strokeStyle: guide.strokeStyle,
              strokeWidth: guide.strokeWidth,
            })
          );
        });
    } else {
      const boxH = clamp((2.4 / Math.max(10, metrics.sheetHeightMm)) * 100, 0.4, 4);
      const rowPositions = new Map<number, number>();
      if (firstSheet) {
        for (const cell of firstSheet.cells) {
          if (rowPositions.has(cell.row)) continue;
          const yMm =
            cell.contentHeightMm > 0
              ? cell.contentYMm + (pos / 100) * cell.contentHeightMm
              : cell.cellYMm + (pos / 100) * cell.cellHeightMm;
          rowPositions.set(cell.row, yMm);
        }
      } else {
        for (let r = 0; r < metrics.rows; r++) {
          const yMm =
            config.marginsMm.top +
            r * (metrics.cellHeightMm + Math.max(0, config.verticalGutterMm)) +
            (pos / 100) * metrics.cellHeightMm;
          rowPositions.set(r, yMm);
        }
      }
      Array.from(rowPositions.entries())
        .sort((a, b) => a[0] - b[0])
        .forEach(([rowIdx, yMm]) => {
          const centerPercent = clamp((yMm / metrics.sheetHeightMm) * 100, 0, 100);
          overlays.push(
            makeLineShapeOverlay({
              id: `ticket-guide-${guide.id}-row-${rowIdx}`,
              target: 'sheet',
              orientation: 'horizontal',
              xPercent: 0,
              yPercent: centerPercent - boxH / 2,
              widthPercent: 100,
              heightPercent: boxH,
              strokeColor: guide.strokeColor,
              strokeStyle: guide.strokeStyle,
              strokeWidth: guide.strokeWidth,
            })
          );
        });
    }
  }

  // 3. Number slots on every ticket (on top so selectable first)
  config.numberSlots.forEach((slot, idx) => {
    overlays.push(buildNumberingOverlayForSlot(slot, config, idx));
  });

  return overlays;
}

export function createBlankTicketSource(
  cellWidthMm: number,
  cellHeightMm: number,
  isFa = true
): { document: SourceDocument; page: PageItem } {
  const safeW = Math.max(10, Math.round(cellWidthMm * 10) / 10);
  const safeH = Math.max(10, Math.round(cellHeightMm * 10) / 10);
  const docId = `ticket-blank-doc-${Date.now()}`;
  const docName = isFa ? 'فرم خام قبض' : 'Blank Receipt Form';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(safeW * 4)}" height="${Math.round(safeH * 4)}" viewBox="0 0 ${safeW} ${safeH}">
    <rect x="0" y="0" width="${safeW}" height="${safeH}" fill="#ffffff"/>
    <rect x="1.5" y="1.5" width="${Math.max(2, safeW - 3)}" height="${Math.max(2, safeH - 3)}" fill="none" stroke="#cbd5e1" stroke-width="0.4"/>
  </svg>`;
  const thumbnailDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

  const document: SourceDocument = {
    id: docId,
    name: docName,
    filePath: docName,
    fileSize: 0,
    fileType: 'pdf',
    mimeType: 'application/pdf',
    pageCount: 1,
    createdAt: new Date().toISOString(),
  };

  const page: PageItem = {
    id: `ticket-blank-page-${docId}`,
    documentId: docId,
    documentName: docName,
    sourcePageNumber: 0,
    widthMm: safeW,
    heightMm: safeH,
    rotation: 0,
    selectedForPrint: true,
    isHighlighted: true,
    isBlankPage: true,
    colorProfile: 'blank',
    inkCoveragePercent: 0,
    thumbnailDataUrl,
  };

  return { document, page };
}

/**
 * Generates `totalTickets` page items from `sourcePage` without duplicating raw binary buffers,
 * ready to be imposed into physical sheets in Studio.
 */
export function generateTicketPages(
  sourcePage: PageItem,
  totalTickets: number
): PageItem[] {
  const safeCount = Math.round(clamp(totalTickets, 1, MAX_TICKET_COUNT));
  const stamp = Date.now().toString(36);
  const baseOverrides = sourcePage.overrides ? structuredClone(sourcePage.overrides) : undefined;
  const baseErase = sourcePage.erase ? structuredClone(sourcePage.erase) : undefined;

  const pages: PageItem[] = new Array(safeCount);
  for (let i = 0; i < safeCount; i++) {
    pages[i] = {
      ...sourcePage,
      id: `ticket-${stamp}-${i + 1}`,
      selectedForPrint: true,
      isHighlighted: i === 0,
      ...(baseOverrides ? { overrides: structuredClone(baseOverrides) } : { overrides: undefined }),
      ...(baseErase ? { erase: structuredClone(baseErase) } : { erase: undefined }),
    };
  }
  return pages;
}
