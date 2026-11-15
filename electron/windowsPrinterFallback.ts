import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  DuplexMode,
  PaperSizeId,
  PrinterInfo,
  PrinterMarginRequest,
  PrinterMarginResult,
  PrinterPaperOption,
  PrinterProfileSettings,
  PrinterStatus,
  PrintJobRequest,
  SpoolerJobInfo,
  SpoolerJobStatus,
} from '../shared/models';
import { STANDARD_PAPER_SIZES, sanitizeDriverText } from '../shared/models';

export { sanitizeDriverText };

const execFileAsync = promisify(execFile);

export interface ElectronNativePrinter {
  name: string;
  displayName?: string;
  description?: string;
  status?: number;
  isDefault?: boolean;
  options?: {
    'printer-location'?: string;
    'printer-make-and-model'?: string;
    [key: string]: unknown;
  } | object;
}

interface RawWin32Paper {
  Name?: string;
  WidthMm?: number;
  HeightMm?: number;
  RawKind?: number;
}

interface RawWin32Printer {
  Name?: string;
  DriverName?: string;
  PortName?: string;
  Default?: boolean;
  Network?: boolean;
  Location?: string;
  WorkOffline?: boolean;
  PrinterStatus?: number;
  DetectedErrorState?: number;
  JobCount?: number;
  SupportsColor?: boolean;
  SupportsDuplex?: boolean;
  MaxCopies?: number;
  PaperSizes?: RawWin32Paper[];
  PaperNames?: string[];
  Trays?: string[];
  MediaTypes?: string[];
  Resolutions?: number[];
  StapleModes?: string[];
  HolePunchModes?: string[];
  FoldModes?: string[];
  OutputBins?: string[];
  SupportsCollate?: boolean;
  SupportsBorderless?: boolean;
  DefaultPaperName?: string;
  DefaultPaperWidthMm?: number;
  DefaultPaperHeightMm?: number;
  DefaultTray?: string;
  DefaultLandscape?: boolean;
  DefaultColor?: boolean;
  DefaultDpi?: number;
  DefaultDuplex?: string;
  DefaultMediaType?: string;
  DefaultQuality?: string;
  DefaultCollate?: boolean;
  DefaultStaple?: string;
  DefaultHolePunch?: string;
  DefaultFold?: string;
  DefaultOutputBin?: string;
  DefaultBorderless?: boolean;
}

interface RawWin32PrintJob {
  JobId?: number;
  Name?: string;
  Document?: string;
  Owner?: string;
  Status?: string;
  TotalPages?: number;
  PagesPrinted?: number;
  Size?: number;
  Priority?: number;
  TimeSubmitted?: string;
}

const KNOWN_PAPER_IDS: Array<Exclude<PaperSizeId, 'Custom'>> = [
  'A0',
  'A1',
  'A2',
  'A3',
  'A4',
  'A5',
  'A6',
  'B4',
  'B5',
  'Letter',
  'Legal',
];

export function isVirtualPrinterName(name: string): boolean {
  return /pdf|printstudio|xps|virtual|onenote|fax/i.test(name);
}

/**
 * Matches a Windows paper name or physical mm dimensions against standard PaperSizeIds.
 * Uses physical dimensions first so driver aliases like "ISO A4" or "8.5x11" map reliably.
 */
export function matchStandardPaperId(
  widthMm?: number,
  heightMm?: number,
  rawName?: string
): PaperSizeId {
  if (
    typeof widthMm === 'number' &&
    typeof heightMm === 'number' &&
    Number.isFinite(widthMm) &&
    Number.isFinite(heightMm) &&
    widthMm > 10 &&
    heightMm > 10
  ) {
    const shortSide = Math.min(widthMm, heightMm);
    const longSide = Math.max(widthMm, heightMm);
    for (const id of KNOWN_PAPER_IDS) {
      const std = STANDARD_PAPER_SIZES[id];
      const stdShort = Math.min(std.widthMm, std.heightMm);
      const stdLong = Math.max(std.widthMm, std.heightMm);
      if (Math.abs(shortSide - stdShort) <= 2.2 && Math.abs(longSide - stdLong) <= 2.2) {
        return id;
      }
    }
  }

  if (rawName) {
    const clean = rawName.trim();
    const named = KNOWN_PAPER_IDS.find((id) => new RegExp(`\\b${id}\\b`, 'i').test(clean));
    if (named) return named;
  }

  return 'Custom';
}

function normalizeStringList(items?: unknown[], fallback: string[] = []): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items ?? []) {
    const clean = typeof raw === 'string' ? sanitizeDriverText(raw) : '';
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(clean);
    }
  }
  return out.length > 0 ? out : fallback;
}

