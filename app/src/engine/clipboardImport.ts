/**
 * PrintStudio Pro — Clipboard Image Import Helper
 * Supports Electron native clipboard images, Web Clipboard API (`navigator.clipboard.read()`),
 * and standard `paste` ClipboardEvent (`clipboardData.files` + `clipboardData.items`).
 */

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/x-ms-bmp': 'bmp',
  'image/tiff': 'tif',
  'image/svg+xml': 'svg',
};

const SUPPORTED_PASTE_EXT_RE = /\.(pdf|png|jpe?g|webp|gif|bmp|tiff?|svg)$/i;
const PREFERRED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/bmp',
  'image/gif',
  'image/svg+xml',
];

export function extensionForImageMime(mimeType: string): string {
  const normalized = (mimeType || '').split(';')[0].trim().toLowerCase();
  return MIME_TO_EXT[normalized] ?? 'png';
}

function isSupportedClipboardFile(file: File): boolean {
  const type = (file.type || '').toLowerCase();
  if (type.startsWith('image/') || type === 'application/pdf') return true;
  return SUPPORTED_PASTE_EXT_RE.test(file.name || '');
}

function normalizeClipboardFile(file: File, index: number, stamp: number): File {
  const rawName = (file.name || '').trim();
  const isGeneric = !rawName || /^image(\.[a-z0-9]+)?$/i.test(rawName);
  if (!isGeneric) return file;

  const mime = file.type || 'image/png';
  const ext = extensionForImageMime(mime);
  const name = `clipboard-image-${stamp}-${index + 1}.${ext}`;
  try {
    return new File([file], name, {
      type: mime,
      lastModified: file.lastModified || stamp,
    });
  } catch {
    return file;
  }
}

/**
 * Extracts pasted images (and Explorer-copied PDFs) from a `ClipboardEvent.clipboardData`
 * checking both `.files` and `.items` because Windows screenshots/browser image copies
 * often populate `.items` even when `.files` is empty.
 */
export function extractFilesFromClipboardData(
  dataTransfer: DataTransfer | null | undefined
): File[] {
  if (!dataTransfer) return [];
  const collected: File[] = [];
  const seen = new Set<string>();
  const stamp = Date.now();

  const pushUnique = (rawFile: File | null | undefined) => {
    if (!rawFile || !isSupportedClipboardFile(rawFile)) return;
    const file = normalizeClipboardFile(rawFile, collected.length, stamp);
    const sig = `${rawFile.name}|${rawFile.size}|${rawFile.type}`;
    // Note: multiple distinct screenshots pasted sequentially get unique sizes/bytes; only dedupe duplicates within the same paste event.
    if (rawFile.name && seen.has(sig) && dataTransfer.files?.length && dataTransfer.items?.length) {
      return;
    }
    seen.add(sig);
    collected.push(file);
  };

  if (dataTransfer.files) {
    for (const f of Array.from(dataTransfer.files)) {
      pushUnique(f);
    }
  }

  if (dataTransfer.items) {
    for (const item of Array.from(dataTransfer.items)) {
      if (item.kind !== 'file') continue;
      const f = item.getAsFile();
      if (!f) continue;
      const alreadyCaptured = collected.some(
        (existing) => existing.size === f.size && existing.type === f.type && (existing.name === f.name || f.name === 'image.png')
      );
      if (!alreadyCaptured) {
        pushUnique(f);
      }
    }
  }

  return collected;
}

export interface ClipboardReadResult {
  files: File[];
  status: 'ok' | 'empty' | 'permission-denied' | 'unsupported';
  errorMessage?: string;
}

/**
 * Reads image(s) directly from the OS clipboard when the user clicks a "Paste from Clipboard"
 * button: tries Electron native clipboard first when available, then the Web Clipboard API.
 */
export async function readImagesFromSystemClipboard(): Promise<ClipboardReadResult> {
  const stamp = Date.now();

  // 1. Electron native bridge (reliable even without focus/permissions prompts)
  if (typeof window !== 'undefined' && window.printStudioAPI?.readClipboardImage) {
    try {
      const payload = await window.printStudioAPI.readClipboardImage();
      if (payload && payload.bytes && payload.bytes.length > 0) {
        const copy = new Uint8Array(payload.bytes.length);
        copy.set(payload.bytes);
        const file = new File([copy], payload.name || `clipboard-image-${stamp}.png`, {
          type: payload.mimeType || 'image/png',
          lastModified: stamp,
        });
        return { files: [file], status: 'ok' };
      }
    } catch {
      // Fall through to standard Web Clipboard API
    }
  }

  // 2. Web Clipboard API
  if (typeof navigator === 'undefined' || !navigator.clipboard || typeof navigator.clipboard.read !== 'function') {
    return { files: [], status: 'unsupported' };
  }

  try {
    const items = await navigator.clipboard.read();
    const files: File[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const types = Array.isArray(item.types) ? item.types : [];
      const chosenType =
        PREFERRED_IMAGE_TYPES.find((preferred) => types.includes(preferred)) ??
        types.find((t) => t.toLowerCase().startsWith('image/'));

      if (!chosenType) continue;
      const blob = await item.getType(chosenType);
      if (!blob || blob.size === 0) continue;

      const ext = extensionForImageMime(chosenType);
      const file = new File([blob], `clipboard-image-${stamp}-${files.length + 1}.${ext}`, {
        type: chosenType,
        lastModified: stamp,
      });
      files.push(file);
    }

    if (files.length === 0) {
      return { files: [], status: 'empty' };
    }
    return { files, status: 'ok' };
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    const message = err instanceof Error ? err.message : String(err ?? '');
    if (name === 'NotAllowedError' || name === 'SecurityError' || /permission|denied|not allowed/i.test(message)) {
      return { files: [], status: 'permission-denied', errorMessage: message };
    }
    return { files: [], status: 'empty', errorMessage: message };
  }
}
