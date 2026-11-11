/**
 * PrintStudio Pro — native file entry points.
 *
 * In a browser, OS drag & drop is the whole story: the `File` objects a drop provides can be read
 * directly, and that is what the app does. Electron 32 removed `File.path`, so a sandboxed renderer
 * can no longer tell *where* a dropped or double-clicked file lives — which is the only way to open
 * the files Windows hands to the executable (`start PrintStudio.exe scan.png`, "Open with…", a
 * second instance launched from Explorer). Those paths used to be sent to the renderer by
 * `electron/main.ts` and silently dropped, because nothing listened. This module is the listener.
 */
import type { LocalFilePayload } from '@shared/ipc-channels';

export interface NativeFileBridge {
  readLocalFile(path: string): Promise<LocalFilePayload>;
  onCliOpenFiles?(callback: (paths: string[]) => void): () => void;
}

/** The preload bridge, or undefined in a browser and in unit tests without a stub. */
export function nativeBridge(): NativeFileBridge | undefined {
  return typeof window === 'undefined' ? undefined : (window as { printStudioAPI?: NativeFileBridge }).printStudioAPI;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff', svg: 'image/svg+xml',
};

export function mimeFromPath(path: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(path);
  return (match && MIME_BY_EXTENSION[match[1].toLowerCase()]) || 'application/octet-stream';
}

export function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/** Turns main-process file contents into the `File` shape the import pipeline already accepts. */
export function fileFromPayload(payload: LocalFilePayload): File {
  // `slice()` because the bytes may be a view into a larger pool buffer.
  return new File([payload.bytes.slice().buffer as ArrayBuffer], payload.name, { type: payload.mimeType });
}

/** Reads files given as paths only; throws when there is no desktop bridge to read them with. */
export async function filesFromPaths(paths: string[]): Promise<File[]> {
  const bridge = nativeBridge();
  if (!bridge?.readLocalFile) throw new Error('Opening a file by path needs the desktop app');
  const payloads = await Promise.all(paths.map(path => bridge.readLocalFile(path)));
  return payloads.map(fileFromPayload);
}

/**
 * Subscribes to files the OS passed on the command line. Returns an unsubscribe function and does
 * nothing at all in a browser, so callers never need to know which shell they are in.
 */
export function listenForNativeOpenFiles(
  onFiles: (files: File[]) => void | Promise<void>,
  onError?: (error: unknown) => void,
): () => void {
  const bridge = nativeBridge();
  if (!bridge?.onCliOpenFiles) return () => {};
  return bridge.onCliOpenFiles(paths => {
    if (!paths.length) return;
    filesFromPaths(paths)
      .then(onFiles)
      .catch(error => {
        if (onError) onError(error);
        else console.error('Cannot open the file from the command line', error);
      });
  });
}
