import { afterEach, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { importFilesBatch } from './pdfService';

afterEach(() => vi.unstubAllGlobals());

it('uses worker results rather than synthesizing PDF thumbnails and color data', async () => {
  const terminate = vi.fn();
  const postMessage = vi.fn(function(this: { onmessage: (e: unknown) => void }, payload: { id: string }) {
    queueMicrotask(() => this.onmessage({ data: { id: payload.id, type: 'analyze-pdf-result', pages: [{
      pageNumber: 1, widthMm: 70, heightMm: 90, rotation: 0, colorProfile: 'grayscale',
      inkCoveragePercent: 13, extractedTextLines: ['real content'], thumbnailDataUrl: 'data:image/png;base64,worker-output',
    }] } }));
  });
  vi.stubGlobal('Worker', class { onmessage = (_: unknown) => {}; onerror = null; onmessageerror = null; postMessage = postMessage; terminate = terminate; });
  const doc = await PDFDocument.create(); doc.addPage([200, 250]);
  const result = await importFilesBatch([new File([new Uint8Array(await doc.save())], 'worker.pdf', { type: 'application/pdf' })]);
  expect(postMessage).toHaveBeenCalledOnce();
  expect(terminate).toHaveBeenCalledOnce();
  expect(result.pages[0].thumbnailDataUrl).toBe('data:image/png;base64,worker-output');
  expect(result.pages[0].inkCoveragePercent).toBe(13);
});
