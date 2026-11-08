import type { ComputedSheetSide, EffectsSettings, PageItem, SourceDocument } from '@shared/models';

export type PreflightIssue = { code: 'no-pages' | 'missing-source' | 'empty-page' | 'out-of-bounds' | 'effects-not-exported'; severity: 'error' | 'warning'; count: number };

/** Static preflight only; it cannot validate a physical printer or driver. */
export function checkPreflight(pages: PageItem[], documents: SourceDocument[], sheets: ComputedSheetSide[], effects: EffectsSettings): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  const selected = pages.filter(page => page.selectedForPrint);
  if (!selected.length) issues.push({ code: 'no-pages', severity: 'error', count: 0 });
  const docs = new Map(documents.map(doc => [doc.id, doc]));
  const missing = selected.filter(page => page.sourcePageNumber > 0 && !docs.get(page.documentId)?.rawBytes).length;
  if (missing) issues.push({ code: 'missing-source', severity: 'error', count: missing });
  const blank = selected.filter(page => page.isBlankPage).length;
  if (blank) issues.push({ code: 'empty-page', severity: 'warning', count: blank });
  const out = sheets.filter(sheet => sheet.cells.some(cell => cell.cellXMm < 0 || cell.cellYMm < 0 ||
    cell.cellXMm + cell.cellWidthMm > sheet.widthMm + 0.01 || cell.cellYMm + cell.cellHeightMm > sheet.heightMm + 0.01)).length;
  if (out) issues.push({ code: 'out-of-bounds', severity: 'warning', count: out });
  if (effects.enabled && (effects.grayscale || effects.blackAndWhite || effects.blackText || effects.brightness !== 0 ||
    effects.contrast !== 0 || effects.gamma !== 1 || effects.sharpness !== 0)) {
    issues.push({ code: 'effects-not-exported', severity: 'warning', count: 0 });
  }
  return issues;
}
