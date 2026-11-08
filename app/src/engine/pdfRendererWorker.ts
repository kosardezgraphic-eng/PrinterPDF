/**
 * PrintStudio Pro — Web Worker for Off-Thread PDF Parsing, Thumbnail Generation & Page Counting
 * Ensures 60fps UI responsiveness during heavy PDF imports.
 */

import { renderAndAnalyzePdfPages } from './pdfRealRenderer';

export interface PdfWorkerRequest {
  id: string;
  type: 'analyze-pdf';
  fileName: string;
  pdfBytes: Uint8Array;
}

export interface PdfWorkerResponse {
  id: string;
  type: 'analyze-pdf-result' | 'analyze-pdf-progress' | 'analyze-pdf-error';
  pageNumber?: number;
  totalPages?: number;
  pages?: Awaited<ReturnType<typeof renderAndAnalyzePdfPages>>;
  errorMessage?: string;
}

if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
  self.addEventListener('message', async (event: MessageEvent<PdfWorkerRequest>) => {
    const msg = event.data;
    if (!msg || msg.type !== 'analyze-pdf') return;

    try {
      const pages = await renderAndAnalyzePdfPages(
        msg.pdfBytes,
        msg.fileName,
        (pageNumber, totalPages) => {
          const progressMsg: PdfWorkerResponse = {
            id: msg.id,
            type: 'analyze-pdf-progress',
            pageNumber,
            totalPages,
          };
          self.postMessage(progressMsg);
        }
      );

      const doneMsg: PdfWorkerResponse = {
        id: msg.id,
        type: 'analyze-pdf-result',
        pages,
      };
      self.postMessage(doneMsg);
    } catch (err) {
      const errorMsg: PdfWorkerResponse = {
        id: msg.id,
        type: 'analyze-pdf-error',
        errorMessage: err instanceof Error ? err.message : String(err),
      };
      self.postMessage(errorMsg);
    }
  });
}
