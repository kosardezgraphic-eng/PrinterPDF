/**
 * PrintStudio Pro — Web Worker for Off-Thread PDF Parsing, Thumbnail Generation & Page Counting
 * Ensures 60fps UI responsiveness during heavy PDF imports.
 */

import { renderAndAnalyzePdfPages, vectorPreviewer } from './pdfRealRenderer';
import { sizeBucket } from './vectorPreview';

export interface PdfWorkerRequest {
  id: string;
  type: 'analyze-pdf';
  fileName: string;
  pdfBytes: Uint8Array;
}

/**
 * Crisp sheet-preview traffic on the same worker: `open` parses the file once, `render` paints one
 * page at the size a cell asked for, `cancel` stops a render nobody is watching any more, and `close`
 * frees the parsed document when its file leaves the desk. `bytes` is posted without a transfer list,
 * because the copy in the store is the one export and printing read from.
 */
export interface PdfPreviewWorkerRequest {
  id: string;
  type: 'open-preview-document' | 'render-preview-page' | 'cancel-preview-page' | 'close-preview-document';
  docId: string;
  bytes?: Uint8Array;
  pageNumber?: number;
  width?: number;
  height?: number;
}

/**
 * `WorkerGlobalScope.postMessage(message, transfer)` is what a worker needs; the DOM lib in this
 * project only types the two `Window` overloads, so the transfer list goes through a narrow cast.
 */
const postToHost = (message: unknown, transfer?: Transferable[]): void =>
  (self as unknown as { postMessage: (message: unknown, options?: { transfer?: Transferable[] }) => void })
    .postMessage(message, transfer && transfer.length ? { transfer } : undefined);

/**
 * The preview side of the protocol. Nothing here decides how much work is in flight: the caller's
 * queue (in `vectorPreview.ts`) has already limited it to a couple of renders and cancelled what
 * stopped being looked at, so this handler only does the one page it was asked for and answers with
 * either the pixels or an error the cell falls back past.
 */
async function handlePreviewRequest(msg: PdfPreviewWorkerRequest): Promise<void> {
  const replyType = msg.type === 'render-preview-page' ? 'preview-page-result' : 'preview-ack';
  try {
    if (msg.type === 'open-preview-document') {
      if (!msg.bytes) throw new Error('open-preview-document needs the file bytes');
      const pageCount = await vectorPreviewer.open(msg.docId, msg.bytes);
      postToHost({ id: msg.id, type: replyType, pageCount });
      return;
    }
    if (msg.type === 'close-preview-document') {
      vectorPreviewer.close(msg.docId);
      postToHost({ id: msg.id, type: replyType });
      return;
    }
    if (msg.type === 'cancel-preview-page') {
      vectorPreviewer.cancel(msg.id);
      return;                                  // the waiting render itself answers with `canceled`
    }
    const pageNumber = msg.pageNumber ?? 0;
    const width = sizeBucket(msg.width ?? 0);
    const height = sizeBucket(msg.height ?? 0);
    if (!pageNumber || !width || !height) throw new Error('A preview render needs a page and a size');
    const result = await vectorPreviewer.render({ docId: msg.docId, pageNumber, width, height, taskId: msg.id });
    if (!result) {
      postToHost({ id: msg.id, type: 'preview-page-result', canceled: true });
      return;
    }
    const png = result.png;
    const bitmap = result.bitmap;
    // The pixels are moved, not copied: a second full-page buffer per render is exactly what makes a
    // preview heavy, and both ImageBitmap and ArrayBuffer are transferable for that reason.
    const transfer = bitmap ? [bitmap] : png ? [png.buffer as ArrayBuffer] : [];
    postToHost({ id: msg.id, type: 'preview-page-result', width: result.width, height: result.height, bitmap, png }, transfer);
  } catch (err) {
    postToHost({
      id: msg.id,
      type: 'preview-page-error',
      errorMessage: err instanceof Error ? err.message : String(err),
    });
  }
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
  self.addEventListener('message', async (event: MessageEvent<PdfWorkerRequest | PdfPreviewWorkerRequest>) => {
    const msg = event.data;
    if (!msg) return;
    if (msg.type !== 'analyze-pdf') {
      await handlePreviewRequest(msg);
      return;
    }

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
