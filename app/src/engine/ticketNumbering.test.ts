// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildTicketStudioLayout,
  buildTicketStudioOverlays,
  createBlankTicketSource,
  createDefaultTicketConfig,
  generateTicketPages,
  getTicketGridMetrics,
  resolveTicketSlotText,
  ticketSequenceIndex,
} from './ticketNumbering';
import { computeImpositionSheets } from './layoutEngine';
import { textPlacements } from './textOverlays';
import { DEFAULT_LAYOUT } from '../store/useAppStore';

describe('ticketNumbering engine', () => {
  it('defaults to cut-stack ordering so stacked sheets remain consecutive after cutting', () => {
    const config = createDefaultTicketConfig();
    expect(config.orderingMode).toBe('cut-stack');
    expect(config.rows).toBe(3);
    expect(config.cols).toBe(1);
    expect(config.numberSlots.length).toBeGreaterThanOrEqual(2);
    expect(config.guideLines.length).toBeGreaterThanOrEqual(1);
  });

  it('assigns cut-stack sequence indices vertically down each cut pile across sheets (1001, 1002, ...)', () => {
    const config = {
      ...createDefaultTicketConfig(),
      rows: 2,
      cols: 2,
      direction: 'rtl' as const,
      orderingMode: 'cut-stack' as const,
      quantityMode: 'tickets' as const,
      ticketCount: 1000,
      startNumber: 1001,
      step: 1,
    };

    const metrics = getTicketGridMetrics(config);
    expect(metrics.effectiveSheetCount).toBe(250);
    expect(metrics.totalTickets).toBe(1000);

    // Top-right corner in RTL 2x2 is (row=0, col=1)
    expect(ticketSequenceIndex(config, 0, 1, 0)).toBe(1);   // Sheet 1 -> 1001
    expect(ticketSequenceIndex(config, 0, 1, 1)).toBe(2);   // Sheet 2 -> 1002
    expect(ticketSequenceIndex(config, 0, 1, 249)).toBe(250); // Sheet 250 -> 1250

    // Top-left corner in RTL 2x2 is (row=0, col=0), starts at 251 (serial 1251)
    expect(ticketSequenceIndex(config, 0, 0, 0)).toBe(251);
    expect(ticketSequenceIndex(config, 0, 0, 1)).toBe(252);

    const slot = config.numberSlots[0];
    expect(resolveTicketSlotText(slot, ticketSequenceIndex(config, 0, 1, 0), metrics.totalTickets, config)).toBe('شماره 1001');
    expect(resolveTicketSlotText(slot, ticketSequenceIndex(config, 0, 1, 1), metrics.totalTickets, config)).toBe('شماره 1002');
  });

  it('supports per-sheet consecutive ordering as an alternative mode', () => {
    const config = {
      ...createDefaultTicketConfig(),
      rows: 2,
      cols: 2,
      direction: 'rtl' as const,
      orderingMode: 'per-sheet' as const,
      quantityMode: 'sheets' as const,
      sheetCount: 3,
      startNumber: 1001,
    };

    expect(ticketSequenceIndex(config, 0, 1, 0)).toBe(1);
    expect(ticketSequenceIndex(config, 0, 0, 0)).toBe(2);
    expect(ticketSequenceIndex(config, 1, 1, 0)).toBe(3);
    expect(ticketSequenceIndex(config, 1, 0, 0)).toBe(4);
    expect(ticketSequenceIndex(config, 0, 1, 1)).toBe(5);
  });

  it('matches Studio imposition + textPlacements for cut-stack across sheets', () => {
    const config = {
      ...createDefaultTicketConfig(),
      rows: 2,
      cols: 2,
      direction: 'rtl' as const,
      orderingMode: 'cut-stack' as const,
      quantityMode: 'sheets' as const,
      sheetCount: 3,
      startNumber: 1001,
      numberSlots: [{ ...createDefaultTicketConfig().numberSlots[0], template: '{serial}' }],
    };
    const metrics = getTicketGridMetrics(config);
    const blank = createBlankTicketSource(metrics.cellWidthMm, metrics.cellHeightMm, true);
    const pages = generateTicketPages(blank.page, metrics.totalTickets);
    const studioLayout = buildTicketStudioLayout(DEFAULT_LAYOUT, config);
    const overlays = buildTicketStudioOverlays(config, studioLayout, pages);
    const sheets = computeImpositionSheets(pages, studioLayout);

    expect(sheets).toHaveLength(3);
    const sheet1Texts = textPlacements(sheets[0], sheets.length, pages, overlays).map((p) => p.renderText.text);
    const sheet2Texts = textPlacements(sheets[1], sheets.length, pages, overlays).map((p) => p.renderText.text);
    // In RTL, cell 0 is top-right: Sheet 1 gets 1001, Sheet 2 gets 1002
    expect(sheet1Texts[0]).toBe('1001');
    expect(sheet2Texts[0]).toBe('1002');
    expect(overlays.some((o) => o.kind === 'shape' && o.type === 'line')).toBe(true);
  });

  it('shares immutable overrides/erase references when generating large ticket counts', () => {
    const blank = createBlankTicketSource(100, 90, true);
    const sourceWithMeta = {
      ...blank.page,
      overrides: { cropBoxMm: { top: 1, right: 1, bottom: 1, left: 1 } },
      erase: [{ mode: 'region' as const, x: 1, y: 1, width: 5, height: 5 }],
    };
    const pages = generateTicketPages(sourceWithMeta, 500);
    expect(pages).toHaveLength(500);
    expect(pages[0].overrides).toBe(sourceWithMeta.overrides);
    expect(pages[499].overrides).toBe(sourceWithMeta.overrides);
    expect(pages[0].erase).toBe(sourceWithMeta.erase);
    expect(pages[0].id).not.toBe(pages[1].id);
  });
});