function buildPaperOptions(raw: RawWin32Printer): PrinterPaperOption[] {
  const options: PrinterPaperOption[] = [];
  const seen = new Set<string>();

  for (const item of raw.PaperSizes ?? []) {
    const name = sanitizeDriverText(item.Name);
    const widthMm = Number(item.WidthMm);
    const heightMm = Number(item.HeightMm);
    if (!name || !Number.isFinite(widthMm) || !Number.isFinite(heightMm) || widthMm <= 0 || heightMm <= 0) {
      continue;
    }
    const id = matchStandardPaperId(widthMm, heightMm, name);
    const key = `${name.toLowerCase()}|${Math.round(widthMm)}x${Math.round(heightMm)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({
      id,
      name,
      widthMm: Math.round(widthMm * 10) / 10,
      heightMm: Math.round(heightMm * 10) / 10,
      ...(typeof item.RawKind === 'number' && item.RawKind > 0 ? { rawKind: item.RawKind } : {}),
    });
  }

  if (options.length === 0 && raw.PaperNames?.length) {
    for (const rawName of raw.PaperNames) {
      const clean = sanitizeDriverText(rawName);
      if (!clean) continue;
      const id = matchStandardPaperId(undefined, undefined, clean);
      const dims = id !== 'Custom' ? STANDARD_PAPER_SIZES[id] : { widthMm: 210, heightMm: 297 };
      const key = clean.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      options.push({
        id,
        name: clean,
        widthMm: dims.widthMm,
        heightMm: dims.heightMm,
      });
    }
  }

  return options;
}

function mapPaperIdsFromOptions(options: PrinterPaperOption[], names?: string[]): PaperSizeId[] {
  const mapped: PaperSizeId[] = [];
  for (const opt of options) {
    if (!mapped.includes(opt.id)) mapped.push(opt.id);
  }
  if (mapped.length === 0 && names?.length) {
    for (const raw of names) {
      const match = matchStandardPaperId(undefined, undefined, raw);
      if (!mapped.includes(match)) mapped.push(match);
    }
  }
  return mapped.length > 0 ? mapped : ['A4', 'Letter', 'Custom'];
}

function mapWin32Duplex(rawDuplex?: string, supportsDuplex?: boolean): DuplexMode {
  if (!supportsDuplex) return 'none';
  const s = (rawDuplex ?? '').toLowerCase();
  if (s.includes('horizontal')) return 'short-edge';
  if (s.includes('vertical')) return 'long-edge';
  if (s.includes('simplex')) return 'none';
  return 'none';
}

function mapWin32Quality(rawQuality?: string): 'draft' | 'normal' | 'high' {
  const q = (rawQuality ?? '').toLowerCase();
  if (q.includes('draft') || q.includes('fast') || q.includes('eco')) return 'draft';
  if (q.includes('high') || q.includes('photo') || q.includes('best') || q.includes('fine')) return 'high';
  return 'normal';
}

function mapWin32PrinterStatus(raw: RawWin32Printer): PrinterStatus {
  if (raw.WorkOffline) return 'Offline';
  switch (raw.DetectedErrorState) {
    case 4:
      return 'OutOfPaper';
    case 5:
    case 6:
      return 'LowToner';
    case 7:
      return 'DoorOpen';
    case 8:
      return 'PaperJam';
    case 9:
      return 'Offline';
    default:
      break;
  }
  switch (raw.PrinterStatus) {
    case 1:
      return 'Paused';
    case 2:
      return 'Error';
    case 4:
      return 'Printing';
    case 7:
      return 'Offline';
    default:
      return 'Ready';
  }
}

function mapElectronStatus(status?: number): PrinterStatus {
  if (!status) return 'Ready';
  if ((status & 0x00000080) !== 0) return 'Offline';
  if ((status & 0x00000002) !== 0) return 'Error';
  if ((status & 0x00000008) !== 0) return 'PaperJam';
  if ((status & 0x00000010) !== 0) return 'OutOfPaper';
  if ((status & 0x00000001) !== 0) return 'Paused';
  if ((status & 0x00000400) !== 0) return 'Printing';
  return 'Ready';
}

function mapWin32JobStatus(status?: string): SpoolerJobStatus {
  const s = (status ?? '').toLowerCase();
  if (s.includes('error')) return 'Error';
  if (s.includes('paused')) return 'Paused';
  if (s.includes('printing')) return 'Printing';
  if (s.includes('deleting') || s.includes('deleted')) return 'Canceled';
  if (s.includes('printed') || s.includes('complete')) return 'Completed';
  return 'Spooling';
}

function parseJsonSafe<T>(stdout: string): T | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  const startArr = trimmed.indexOf('[');
  const startObj = trimmed.indexOf('{');
  const idx =
    startArr !== -1 && startObj !== -1
      ? Math.min(startArr, startObj)
      : Math.max(startArr, startObj);
  const jsonText = idx >= 0 ? trimmed.slice(idx) : trimmed;
  return JSON.parse(jsonText) as T;
}

/**
 * Queries real Windows printers, ALL paper sizes + mm dimensions, ALL paper trays/bins,
 * DPIs, duplex, color, media types, finishing options, and live DefaultPageSettings/UserPrintTicket.
 * Returns [] immediately on non-Windows platforms.
 */
export async function queryWindowsPrintersViaPowerShell(): Promise<PrinterInfo[]> {
  if (process.platform !== 'win32') return [];

  const psScript = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    'Add-Type -AssemblyName System.Drawing',
    '$hasSysPrint = $false',
    'try { Add-Type -AssemblyName System.Printing; Add-Type -AssemblyName ReachFramework; $hasSysPrint = $true } catch {}',
    '$queueMap = @{}',
    'if ($hasSysPrint) {',
    '  try {',
    '    $lps = New-Object System.Printing.LocalPrintServer',
    '    $flags = @([System.Printing.EnumeratedPrintQueueTypes]::Local, [System.Printing.EnumeratedPrintQueueTypes]::Connections)',
    '    foreach ($q in @($lps.GetPrintQueues($flags))) {',
    '      try { $queueMap[$q.FullName] = $q } catch {}',
    '    }',
    '  } catch {}',
    '}',
    '$printers = Get-CimInstance -ClassName Win32_Printer',
    'if (-not $printers) { $printers = Get-WmiObject -Class Win32_Printer }',
    '$out = foreach ($p in @($printers)) {',
    '  $ps = New-Object System.Drawing.Printing.PrinterSettings',
    '  $ps.PrinterName = $p.Name',
    '  $papers = @(); $trays = @(); $dpi = @()',
    '  $defPaperName = ""; $defW = 0.0; $defH = 0.0; $defTray = ""; $defLand = $false; $defColor = $true; $defDpi = 0; $defDuplex = "Simplex"; $maxCopies = 999',
    '  if ($ps.IsValid) {',
    '    $maxCopies = if ($ps.MaximumCopies -gt 0) { [Math]::Min(999, [int]$ps.MaximumCopies) } else { 999 }',
    '    $papers = @($ps.PaperSizes | ForEach-Object {',
    '      if ($_.Width -gt 0 -and $_.Height -gt 0 -and $_.PaperName) {',
    '        [PSCustomObject]@{ Name = [string]$_.PaperName; WidthMm = [Math]::Round($_.Width * 0.254, 1); HeightMm = [Math]::Round($_.Height * 0.254, 1); RawKind = [int]$_.RawKind }',
    '      }',
    '    } | Select-Object -First 80)',
    '    $trays = @($ps.PaperSources | ForEach-Object { [string]$_.SourceName } | Where-Object { $_ -and $_.Trim().Length -gt 0 } | Select-Object -Unique)',
    '    $dpi = @($ps.PrinterResolutions | Where-Object { $_.X -gt 0 -or $_.Y -gt 0 } | ForEach-Object { [Math]::Max([int]$_.X, [int]$_.Y) } | Where-Object { $_ -ge 72 -and $_ -le 9600 } | Select-Object -Unique | Sort-Object)',
    '    $dps = $ps.DefaultPageSettings',
    '    if ($dps) {',
    '      if ($dps.PaperSize) {',
    '        $defPaperName = [string]$dps.PaperSize.PaperName',
    '        $defW = [Math]::Round($dps.PaperSize.Width * 0.254, 1)',
    '        $defH = [Math]::Round($dps.PaperSize.Height * 0.254, 1)',
    '      }',
    '      if ($dps.PaperSource) { $defTray = [string]$dps.PaperSource.SourceName }',
    '      $defLand = [bool]$dps.Landscape',
    '      $defColor = [bool]$dps.Color',
    '      if ($dps.PrinterResolution -and ($dps.PrinterResolution.X -gt 0 -or $dps.PrinterResolution.Y -gt 0)) {',
    '        $defDpi = [Math]::Max([int]$dps.PrinterResolution.X, [int]$dps.PrinterResolution.Y)',
    '      }',
    '    }',
    '    $defDuplex = [string]$ps.Duplex',
    '  }',
    '  $mediaTypes = @(); $staples = @(); $punches = @(); $folds = @(); $bins = @(); $supCollate = $true; $supBorderless = $false',
    '  $defMedia = ""; $defQuality = "Normal"; $defCollate = $true; $defStaple = ""; $defPunch = ""; $defFold = ""; $defBin = ""; $defBorderless = $false',
    '  $q = $queueMap[$p.Name]',
    '  if (-not $q) {',
    '    $matchKey = ($queueMap.Keys | Where-Object { $_ -ieq $p.Name } | Select-Object -First 1)',
    '    if ($matchKey) { $q = $queueMap[$matchKey] }',
    '  }',
    '  if ($q) {',
    '    try {',
    '      $capXml = [xml]$q.GetPrintCapabilitiesAsXml().OuterXml',
    '      $readOpt = {',
    '        param($featName)',
    '        $list = @()',
    '        $feat = $capXml.SelectSingleNode("//*[local-name()=\'Feature\' and contains(@name,\'$featName\')]")',
    '        if ($feat) {',
    '          foreach ($opt in $feat.SelectNodes("./*[local-name()=\'Option\']")) {',
    '            $dn = $opt.SelectSingleNode("./*[local-name()=\'Property\' and contains(@name,\'DisplayName\')]/*[local-name()=\'Value\']")',
    '            $val = if ($dn -and $dn.InnerText) { $dn.InnerText.Trim() } else { [string]$opt.GetAttribute("name") }',
    '            if ($val) { $list += ($val -replace \'^[a-zA-Z0-9]+:\', \'\') }',
    '          }',
    '        }',
    '        return @($list | Select-Object -Unique)',
    '      }',
    '      $mediaTypes = & $readOpt "PageMediaType"',
    '      $staples = & $readOpt "Staple"',
    '      $punches = & $readOpt "HolePunch"',
    '      $folds = & $readOpt "Fold"',
    '      $bins = & $readOpt "OutputBin"',
    '      $bOpts = & $readOpt "Borderless"',
    '      if ($bOpts -contains "Borderless" -or ($bOpts | Where-Object { $_ -match "Borderless" })) { $supBorderless = $true }',
    '      $ut = $q.UserPrintTicket',
    '      if ($ut) {',
    '        $tXml = [xml]$ut.GetXmlStream().ToArray()',
    '        if ($ut.PageMediaType) { $defMedia = [string]$ut.PageMediaType }',
    '        if ($ut.PageOutputQuality) { $defQuality = [string]$ut.PageOutputQuality }',
    '        if ($ut.PageBorderless -eq [System.Printing.PageBorderless]::Borderless) { $defBorderless = $true }',
    '        if ($ut.Stapling -and $ut.Stapling -ne [System.Printing.Stapling]::None) { $defStaple = [string]$ut.Stapling }',
    '      }',
    '    } catch {}',
    '  }',
    '  [PSCustomObject]@{',
    '    Name = $p.Name',
    '    DriverName = $p.DriverName',
    '    PortName = $p.PortName',
    '    Default = [bool]$p.Default',
    '    Network = [bool]$p.Network',
    '    Location = $p.Location',
    '    WorkOffline = [bool]$p.WorkOffline',
    '    PrinterStatus = [int]$p.PrinterStatus',
    '    DetectedErrorState = [int]$p.DetectedErrorState',
    '    JobCount = [int]$p.JobCountSinceLastReset',
    '    SupportsColor = if ($ps.IsValid) { [bool]$ps.SupportsColor } else { $true }',
    '    SupportsDuplex = if ($ps.IsValid) { [bool]$ps.CanDuplex } else { $false }',
    '    MaxCopies = $maxCopies',
    '    PaperSizes = $papers',
    '    Trays = $trays',
    '    MediaTypes = $mediaTypes',
    '    Resolutions = $dpi',
    '    StapleModes = $staples',
    '    HolePunchModes = $punches',
    '    FoldModes = $folds',
    '    OutputBins = $bins',
    '    SupportsCollate = $supCollate',
    '    SupportsBorderless = $supBorderless',
    '    DefaultPaperName = $defPaperName',
    '    DefaultPaperWidthMm = $defW',
    '    DefaultPaperHeightMm = $defH',
    '    DefaultTray = $defTray',
    '    DefaultLandscape = $defLand',
    '    DefaultColor = $defColor',
    '    DefaultDpi = $defDpi',
    '    DefaultDuplex = $defDuplex',
    '    DefaultMediaType = $defMedia',
    '    DefaultQuality = $defQuality',
    '    DefaultCollate = $defCollate',
    '    DefaultStaple = $defStaple',
    '    DefaultHolePunch = $defPunch',
    '    DefaultFold = $defFold',
    '    DefaultOutputBin = $defBin',
    '    DefaultBorderless = $defBorderless',
    '  }',
    '}',
    '@($out) | ConvertTo-Json -Depth 5 -Compress',
  ].join('; ');

  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
    { timeout: 14000, windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' }
  );

  const parsed = parseJsonSafe<RawWin32Printer | RawWin32Printer[]>(stdout);
  if (!parsed) return [];
  const list = Array.isArray(parsed) ? parsed : [parsed];

  return list
    .filter((item): item is RawWin32Printer & { Name: string } => Boolean(sanitizeDriverText(item?.Name)))
    .map((raw) => {
      const name = sanitizeDriverText(raw.Name);
      const portName = sanitizeDriverText(raw.PortName) || 'LOCAL';
      const driverName = sanitizeDriverText(raw.DriverName) || 'Windows Printer Driver';

      const paperOptions = buildPaperOptions(raw);
      const supportedPapers = mapPaperIdsFromOptions(paperOptions, raw.PaperNames);
      const supportedTrays = normalizeStringList(raw.Trays, ['Auto Select']);
      const supportedMediaTypes = normalizeStringList(raw.MediaTypes, ['Plain Paper']);
      const supportedDpi =
        raw.Resolutions && raw.Resolutions.length > 0 ? raw.Resolutions : [300, 600];
      const supportsColor = raw.SupportsColor ?? true;
      const supportsDuplex = raw.SupportsDuplex ?? false;
      const maxCopies = Math.max(1, Math.min(999, Number(raw.MaxCopies) || 999));

      const stapleModes = normalizeStringList(raw.StapleModes);
      const holePunchModes = normalizeStringList(raw.HolePunchModes);
      const foldModes = normalizeStringList(raw.FoldModes);
      const outputBins = normalizeStringList(raw.OutputBins);

      // Resolve active paper size + physical dimensions straight from driver DefaultPageSettings
      let defW = Number(raw.DefaultPaperWidthMm) || 0;
      let defH = Number(raw.DefaultPaperHeightMm) || 0;
      const defPaperName = sanitizeDriverText(raw.DefaultPaperName);
      let activePaperId: PaperSizeId = matchStandardPaperId(defW, defH, defPaperName);

      if ((defW <= 0 || defH <= 0) && activePaperId !== 'Custom') {
        const std = STANDARD_PAPER_SIZES[activePaperId];
        defW = std.widthMm;
        defH = std.heightMm;
      } else if (defW <= 0 || defH <= 0) {
        const fallbackOpt = paperOptions.find((o) => o.id === 'A4') ?? paperOptions[0];
        if (fallbackOpt) {
          activePaperId = fallbackOpt.id;
          defW = fallbackOpt.widthMm;
          defH = fallbackOpt.heightMm;
        } else {
          activePaperId = supportedPapers.includes('A4') ? 'A4' : supportedPapers[0] ?? 'A4';
          const std = activePaperId !== 'Custom' ? STANDARD_PAPER_SIZES[activePaperId] : { widthMm: 210, heightMm: 297 };
          defW = std.widthMm;
          defH = std.heightMm;
        }
      }

      const cleanDefTray = sanitizeDriverText(raw.DefaultTray);
      const activeTray =
        cleanDefTray && supportedTrays.includes(cleanDefTray)
          ? cleanDefTray
          : supportedTrays.find((t) => /auto|automatically/i.test(t)) ?? supportedTrays[0] ?? 'Auto Select';

      const cleanDefMedia = sanitizeDriverText(raw.DefaultMediaType);
      const activeMedia =
        cleanDefMedia && supportedMediaTypes.includes(cleanDefMedia)
          ? cleanDefMedia
          : supportedMediaTypes[0] ?? 'Plain Paper';

      const activeDpi =
        raw.DefaultDpi && raw.DefaultDpi > 0 && supportedDpi.includes(raw.DefaultDpi)
          ? raw.DefaultDpi
          : supportedDpi.includes(600)
            ? 600
            : supportedDpi[0] ?? 300;

      const duplexMode = mapWin32Duplex(raw.DefaultDuplex, supportsDuplex);
      const colorMode: PrinterProfileSettings['colorMode'] = supportsColor
        ? raw.DefaultColor === false
          ? 'monochrome'
          : 'color'
        : 'monochrome';

      return {
        name,
        driverName,
        portName,
        isDefault: Boolean(raw.Default),
        isNetwork:
          Boolean(raw.Network) ||
          name.startsWith('\\\\') ||
          portName.toUpperCase().startsWith('IP_'),
        isVirtual: isVirtualPrinterName(name),
        status: mapWin32PrinterStatus(raw),
        jobsInQueue: Math.max(0, Number(raw.JobCount) || 0),
        location: raw.Location?.trim() || undefined,
        capabilities: {
          supportedPapers,
          paperOptions: paperOptions.length > 0 ? paperOptions : undefined,
          supportedTrays,
          supportedMediaTypes,
          supportsDuplex,
          supportsColor,
          supportedDpi,
          maxCopies,
          supportsCollate: raw.SupportsCollate ?? true,
          supportsStaple: stapleModes.length > 0,
          supportedStapleModes: stapleModes.length > 0 ? stapleModes : undefined,
          supportedHolePunchModes: holePunchModes.length > 0 ? holePunchModes : undefined,
          supportedFoldModes: foldModes.length > 0 ? foldModes : undefined,
          supportedOutputBins: outputBins.length > 0 ? outputBins : undefined,
          supportedQualities: ['draft', 'normal', 'high'],
          supportsBorderless: Boolean(raw.SupportsBorderless),
        },
        activeProfile: {
          printerName: name,
          paperSize: activePaperId,
          paperName: defPaperName || (activePaperId !== 'Custom' ? activePaperId : 'Custom'),
          paperWidthMm: Math.min(defW, defH),
          paperHeightMm: Math.max(defW, defH),
          tray: activeTray,
          mediaType: activeMedia,
          duplexMode,
          orientation: raw.DefaultLandscape ? 'landscape' : 'portrait',
          colorMode,
          dpi: activeDpi,
          quality: mapWin32Quality(raw.DefaultQuality),
          collate: raw.DefaultCollate ?? true,
          ...(raw.DefaultStaple ? { staple: raw.DefaultStaple } : {}),
          ...(raw.DefaultOutputBin ? { outputBin: raw.DefaultOutputBin } : {}),
          ...(raw.DefaultHolePunch ? { holePunch: raw.DefaultHolePunch } : {}),
          ...(raw.DefaultFold ? { fold: raw.DefaultFold } : {}),
          ...(raw.DefaultBorderless ? { borderless: true } : {}),
        },
      };
    });
}

export async function queryWindowsPrinterMarginsViaPowerShell(
  request: PrinterMarginRequest
): Promise<PrinterMarginResult> {
  if (process.platform !== 'win32') {
    return { status: 'unavailable', reason: 'Not running on Windows' };
  }
  if (!request?.printerName?.trim()) {
    return { status: 'unavailable', reason: 'No printer selected' };
  }
  if (isVirtualPrinterName(request.printerName)) {
    return {
      status: 'available',
      source: 'virtual',
      marginsMm: { top: 0, right: 0, bottom: 0, left: 0 },
    };
  }

  const escapedPrinter = request.printerName.replace(/'/g, "''");
  const escapedPaper = request.paperSize.replace(/'/g, "''");
  const shortMm = Math.min(request.widthMm, request.heightMm);
  const longMm = Math.max(request.widthMm, request.heightMm);
  const landscapeFlag = request.orientation === 'landscape' ? '$true' : '$false';

  const psScript = [
    "$ErrorActionPreference = 'Stop'",
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    'Add-Type -AssemblyName System.Drawing',
    '$ps = New-Object System.Drawing.Printing.PrinterSettings',
    `$ps.PrinterName = '${escapedPrinter}'`,
    'if (-not $ps.IsValid) { throw "Printer is not installed or accessible" }',
    '$pg = $ps.DefaultPageSettings.Clone()',
    `$pg.Landscape = ${landscapeFlag}`,
    `$targetShort = ${shortMm.toFixed(2)}; $targetLong = ${longMm.toFixed(2)}; $reqPaper = '${escapedPaper}'`,
    '$matched = $null',
    'foreach ($sz in $ps.PaperSizes) {',
    '  $w = $sz.Width * 0.254; $h = $sz.Height * 0.254',
    '  $sMin = [Math]::Min($w, $h); $sMax = [Math]::Max($w, $h)',
    '  if ([Math]::Abs($sMin - $targetShort) -le 2.0 -and [Math]::Abs($sMax - $targetLong) -le 2.0) { $matched = $sz; break }',
    '}',
    'if (-not $matched -and $reqPaper -ne "Custom") {',
    '  $matched = @($ps.PaperSizes | Where-Object { $_.PaperName -match ("\\b" + [Regex]::Escape($reqPaper) + "\\b") } | Select-Object -First 1)[0]',
    '}',
    'if ($matched) { $pg.PaperSize = $matched } else {',
    '  $pg.PaperSize = New-Object System.Drawing.Printing.PaperSize("Custom", [int][Math]::Round($targetShort / 0.254), [int][Math]::Round($targetLong / 0.254))',
    '}',
    '$hx = [double]$pg.HardMarginX * 0.254',
    '$hy = [double]$pg.HardMarginY * 0.254',
    '$bw = [double]$pg.Bounds.Width * 0.254',
    '$bh = [double]$pg.Bounds.Height * 0.254',
    '$pw = [double]$pg.PrintableArea.Width * 0.254',
    '$ph = [double]$pg.PrintableArea.Height * 0.254',
    '$top = [Math]::Round([Math]::Max(0, $hy), 2)',
    '$left = [Math]::Round([Math]::Max(0, $hx), 2)',
    '$right = [Math]::Round([Math]::Max(0, $bw - $hx - $pw), 2)',
    '$bottom = [Math]::Round([Math]::Max(0, $bh - $hy - $ph), 2)',
    '[PSCustomObject]@{ top = $top; right = $right; bottom = $bottom; left = $left } | ConvertTo-Json -Compress',
  ].join('; ');

  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
      { timeout: 8000, windowsHide: true, maxBuffer: 512 * 1024, encoding: 'utf8' }
    );
    const parsed = parseJsonSafe<{ top: number; right: number; bottom: number; left: number }>(stdout);
    if (
      parsed &&
      Number.isFinite(parsed.top) &&
      Number.isFinite(parsed.right) &&
      Number.isFinite(parsed.bottom) &&
      Number.isFinite(parsed.left)
    ) {
      return {
        status: 'available',
        source: 'hardware',
        marginsMm: parsed,
      };
    }
    return { status: 'unavailable', reason: 'Driver did not return printable bounds' };
  } catch (error) {
    return {
      status: 'unavailable',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Dispatches rendered imposed sheet images directly to a Windows Spooler printer queue
 * using System.Drawing.Printing.PrintDocument with real PaperSize, PaperSource (Tray),
 * Duplex, Resolution (DPI), Color, Copies, Collate, and Orientation, plus optional PrintTicket
 * finishing/media settings.
 */
export async function printToWindowsPrinterViaPowerShell(
  request: PrintJobRequest,
  imagePaths: string[]
): Promise<SpoolerJobInfo> {
  if (process.platform !== 'win32') {
    throw new Error('Direct Windows Spooler printing is only supported on Windows.');
  }
  if (!request?.printerName?.trim()) {
    throw new Error('No target Windows printer specified.');
  }
  if (!imagePaths || imagePaths.length === 0) {
    throw new Error('No rendered print sheets were supplied for spooler dispatch.');
  }

  const jobFile = path.join(
    os.tmpdir(),
    `printstudio-dispatch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.json`
  );

  const payload = {
    printerName: request.printerName.trim(),
    jobTitle: (request.jobTitle || 'PrintStudio Document').slice(0, 120),
    copies: Math.max(1, Math.min(999, Math.round(request.copies || 1))),
    collate: Boolean(request.collate),
    duplexMode: request.duplexMode || 'none',
    dpi: Math.max(72, Math.min(4800, Math.round(request.dpi || 600))),
    colorMode: request.colorMode || 'color',
    tray: request.tray || 'Auto Select',
    paperSize: request.paperSize || 'A4',
    paperName: request.paperName || '',
    paperWidthMm: Number(request.paperWidthMm) || 0,
    paperHeightMm: Number(request.paperHeightMm) || 0,
    orientation: request.orientation || 'portrait',
    mediaType: request.mediaType || '',
    quality: request.quality || 'normal',
    staple: request.staple || '',
    outputBin: request.outputBin || '',
    holePunch: request.holePunch || '',
    fold: request.fold || '',
    borderless: Boolean(request.borderless),
    imagePaths,
  };

  await fs.writeFile(jobFile, JSON.stringify(payload), 'utf8');

  const escapedJsonPath = jobFile.replace(/'/g, "''");
  const psScript = [
    "$ErrorActionPreference = 'Stop'",
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    'Add-Type -AssemblyName System.Drawing',
    `$cfg = Get-Content -LiteralPath '${escapedJsonPath}' -Raw -Encoding UTF8 | ConvertFrom-Json`,
    '$ps = New-Object System.Drawing.Printing.PrinterSettings',
    '$ps.PrinterName = [string]$cfg.printerName',
    'if (-not $ps.IsValid) { throw ("Printer is unavailable or not installed: " + $cfg.printerName) }',
    '$maxCopies = if ($ps.MaximumCopies -gt 0) { [int]$ps.MaximumCopies } else { 999 }',
    '$ps.Copies = [int][Math]::Max(1, [Math]::Min($maxCopies, [int]$cfg.copies))',
    '$ps.Collate = [bool]$cfg.collate',
    'if ($ps.CanDuplex) {',
    '  switch ([string]$cfg.duplexMode) {',
    '    "long-edge" { $ps.Duplex = [System.Drawing.Printing.Duplex]::Vertical }',
    '    "short-edge" { $ps.Duplex = [System.Drawing.Printing.Duplex]::Horizontal }',
    '    default { $ps.Duplex = [System.Drawing.Printing.Duplex]::Simplex }',
    '  }',
    '} else {',
    '  $ps.Duplex = [System.Drawing.Printing.Duplex]::Simplex',
    '}',
    '$doc = New-Object System.Drawing.Printing.PrintDocument',
    '$doc.PrinterSettings = $ps',
    '$doc.DocumentName = [string]$cfg.jobTitle',
    '$doc.OriginAtMargins = $false',
    '$doc.PrintController = New-Object System.Drawing.Printing.StandardPrintController',
    '$doc.DefaultPageSettings.Landscape = ([string]$cfg.orientation -eq "landscape")',
    '$doc.DefaultPageSettings.Color = ($ps.SupportsColor -and ([string]$cfg.colorMode -ne "bw"))',
    'if ($cfg.tray -and $cfg.tray -ne "Auto Select") {',
    '  $trayObj = @($ps.PaperSources | Where-Object { $_.SourceName -ieq [string]$cfg.tray } | Select-Object -First 1)[0]',
    '  if (-not $trayObj) { $trayObj = @($ps.PaperSources | Where-Object { $_.SourceName -like ("*" + [string]$cfg.tray + "*") } | Select-Object -First 1)[0] }',
    '  if ($trayObj) { $doc.DefaultPageSettings.PaperSource = $trayObj }',
    '}',
    '$matchedPaper = $null',
    'if ($cfg.paperName) {',
    '  $matchedPaper = @($ps.PaperSizes | Where-Object { $_.PaperName -ieq [string]$cfg.paperName } | Select-Object -First 1)[0]',
    '}',
    'if (-not $matchedPaper -and [double]$cfg.paperWidthMm -gt 10 -and [double]$cfg.paperHeightMm -gt 10) {',
    '  $tShort = [Math]::Min([double]$cfg.paperWidthMm, [double]$cfg.paperHeightMm)',
    '  $tLong = [Math]::Max([double]$cfg.paperWidthMm, [double]$cfg.paperHeightMm)',
    '  foreach ($sz in $ps.PaperSizes) {',
    '    $w = $sz.Width * 0.254; $h = $sz.Height * 0.254',
    '    if ([Math]::Abs([Math]::Min($w, $h) - $tShort) -le 2.2 -and [Math]::Abs([Math]::Max($w, $h) - $tLong) -le 2.2) { $matchedPaper = $sz; break }',
    '  }',
    '}',
    'if (-not $matchedPaper -and $cfg.paperSize -and $cfg.paperSize -ne "Custom") {',
    '  $matchedPaper = @($ps.PaperSizes | Where-Object { $_.PaperName -match ("\\b" + [Regex]::Escape([string]$cfg.paperSize) + "\\b") } | Select-Object -First 1)[0]',
    '}',
    'if ($matchedPaper) { $doc.DefaultPageSettings.PaperSize = $matchedPaper }',
    'elseif ([double]$cfg.paperWidthMm -gt 10 -and [double]$cfg.paperHeightMm -gt 10) {',
    '  $w100 = [int][Math]::Round([Math]::Min([double]$cfg.paperWidthMm, [double]$cfg.paperHeightMm) / 0.254)',
    '  $h100 = [int][Math]::Round([Math]::Max([double]$cfg.paperWidthMm, [double]$cfg.paperHeightMm) / 0.254)',
    '  $doc.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize("Custom", $w100, $h100)',
    '}',
    '$bestRes = $null; $bestDiff = [int]::MaxValue',
    'foreach ($res in $ps.PrinterResolutions) {',
    '  $rVal = [Math]::Max([int]$res.X, [int]$res.Y)',
    '  if ($rVal -gt 0) {',
    '    $diff = [Math]::Abs($rVal - [int]$cfg.dpi)',
    '    if ($diff -lt $bestDiff) { $bestDiff = $diff; $bestRes = $res }',
    '  }',
    '}',
    'if ($bestRes) { $doc.DefaultPageSettings.PrinterResolution = $bestRes }',
    '$files = @($cfg.imagePaths)',
    '$state = @{ Index = 0 }',
    '$handler = [System.Drawing.Printing.PrintPageEventHandler]{',
    '  param($sender, $e)',
    '  $imgPath = [string]$files[$state.Index]',
    '  $img = [System.Drawing.Image]::FromFile($imgPath)',
    '  try {',
    '    $e.Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic',
    '    $e.Graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality',
    '    $e.Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality',
    '    $e.Graphics.TranslateTransform(-[single]$e.PageSettings.HardMarginX, -[single]$e.PageSettings.HardMarginY)',
    '    $bounds = $e.PageBounds',
    '    $destRect = New-Object System.Drawing.RectangleF(0, 0, [single]$bounds.Width, [single]$bounds.Height)',
    '    $e.Graphics.DrawImage($img, $destRect)',
    '  } finally {',
    '    $img.Dispose()',
    '  }',
    '  $state.Index++',
    '  $e.HasMorePages = ($state.Index -lt $files.Count)',
    '}',
    '$doc.add_PrintPage($handler)',
    'try { $doc.Print() } finally { $doc.remove_PrintPage($handler); $doc.Dispose() }',
    '$latestJob = $null',
    'try {',
    '  $jobs = @(Get-CimInstance -ClassName Win32_PrintJob | Where-Object { $_.Name -like ($cfg.printerName + ",*") -or $_.Name -eq $cfg.printerName } | Sort-Object JobId -Descending | Select-Object -First 1)',
    '  if ($jobs.Count -gt 0) { $latestJob = $jobs[0] }',
    '} catch {}',
    '[PSCustomObject]@{',
    '  JobId = if ($latestJob) { [int]$latestJob.JobId } else { [int]([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() % 100000) }',
    '  PrinterName = [string]$cfg.printerName',
    '  DocumentTitle = [string]$cfg.jobTitle',
    '  UserName = [string]$env:USERNAME',
    '  Status = if ($latestJob -and $latestJob.Status) { [string]$latestJob.Status } else { "Spooling" }',
    '  TotalPages = [int]$files.Count',
    '  PagesPrinted = 0',
    '  SizeBytes = if ($latestJob -and $latestJob.Size) { [long]$latestJob.Size } else { 0 }',
    '  Priority = if ($latestJob -and $latestJob.Priority) { [int]$latestJob.Priority } else { 1 }',
    '  SubmittedAt = [DateTime]::UtcNow.ToString("O")',
    '} | ConvertTo-Json -Compress',
  ].join('; ');

  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
      { timeout: 60000, windowsHide: true, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' }
    );
    const parsed = parseJsonSafe<{
      JobId?: number;
      PrinterName?: string;
      DocumentTitle?: string;
      UserName?: string;
      Status?: string;
      TotalPages?: number;
      PagesPrinted?: number;
      SizeBytes?: number;
      Priority?: number;
      SubmittedAt?: string;
    }>(stdout);

    return {
      jobId: Number(parsed?.JobId) || Math.floor(Date.now() % 100000),
      printerName: parsed?.PrinterName || request.printerName,
      documentTitle: parsed?.DocumentTitle || request.jobTitle || 'PrintStudio Document',
      userName: parsed?.UserName || 'Windows User',
      status: mapWin32JobStatus(parsed?.Status),
      totalPages: Math.max(1, Number(parsed?.TotalPages) || imagePaths.length),
      pagesPrinted: Math.max(0, Number(parsed?.PagesPrinted) || 0),
      sizeBytes: Math.max(0, Number(parsed?.SizeBytes) || 0),
      priority: Math.max(1, Math.min(99, Number(parsed?.Priority) || 1)),
      submittedAt: parsed?.SubmittedAt || new Date().toISOString(),
    };
  } finally {
    await fs.rm(jobFile, { force: true }).catch(() => undefined);
  }
}

export function mapElectronPrintersToPrinterInfo(
  electronPrinters: ElectronNativePrinter[]
): PrinterInfo[] {
  return electronPrinters
    .filter((item) => Boolean(sanitizeDriverText(item?.name)))
    .map((item) => {
      const name = sanitizeDriverText(item.name);
      const opts = (item.options ?? {}) as Record<string, string | undefined>;
      const portName = sanitizeDriverText(opts['printer-location']) || 'WINDOWS_SPOOLER';
      const driverName =
        sanitizeDriverText(opts['printer-make-and-model']) ||
        sanitizeDriverText(item.description) ||
        'Windows Printer Driver';

      return {
        name,
        driverName,
        portName,
        isDefault: Boolean(item.isDefault),
        isNetwork: name.startsWith('\\\\'),
        isVirtual: isVirtualPrinterName(name),
        status: mapElectronStatus(item.status),
        jobsInQueue: 0,
        location: opts['printer-location'] || undefined,
        capabilities: {
          supportedPapers: ['A4', 'A3', 'A5', 'Letter', 'Legal', 'Custom'],
          supportedTrays: ['Auto Select'],
          supportedMediaTypes: ['Plain Paper'],
          supportsDuplex: true,
          supportsColor: true,
          supportedDpi: [300, 600],
          maxCopies: 999,
          supportsCollate: true,
        },
        activeProfile: {
          printerName: name,
          paperSize: 'A4',
          paperName: 'A4',
          paperWidthMm: 210,
          paperHeightMm: 297,
          tray: 'Auto Select',
          mediaType: 'Plain Paper',
          duplexMode: 'none',
          orientation: 'portrait',
          colorMode: 'color',
          dpi: 600,
          quality: 'normal',
          collate: true,
        },
      };
    });
}

export async function queryWindowsSpoolerJobsViaPowerShell(
  printerName?: string
): Promise<SpoolerJobInfo[]> {
  if (process.platform !== 'win32') return [];

  const psScript = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$jobs = Get-CimInstance -ClassName Win32_PrintJob',
    'if (-not $jobs) { $jobs = Get-WmiObject -Class Win32_PrintJob }',
    '$out = foreach ($j in @($jobs)) {',
    '  [PSCustomObject]@{',
    '    JobId = [int]$j.JobId',
    '    Name = $j.Name',
    '    Document = $j.Document',
    '    Owner = $j.Owner',
    '    Status = $j.Status',
    '    TotalPages = [int]$j.TotalPages',
    '    PagesPrinted = [int]$j.PagesPrinted',
    '    Size = [int]$j.Size',
    '    Priority = [int]$j.Priority',
    '    TimeSubmitted = [string]$j.TimeSubmitted',
    '  }',
    '}',
    '@($out) | ConvertTo-Json -Depth 3 -Compress',
  ].join('; ');

  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
    { timeout: 8000, windowsHide: true, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' }
  );

  const parsed = parseJsonSafe<RawWin32PrintJob | RawWin32PrintJob[]>(stdout);
  if (!parsed) return [];
  const list = Array.isArray(parsed) ? parsed : [parsed];

  const mapped: SpoolerJobInfo[] = [];
  for (const job of list) {
    if (!job) continue;
    const rawName = String(job.Name ?? '');
    const pName = rawName.includes(',') ? rawName.split(',')[0].trim() : rawName.trim();
    if (!pName) continue;
    if (printerName && pName.toLowerCase() !== printerName.toLowerCase()) continue;

    mapped.push({
      jobId: Number(job.JobId) || 0,
      printerName: pName,
      documentTitle: job.Document?.trim() || 'Windows Print Job',
      userName: job.Owner?.trim() || 'Windows User',
      status: mapWin32JobStatus(job.Status),
      totalPages: Math.max(1, Number(job.TotalPages) || 1),
      pagesPrinted: Math.max(0, Number(job.PagesPrinted) || 0),
      sizeBytes: Math.max(0, Number(job.Size) || 0),
      priority: Math.max(1, Math.min(99, Number(job.Priority) || 1)),
      submittedAt: job.TimeSubmitted || new Date().toISOString(),
    });
  }
  return mapped;
}

export async function setWindowsDefaultPrinterViaPowerShell(
  printerName: string
): Promise<boolean> {
  if (process.platform !== 'win32' || !printerName.trim()) return false;
  const escaped = printerName.replace(/'/g, "''");
  const psScript = `(New-Object -ComObject WScript.Network).SetDefaultPrinter('${escaped}')`;
  await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
    { timeout: 6000, windowsHide: true }
  );
  return true;
}
