import { describe, expect, it } from 'vitest';
import { createDefaultTicketConfig, generateTicketPages, getTicketGridMetrics, ticketSequenceIndex } from './ticketNumbering';

describe('ticket numbering for cut stacks', () => {
  it('defaults to numbering each physical ticket position as its own stack', () => {
    const config = createDefaultTicketConfig();
    expect(config.orderingMode).toBe('cut-stack');
  });

  it('keeps consecutive sheets consecutive at the same physical position', () => {
    const config = {
      ...createDefaultTicketConfig(),
      rows: 2,
      cols: 2,
      quantityMode: 'tickets' as const,
      ticketCount: 2000,
      direction: 'rtl' as const,
    };
    expect(getTicketGridMetrics(config).ticketsPerSheet).toBe(4);
    // RTL means the upper-right position is first in the physical reading order.
    expect(ticketSequenceIndex(config, 0, 1, 0)).toBe(1);
    expect(ticketSequenceIndex(config, 0, 1, 1)).toBe(2);
    expect(ticketSequenceIndex(config, 0, 1, 1000)).toBe(1001);
    expect(ticketSequenceIndex(config, 0, 1, 1001)).toBe(1002);
  });

  it('keeps ordinary per-sheet numbering available when explicitly selected', () => {
    const config = {
      ...createDefaultTicketConfig(),
      rows: 2,
      cols: 2,
      orderingMode: 'per-sheet' as const,
      direction: 'rtl' as const,
    };
    expect(ticketSequenceIndex(config, 0, 1, 0)).toBe(1);
    expect(ticketSequenceIndex(config, 0, 1, 1)).toBe(1);
    expect(ticketSequenceIndex(config, 1, 0, 1)).toBe(4);
  });
});


describe('ticket page memory sharing', () => {
  it('reuses immutable source metadata instead of deep-cloning it for every ticket', () => {
    const overrides = { crop: { top: 1, right: 2, bottom: 3, left: 4 } } as never;
    const erase = [{ id: 'erase-1', points: [] }] as never;
    const source = {
      id: 'source-page',
      documentId: 'source-document',
      documentName: 'receipt.pdf',
      sourcePageNumber: 0,
      widthMm: 210,
      heightMm: 297,
      rotation: 0,
      selectedForPrint: true,
      isHighlighted: true,
      overrides,
      erase,
    } as never;

    const pages = generateTicketPages(source, 2000);
    expect(pages).toHaveLength(2000);
    expect(pages[0].id).not.toBe(pages[1].id);
    expect(pages[0].overrides).toBe(overrides);
    expect(pages[1999].overrides).toBe(overrides);
    expect(pages[0].erase).toBe(erase);
    expect(pages[1999].erase).toBe(erase);
    expect(pages[0].isHighlighted).toBe(true);
    expect(pages[1].isHighlighted).toBe(false);
  });
});
