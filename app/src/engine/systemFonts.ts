import { useCallback, useEffect, useState } from 'react';
import { ipcBridge } from './ipcBridge';

export const BUNDLED_FONTS = ['Vazirmatn', 'Shabnam', 'Sahel'] as const;

const SYSTEM_FONT_PROBES = [
  'IRANSans',
  'IRANSansX',
  'IRANYekan',
  'B Nazanin',
  'B Titr',
  'B Mitra',
  'B Zar',
  'B Yekan',
  'Nazanin',
  'Titr',
  'Mitra',
  'Zar',
  'Yekan',
  'Nastaliq',
  'IranNastaliq',
  'Tahoma',
  'Segoe UI',
  'Arial',
  'Times New Roman',
  'Calibri',
  'Cambria',
  'Consolas',
  'Courier New',
  'Verdana',
  'Georgia',
  'DejaVu Sans',
  'Liberation Sans',
  'Noto Sans Arabic',
  'Noto Naskh Arabic',
] as const;

interface LocalFontFaceData {
  family?: string;
}

type LocalFontsWindow = Window & {
  queryLocalFonts?: () => Promise<LocalFontFaceData[]>;
};

let cachedDetectedSystemFonts: string[] = [];
let hasFetchedOnce = false;
let inflightLoad: Promise<string[]> | null = null;

function mergeSortedUniqueFonts(lists: Iterable<string>[]): string[] {
  const bundledLower = new Set(BUNDLED_FONTS.map((f) => f.toLowerCase()));
  const seen = new Map<string, string>();
  for (const list of lists) {
    for (const raw of list) {
      const cleaned = raw.trim().replace(/^["']|["']$/g, '');
      if (!cleaned || cleaned.startsWith('.')) continue;
      const lower = cleaned.toLowerCase();
      if (bundledLower.has(lower)) continue;
      if (!seen.has(lower)) {
        seen.set(lower, cleaned);
      }
    }
  }
  return Array.from(seen.values()).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  );
}

function probeDocumentFonts(): string[] {
  if (typeof document === 'undefined' || typeof document.fonts?.check !== 'function') {
    return [];
  }
  const detected: string[] = [];
  for (const font of SYSTEM_FONT_PROBES) {
    try {
      const safe = font.replace(/["\\]/g, '');
      if (
        document.fonts.check(`16px "${safe}"`, 'اآبپتA1') ||
        document.fonts.check(`16px "${safe}"`, 'ABC123')
      ) {
        detected.push(font);
      }
    } catch {
      // Ignore font check errors
    }
  }
  return detected;
}

async function queryBrowserLocalFonts(requestLocalAccess: boolean): Promise<string[]> {
  if (typeof window === 'undefined') return [];
  const win = window as LocalFontsWindow;
  if (typeof win.queryLocalFonts !== 'function') return [];
  if (!requestLocalAccess) {
    try {
      if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
        const perm = await navigator.permissions.query({
          name: 'local-fonts' as PermissionName,
        });
        if (perm.state !== 'granted') return [];
      } else {
        return [];
      }
    } catch {
      return [];
    }
  }
  try {
    const entries = await win.queryLocalFonts();
    return entries
      .map((entry) => entry.family ?? '')
      .filter((name) => name.trim().length > 0);
  } catch {
    return [];
  }
}

export function resetSystemFontsCacheForTest(): void {
  cachedDetectedSystemFonts = [];
  hasFetchedOnce = false;
  inflightLoad = null;
}

/**
 * Discovers installed system fonts from:
 * 1. Electron IPC / host HTTP `/api/system-fonts` OS enumeration
 * 2. Browser Local Font Access API (`window.queryLocalFonts`, when granted or user-triggered)
 * 3. `document.fonts.check` probing for common Persian & Latin desktop fonts
 */
export async function loadSystemFonts(
  forceRefresh = false,
  requestLocalAccess = false
): Promise<string[]> {
  if (!forceRefresh && !requestLocalAccess && hasFetchedOnce) {
    return [...cachedDetectedSystemFonts];
  }
  if (!forceRefresh && !requestLocalAccess && inflightLoad) {
    return inflightLoad;
  }

  const run = (async () => {
    const [osFonts, localApiFonts] = await Promise.all([
      ipcBridge.listSystemFonts(forceRefresh).catch(() => []),
      queryBrowserLocalFonts(requestLocalAccess),
    ]);
    const probed = probeDocumentFonts();
    const merged = mergeSortedUniqueFonts([
      cachedDetectedSystemFonts,
      osFonts,
      localApiFonts,
      probed,
    ]);
    cachedDetectedSystemFonts = merged;
    hasFetchedOnce = true;
    return [...merged];
  })();

  if (!forceRefresh && !requestLocalAccess) {
    inflightLoad = run;
    try {
      return await run;
    } finally {
      inflightLoad = null;
    }
  }
  return run;
}

export function useSystemFonts(currentFont?: string): {
  bundledFonts: readonly string[];
  systemFonts: string[];
  isLoading: boolean;
  refreshSystemFonts: () => Promise<void>;
} {
  const [systemFonts, setSystemFonts] = useState<string[]>(() => cachedDetectedSystemFonts);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let active = true;
    void loadSystemFonts(false, false).then((fonts) => {
      if (active) setSystemFonts(fonts);
    });
    return () => {
      active = false;
    };
  }, []);

  const refreshSystemFonts = useCallback(async () => {
    setIsLoading(true);
    try {
      const fonts = await loadSystemFonts(true, true);
      setSystemFonts(fonts);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const bundledLower = new Set(BUNDLED_FONTS.map((f) => f.toLowerCase()));
  const trimmedCurrent = currentFont?.trim();
  const extraCurrent =
    trimmedCurrent &&
    !bundledLower.has(trimmedCurrent.toLowerCase()) &&
    !systemFonts.some((f) => f.toLowerCase() === trimmedCurrent.toLowerCase())
      ? [trimmedCurrent, ...systemFonts]
      : systemFonts;

  return {
    bundledFonts: BUNDLED_FONTS,
    systemFonts: extraCurrent,
    isLoading,
    refreshSystemFonts,
  };
}
