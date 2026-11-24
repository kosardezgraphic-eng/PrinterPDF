/// <reference types="vite/client" />
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' { export const WorkerMessageHandler: unknown; }
declare module 'pako' {
  export function deflate(data: Uint8Array, options?: { level?: number }): Uint8Array;
}
