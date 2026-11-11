/**
 * Picture memory benchmark — `npx vite-node scripts/picture-memory-benchmark.ts [count]`
 *
 * Answers one question with numbers: what does a sheet full of large photographs cost, in the
 * project state and in the exported PDF? The state cost is unavoidable (a `PageOverlayImage.src` is
 * a data URL so the picture survives saving, undo and reload); the export cost is not, because
 * pdf-lib only needs one copy of identical bytes. Run with ELECTRON-free Node, no browser needed.
 */
import { createCanvas } from '@napi-rs/canvas';
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { DEFAULT_EFFECTS, DEFAULT_LAYOUT } from '../app/src/store/useAppStore';
import { exportImposedPdf } from '../app/src/engine/pdfService';
import { getDefaultPageNumberSettings, getDefaultWatermarkSettings } from '../app/src/engine/watermarkEngine';
import type { LayoutSettings, PageItem, PageOverlayImage, SourceDocument } from '@shared/models';

const MM_TO_PT = 72 / 25.4;
const count = Number(process.argv[2] ?? 12);
const widthPx = Number(process.argv[3] ?? 2400);
const heightPx = Number(process.argv[4] ?? 1600);

function photograph(seed: number, transparent: boolean): string {
  const canvas = createCanvas(widthPx, heightPx);
  const ctx = canvas.getContext('2d');
  if (transparent) ctx.clearRect(0, 0, widthPx, heightPx);
  // Smooth gradients compress well; noise would only measure the encoder.
  for (let band = 0; band < 12; band++) {
    const gradient = ctx.createLinearGradient(0, band * 120, widthPx, heightPx - band * 80);
    gradient.addColorStop(0, `hsl(${(seed * 37 + band * 23) % 360} 70% ${30 + band * 4}%)`);
    gradient.addColorStop(1, `hsl(${(seed * 11 + band * 57) % 360} 60% ${70 - band * 3}%)`);
    ctx.fillStyle = gradient;
    ctx.fillRect((band * widthPx) / 14, 0, widthPx / 7, heightPx);
  }
  return transparent ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.9);
}

const layout: LayoutSettings = {
  ...DEFAULT_LAYOUT, paperSize: 'Custom', customWidthMm: 210, customHeightMm: 297, rows: 1, cols: 1,
  duplexMode: 'none', marginMode: 'custom', marginsMm: { top: 0, right: 0, bottom: 0, left: 0 },
  horizontalGutterMm: 0, verticalGutterMm: 0, autoRotateToFit: false, showCellBorders: false,
};
const page = (id: string, sourcePageNumber: number): PageItem => ({
  id, documentId: 'd', documentName: 'd', sourcePageNumber, widthMm: 210, heightMm: 297, rotation: 0,
  selectedForPrint: true, isHighlighted: true, isBlankPage: false, colorProfile: 'color', inkCoveragePercent: 0,
});

const overlay = (id: string, src: string, sizePercent: number): PageOverlayImage => ({
  id, kind: 'image', target: 'sheet', targetScope: 'all', targetPageIds: [], targetSheetIndex: 1,
  xPercent: 5, yPercent: 5, widthPercent: sizePercent, heightPercent: sizePercent * 0.66, opacity: 1, rotation: 0,
  src, name: `${id}.jpg`, naturalWidth: widthPx, naturalHeight: heightPx, fit: 'fill', lockAspect: true,
});

const rssMb = () => Math.round((process.memoryUsage().rss / 1024 / 1024) * 10) / 10;
const heapMb = () => Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 10) / 10;

async function measure(label: string, overlays: PageOverlayImage[], sourcePages: number) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < sourcePages; i++) doc.addPage([210 * MM_TO_PT, 297 * MM_TO_PT]);
  const documents = [{ id: 'd', fileType: 'pdf', rawBytes: await doc.save() } as SourceDocument];
  const pages = Array.from({ length: sourcePages }, (_, i) => page(`p${i + 1}`, i + 1));
  const before = { rss: rssMb(), heap: heapMb() };
  const started = Date.now();
  const bytes = await exportImposedPdf({
    documents, pages, allPages: pages, layout, effects: { ...DEFAULT_EFFECTS, enabled: false },
    watermark: { ...getDefaultWatermarkSettings(), enabled: false }, pageNumbering: { ...getDefaultPageNumberSettings(), enabled: false },
    overlays, userName: 'benchmark',
  });
  const pdf = await PDFDocument.load(bytes);
  // One picture drawn in ten places is ten names for one object, so identity is counted by ref
  // across the whole document: that is what decides how much the file actually grows.
  const seen = new Set<string>();
  let imageObjects = 0;
  let imageBytes = 0;
  let placements = 0;
  for (let i = 0; i < pdf.getPageCount(); i++) {
    const box = pdf.getPage(i).node.Resources()?.lookup(PDFName.of('XObject'), PDFDict);
    if (!box) continue;
    for (const key of box.keys()) {
      const ref = box!.lookup(key);
      const value = pdf.context.lookup(ref) as PDFRawStream | undefined;
      if (!value || String(value.dict?.get(PDFName.of('Subtype'))) !== '/Image') continue;
      placements++;
      const id = String(ref);
      if (seen.has(id)) continue;
      seen.add(id);
      imageObjects++;
      // Raw stored bytes: a DCTDecode stream is the JPEG itself and a FlateDecode one is already
      // compressed, so decoding either would measure the decoder rather than the file.
      imageBytes += value.contents?.length ?? 0;
    }
  }
  console.log(`${label}\n  wall ${((Date.now() - started) / 1000).toFixed(2)}s · rss ${before.rss}→${rssMb()} MB (+${(rssMb() - before.rss).toFixed(1)})` +
    ` · heap ${before.heap}→${heapMb()} MB · pdf ${(bytes.length / 1024 / 1024).toFixed(2)} MB` +
    ` · pictures drawn ${placements}, stored once ${imageObjects} (${(imageBytes / 1024 / 1024).toFixed(2)} MB)`);
  return bytes.length;
}

const sources = Array.from({ length: count }, (_, i) => photograph(i, i % 4 === 3));
const stateBytes = sources.reduce((total, src) => total + src.length, 0);
console.log(`\n${count} pictures at ${widthPx}×${heightPx}px`);
console.log(`  data URLs in the project state: ${(stateBytes / 1024 / 1024).toFixed(2)} MB total, ` +
  `${(stateBytes / count / 1024).toFixed(0)} KB each`);
console.log(`  one undo snapshot costs the same again; a project file is the same bytes on disk`);

await measure('each picture once, on a single sheet', sources.map((src, i) => overlay(`o${i}`, src, 60)), 1);
await measure('the same pictures at three sizes each (shared embeds)',
  sources.flatMap((src, i) => [overlay(`a${i}`, src, 30), overlay(`b${i}`, src, 45), overlay(`c${i}`, src, 60)]), 1);
await measure('one picture repeated 40 times on 20 sheets (1×1 imposition, 20 pages)',
  Array.from({ length: 20 }, (_, sheet) => sources.slice(0, 2).map(src => overlay(`r${sheet}`, src, 40))).flat(), 20);
