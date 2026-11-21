import { execFile } from 'node:child_process';

let cachedSystemFonts: string[] | null = null;

function execFileText(
  command: string,
  args: string[],
  timeoutMs = 8000
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(typeof stdout === 'string' ? stdout : String(stdout ?? ''));
      }
    );
  });
}

function normalizeFontNames(rawNames: string[]): string[] {
  const seen = new Map<string, string>();
  for (const raw of rawNames) {
    for (const part of raw.split(',')) {
      const cleaned = part.trim().replace(/^["']|["']$/g, '');
      if (!cleaned || cleaned.startsWith('.')) continue;
      const key = cleaned.toLowerCase();
      if (!seen.has(key)) {
        seen.set(key, cleaned);
      }
    }
  }
  return Array.from(seen.values()).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  );
}

async function queryWindowsSystemFonts(): Promise<string[]> {
  const script =
    'Add-Type -AssemblyName System.Drawing; ' +
    '(New-Object System.Drawing.Text.InstalledFontCollection).Families | ' +
    'ForEach-Object { $_.Name }';
  const stdout = await execFileText('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script,
  ]);
  return normalizeFontNames(stdout.split(/\r?\n/));
}

async function queryFcListFonts(): Promise<string[]> {
  const stdout = await execFileText('fc-list', [':', 'family']);
  return normalizeFontNames(stdout.split(/\r?\n/));
}

async function queryDarwinFonts(): Promise<string[]> {
  try {
    const viaFc = await queryFcListFonts();
    if (viaFc.length > 0) return viaFc;
  } catch {
    // Fall back to system_profiler on macOS when fontconfig is absent
  }
  const stdout = await execFileText(
    'system_profiler',
    ['SPFontsDataType', '-json'],
    12000
  );
  const parsed = JSON.parse(stdout) as {
    SPFontsDataType?: Array<{
      family?: string;
      _name?: string;
      typefaces?: Array<{ family?: string }>;
    }>;
  };
  const names: string[] = [];
  for (const font of parsed.SPFontsDataType ?? []) {
    if (font.family) names.push(font.family);
    for (const face of font.typefaces ?? []) {
      if (face.family) names.push(face.family);
    }
  }
  return normalizeFontNames(names);
}

/**
 * Enumerates font families actually installed on the host operating system.
 * Results are cached for the process lifetime unless `forceRefresh` is true.
 */
export async function listInstalledSystemFonts(
  forceRefresh = false
): Promise<string[]> {
  if (!forceRefresh && cachedSystemFonts) {
    return [...cachedSystemFonts];
  }

  let fonts: string[] = [];
  try {
    if (process.platform === 'win32') {
      fonts = await queryWindowsSystemFonts();
    } else if (process.platform === 'darwin') {
      fonts = await queryDarwinFonts();
    } else {
      fonts = await queryFcListFonts();
    }
  } catch {
    fonts = [];
  }

  if (fonts.length > 0) {
    cachedSystemFonts = fonts;
  }
  return [...fonts];
}
