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
  VirtualPrinterConfig,
} from '../shared/models';
import {
  STANDARD_PAPER_SIZES,
  VIRTUAL_PRINTER_DEFAULT_NAME,
  sanitizeDriverText,
} from '../shared/models';

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

function mapWin32Duplex(rawDuplex?: string, _supportsDuplex?: boolean): DuplexMode {
  const s = (rawDuplex ?? '').toLowerCase();
  if (s.includes('horizontal') || s.includes('short')) return 'short-edge';
  if (s.includes('vertical') || s.includes('long')) return 'long-edge';
  if (s.includes('simplex') || s.includes('one')) return 'none';
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
    '      $capSr = New-Object System.IO.StreamReader($q.GetPrintCapabilitiesAsXml())',
    '      $capXml = [xml]($capSr.ReadToEnd())',
    '      $capSr.Dispose()',
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
    '      $readTicketDn = {',
    '        param($tXmlDoc, $featName)',
    '        if (-not $tXmlDoc) { return "" }',
    '        $tOpt = $tXmlDoc.SelectSingleNode("//*[local-name()=\'Feature\' and contains(@name,\'$featName\')]/*[local-name()=\'Option\']")',
    '        if (-not $tOpt) { return "" }',
    '        $optRaw = [string]$tOpt.GetAttribute("name")',
    '        if (-not $optRaw) { return "" }',
    '        $cOpt = $capXml.SelectSingleNode("//*[local-name()=\'Feature\' and contains(@name,\'$featName\')]/*[local-name()=\'Option\' and @name=\'$optRaw\']")',
    '        $dn = if ($cOpt) { $cOpt.SelectSingleNode("./*[local-name()=\'Property\' and contains(@name,\'DisplayName\')]/*[local-name()=\'Value\']") } else { $null }',
    '        if ($dn -and $dn.InnerText) { return $dn.InnerText.Trim() }',
    '        return ($optRaw -replace \'^[a-zA-Z0-9]+:\', \'\')',
    '      }',
    '      $mediaTypes = & $readOpt "PageMediaType"',
    '      $staples = & $readOpt "Staple"',
    '      $punches = & $readOpt "HolePunch"',
    '      $folds = & $readOpt "Fold"',
    '      $bins = & $readOpt "OutputBin"',
    '      $bOpts = & $readOpt "Borderless"',
    '      if ($bOpts -contains "Borderless" -or ($bOpts | Where-Object { $_ -match "Borderless" })) { $supBorderless = $true }',
    '      $ut = $q.UserPrintTicket',
    '      if (-not $ut) { $ut = $q.DefaultPrintTicket }',
    '      if ($ut) {',
    '        $tSr = New-Object System.IO.StreamReader($ut.GetXmlStream())',
    '        $tXml = [xml]($tSr.ReadToEnd())',
    '        $tSr.Dispose()',
    '        $xmlMedia = & $readTicketDn $tXml "PageMediaType"',
    '        if ($xmlMedia) { $defMedia = $xmlMedia } elseif ($ut.PageMediaType) { $defMedia = [string]$ut.PageMediaType }',
    '        $xmlTray = & $readTicketDn $tXml "InputBin"',
    '        if ($xmlTray -and -not $defTray) { $defTray = $xmlTray }',
    '        if ($ut.Duplexing) {',
    '          $utDup = [string]$ut.Duplexing',
    '          if ($utDup -eq "TwoSidedLongEdge") { $defDuplex = "Vertical" }',
    '          elseif ($utDup -eq "TwoSidedShortEdge") { $defDuplex = "Horizontal" }',
    '          elseif ($utDup -eq "OneSided" -and (-not $ps.IsValid)) { $defDuplex = "Simplex" }',
    '        }',
    '        if ($ut.OutputQuality) { $defQuality = [string]$ut.OutputQuality }',
    '        if ($ut.Collation) { $defCollate = ($ut.Collation -eq [System.Printing.Collation]::Collated) }',
    '        if ($ut.PageBorderless -eq [System.Printing.PageBorderless]::Borderless) { $defBorderless = $true }',
    '        $xmlStaple = & $readTicketDn $tXml "Staple"',
    '        if ($xmlStaple) { $defStaple = $xmlStaple } elseif ($ut.Stapling -and $ut.Stapling -ne [System.Printing.Stapling]::None) { $defStaple = [string]$ut.Stapling }',
    '        $xmlPunch = & $readTicketDn $tXml "HolePunch"; if ($xmlPunch) { $defPunch = $xmlPunch }',
    '        $xmlFold = & $readTicketDn $tXml "Fold"; if ($xmlFold) { $defFold = $xmlFold }',
    '        $xmlBin = & $readTicketDn $tXml "OutputBin"; if ($xmlBin) { $defBin = $xmlBin }',
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
      const maxSide = Math.max(parsed.top, parsed.right, parsed.bottom, parsed.left);
      if (maxSide > 0 && maxSide < 0.5) {
        return {
          status: 'unavailable',
          reason: 'Driver reported implausibly small non-zero hardware margins',
        };
      }
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

const WIN32_DEVMODE_CSHARP = [
  'using System;',
  'using System.Drawing.Printing;',
  'using System.Runtime.InteropServices;',
  '',
  'public static class PrintStudioWin32DevMode',
  '{',
  '    private const int DC_PAPERS = 2;',
  '    private const int DC_PAPERSIZE = 3;',
  '    private const int DC_BINS = 6;',
  '    private const int DC_BINNAMES = 12;',
  '    private const int DC_PAPERNAMES = 16;',
  '    private const int DC_MEDIATYPENAMES = 34;',
  '    private const int DC_MEDIATYPES = 35;',
  '',
  '    private const int DM_ORIENTATION = 0x00000001;',
  '    private const int DM_PAPERSIZE = 0x00000002;',
  '    private const int DM_PAPERLENGTH = 0x00000004;',
  '    private const int DM_PAPERWIDTH = 0x00000008;',
  '    private const int DM_COPIES = 0x00000100;',
  '    private const int DM_DEFAULTSOURCE = 0x00000200;',
  '    private const int DM_PRINTQUALITY = 0x00000400;',
  '    private const int DM_COLOR = 0x00000800;',
  '    private const int DM_DUPLEX = 0x00001000;',
  '    private const int DM_YRESOLUTION = 0x00002000;',
  '    private const int DM_COLLATE = 0x00008000;',
  '    private const int DM_FORMNAME = 0x00010000;',
  '    private const int DM_MEDIATYPE = 0x02000000;',
  '',
  '    private const int DM_OUT_BUFFER = 2;',
  '    private const int DM_IN_BUFFER = 8;',
  '    private const short DMPAPER_USER = 256;',
  '    private const int PRINTER_ACCESS_USE = 0x00000008;',
  '    private const uint GMEM_MOVEABLE = 0x0002;',
  '    private const uint GMEM_ZEROINIT = 0x0040;',
  '',
  '    [StructLayout(LayoutKind.Sequential)]',
  '    private struct POINT { public int X; public int Y; }',
  '',
  '    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]',
  '    private struct PRINTER_DEFAULTS { public IntPtr pDatatype; public IntPtr pDevMode; public int DesiredAccess; }',
  '',
  '    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]',
  '    private struct PRINTER_INFO_9 { public IntPtr pDevMode; }',
  '',
  '    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]',
  '    private struct DEVMODEW',
  '    {',
  '        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;',
  '        public short dmSpecVersion;',
  '        public short dmDriverVersion;',
  '        public short dmSize;',
  '        public short dmDriverExtra;',
  '        public int dmFields;',
  '        public short dmOrientation;',
  '        public short dmPaperSize;',
  '        public short dmPaperLength;',
  '        public short dmPaperWidth;',
  '        public short dmScale;',
  '        public short dmCopies;',
  '        public short dmDefaultSource;',
  '        public short dmPrintQuality;',
  '        public short dmColor;',
  '        public short dmDuplex;',
  '        public short dmYResolution;',
  '        public short dmTTOption;',
  '        public short dmCollate;',
  '        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;',
  '        public short dmLogPixels;',
  '        public int dmBitsPerPel;',
  '        public int dmPelsWidth;',
  '        public int dmPelsHeight;',
  '        public int dmDisplayFlags;',
  '        public int dmDisplayFrequency;',
  '        public int dmICMMethod;',
  '        public int dmICMIntent;',
  '        public int dmMediaType;',
  '        public int dmDitherType;',
  '        public int dmReserved1;',
  '        public int dmReserved2;',
  '        public int dmPanningWidth;',
  '        public int dmPanningHeight;',
  '    }',
  '',
  '    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]',
  '    private static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, ref PRINTER_DEFAULTS pDefault);',
  '',
  '    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]',
  '    private static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);',
  '',
  '    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]',
  '    private static extern int DocumentProperties(IntPtr hwnd, IntPtr hPrinter, string pDeviceName, IntPtr pDevModeOutput, IntPtr pDevModeInput, int fMode);',
  '',
  '    [DllImport("winspool.drv", SetLastError = true)]',
  '    private static extern bool ClosePrinter(IntPtr hPrinter);',
  '',
  '    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]',
  '    private static extern int DeviceCapabilities(string pDevice, string pPort, short fwCapability, IntPtr pOutput, IntPtr pDevMode);',
  '',
  '    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]',
  '    private static extern bool SetPrinter(IntPtr hPrinter, int Level, ref PRINTER_INFO_9 pPrinter, int Command);',
  '',
  '    [DllImport("kernel32.dll", SetLastError = true)]',
  '    private static extern IntPtr GlobalAlloc(uint uFlags, UIntPtr dwBytes);',
  '',
  '    [DllImport("kernel32.dll", SetLastError = true)]',
  '    private static extern IntPtr GlobalLock(IntPtr hMem);',
  '',
  '    [DllImport("kernel32.dll", SetLastError = true)]',
  '    private static extern bool GlobalUnlock(IntPtr hMem);',
  '',
  '    [DllImport("kernel32.dll", SetLastError = true)]',
  '    private static extern IntPtr GlobalFree(IntPtr hMem);',
  '',
  '    private static string[] ReadCapStrings(string printerName, short cap, int charWidth)',
  '    {',
  '        int count = DeviceCapabilities(printerName, string.Empty, cap, IntPtr.Zero, IntPtr.Zero);',
  '        if (count <= 0) return new string[0];',
  '        int bytesPer = charWidth * 2;',
  '        int total = count * bytesPer;',
  '        IntPtr buf = Marshal.AllocHGlobal(total);',
  '        try',
  '        {',
  '            Marshal.Copy(new byte[total], 0, buf, total);',
  '            int fetched = DeviceCapabilities(printerName, string.Empty, cap, buf, IntPtr.Zero);',
  '            int n = Math.Min(count, fetched);',
  '            string[] result = new string[n];',
  '            char[] chars = new char[charWidth];',
  '            for (int i = 0; i < n; i++)',
  '            {',
  '                Marshal.Copy(IntPtr.Add(buf, i * bytesPer), chars, 0, charWidth);',
  '                int nul = Array.IndexOf(chars, \'\\0\');',
  '                result[i] = new string(chars, 0, nul >= 0 ? nul : charWidth).Trim();',
  '            }',
  '            return result;',
  '        }',
  '        finally { Marshal.FreeHGlobal(buf); }',
  '    }',
  '',
  '    private static short ResolvePaperKind(string printerName, string paperSize, string paperName, double shortMm, double longMm)',
  '    {',
  '        int count = DeviceCapabilities(printerName, string.Empty, DC_PAPERS, IntPtr.Zero, IntPtr.Zero);',
  '        if (count > 0)',
  '        {',
  '            string[] names = ReadCapStrings(printerName, DC_PAPERNAMES, 64);',
  '            int idBytes = count * sizeof(short);',
  '            int ptSize = Marshal.SizeOf(typeof(POINT));',
  '            int szBytes = count * ptSize;',
  '            IntPtr idBuf = Marshal.AllocHGlobal(idBytes);',
  '            IntPtr szBuf = Marshal.AllocHGlobal(szBytes);',
  '            try',
  '            {',
  '                Marshal.Copy(new byte[idBytes], 0, idBuf, idBytes);',
  '                Marshal.Copy(new byte[szBytes], 0, szBuf, szBytes);',
  '                int nIds = DeviceCapabilities(printerName, string.Empty, DC_PAPERS, idBuf, IntPtr.Zero);',
  '                int nSz = DeviceCapabilities(printerName, string.Empty, DC_PAPERSIZE, szBuf, IntPtr.Zero);',
  '                int limit = Math.Min(count, Math.Min(nIds, nSz));',
  '',
  '                if (!string.IsNullOrEmpty(paperName))',
  '                {',
  '                    for (int i = 0; i < Math.Min(limit, names.Length); i++)',
  '                    {',
  '                        if (string.Equals(names[i], paperName.Trim(), StringComparison.OrdinalIgnoreCase))',
  '                            return Marshal.ReadInt16(idBuf, i * sizeof(short));',
  '                    }',
  '                }',
  '                if (shortMm > 10 && longMm > 10)',
  '                {',
  '                    for (int i = 0; i < limit; i++)',
  '                    {',
  '                        POINT pt = (POINT)Marshal.PtrToStructure(IntPtr.Add(szBuf, i * ptSize), typeof(POINT));',
  '                        double w = pt.X / 10.0; double h = pt.Y / 10.0;',
  '                        if (Math.Abs(Math.Min(w, h) - shortMm) <= 2.2 && Math.Abs(Math.Max(w, h) - longMm) <= 2.2)',
  '                            return Marshal.ReadInt16(idBuf, i * sizeof(short));',
  '                    }',
  '                }',
  '            }',
  '            finally',
  '            {',
  '                Marshal.FreeHGlobal(idBuf);',
  '                Marshal.FreeHGlobal(szBuf);',
  '            }',
  '        }',
  '',
  '        if (string.Equals(paperSize, "Letter", StringComparison.OrdinalIgnoreCase)) return 1;',
  '        if (string.Equals(paperSize, "Legal", StringComparison.OrdinalIgnoreCase)) return 5;',
  '        if (string.Equals(paperSize, "A3", StringComparison.OrdinalIgnoreCase)) return 8;',
  '        if (string.Equals(paperSize, "A4", StringComparison.OrdinalIgnoreCase)) return 9;',
  '        if (string.Equals(paperSize, "A5", StringComparison.OrdinalIgnoreCase)) return 11;',
  '        if (string.Equals(paperSize, "B4", StringComparison.OrdinalIgnoreCase)) return 12;',
  '        if (string.Equals(paperSize, "B5", StringComparison.OrdinalIgnoreCase)) return 13;',
  '        if (string.Equals(paperSize, "A2", StringComparison.OrdinalIgnoreCase)) return 66;',
  '        if (string.Equals(paperSize, "A1", StringComparison.OrdinalIgnoreCase)) return 67;',
  '        if (string.Equals(paperSize, "A0", StringComparison.OrdinalIgnoreCase)) return 68;',
  '        if (string.Equals(paperSize, "A6", StringComparison.OrdinalIgnoreCase)) return 70;',
  '        return 0;',
  '    }',
  '',
  '    private static short FindBinId(string printerName, string trayName)',
  '    {',
  '        if (string.IsNullOrEmpty(trayName)) return -1;',
  '        int count = DeviceCapabilities(printerName, string.Empty, DC_BINS, IntPtr.Zero, IntPtr.Zero);',
  '        if (count <= 0) return -1;',
  '        string[] names = ReadCapStrings(printerName, DC_BINNAMES, 24);',
  '        int total = count * sizeof(short);',
  '        IntPtr buf = Marshal.AllocHGlobal(total);',
  '        try',
  '        {',
  '            Marshal.Copy(new byte[total], 0, buf, total);',
  '            int fetched = DeviceCapabilities(printerName, string.Empty, DC_BINS, buf, IntPtr.Zero);',
  '            int limit = Math.Min(Math.Min(count, fetched), names.Length);',
  '            string target = trayName.Trim();',
  '            for (int i = 0; i < limit; i++)',
  '            {',
  '                if (string.Equals(names[i], target, StringComparison.OrdinalIgnoreCase))',
  '                    return Marshal.ReadInt16(buf, i * sizeof(short));',
  '            }',
  '            for (int i = 0; i < limit; i++)',
  '            {',
  '                if (names[i].IndexOf(target, StringComparison.OrdinalIgnoreCase) >= 0 || target.IndexOf(names[i], StringComparison.OrdinalIgnoreCase) >= 0)',
  '                    return Marshal.ReadInt16(buf, i * sizeof(short));',
  '            }',
  '            if (target.IndexOf("auto", StringComparison.OrdinalIgnoreCase) >= 0)',
  '            {',
  '                for (int i = 0; i < limit; i++)',
  '                {',
  '                    if (names[i].IndexOf("auto", StringComparison.OrdinalIgnoreCase) >= 0 || names[i].IndexOf("default", StringComparison.OrdinalIgnoreCase) >= 0)',
  '                        return Marshal.ReadInt16(buf, i * sizeof(short));',
  '                }',
  '                return 7;',
  '            }',
  '        }',
  '        finally { Marshal.FreeHGlobal(buf); }',
  '        return -1;',
  '    }',
  '',
  '    private static int FindMediaTypeId(string printerName, string mediaType)',
  '    {',
  '        if (string.IsNullOrEmpty(mediaType)) return -1;',
  '        int count = DeviceCapabilities(printerName, string.Empty, DC_MEDIATYPES, IntPtr.Zero, IntPtr.Zero);',
  '        if (count <= 0) return -1;',
  '        string[] names = ReadCapStrings(printerName, DC_MEDIATYPENAMES, 64);',
  '        int total = count * sizeof(int);',
  '        IntPtr buf = Marshal.AllocHGlobal(total);',
  '        try',
  '        {',
  '            Marshal.Copy(new byte[total], 0, buf, total);',
  '            int fetched = DeviceCapabilities(printerName, string.Empty, DC_MEDIATYPES, buf, IntPtr.Zero);',
  '            int limit = Math.Min(Math.Min(count, fetched), names.Length);',
  '            string target = mediaType.Trim();',
  '            for (int i = 0; i < limit; i++)',
  '            {',
  '                if (string.Equals(names[i], target, StringComparison.OrdinalIgnoreCase))',
  '                    return Marshal.ReadInt32(buf, i * sizeof(int));',
  '            }',
  '            for (int i = 0; i < limit; i++)',
  '            {',
  '                if (names[i].IndexOf(target, StringComparison.OrdinalIgnoreCase) >= 0 || target.IndexOf(names[i], StringComparison.OrdinalIgnoreCase) >= 0)',
  '                    return Marshal.ReadInt32(buf, i * sizeof(int));',
  '            }',
  '        }',
  '        finally { Marshal.FreeHGlobal(buf); }',
  '        return -1;',
  '    }',
  '',
  '    private static byte[] BuildDevModeBytes(string printerName, string paperSize, string paperName, double widthMm, double heightMm, string orientation, string tray, string mediaType, string duplexMode, string colorMode, int dpi, int copies, int collateFlag)',
  '    {',
  '        IntPtr hPrinter = IntPtr.Zero;',
  '        IntPtr pDev = IntPtr.Zero;',
  '        try',
  '        {',
  '            PRINTER_DEFAULTS defs = new PRINTER_DEFAULTS();',
  '            defs.DesiredAccess = PRINTER_ACCESS_USE;',
  '            if (!OpenPrinter(printerName, out hPrinter, ref defs) || hPrinter == IntPtr.Zero)',
  '            {',
  '                if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero) || hPrinter == IntPtr.Zero) return null;',
  '            }',
  '            int dmBytes = DocumentProperties(IntPtr.Zero, hPrinter, printerName, IntPtr.Zero, IntPtr.Zero, 0);',
  '            if (dmBytes < Marshal.SizeOf(typeof(DEVMODEW))) return null;',
  '            pDev = Marshal.AllocHGlobal(dmBytes);',
  '            if (DocumentProperties(IntPtr.Zero, hPrinter, printerName, pDev, IntPtr.Zero, DM_OUT_BUFFER) < 0) return null;',
  '',
  '            int fOff = Marshal.OffsetOf(typeof(DEVMODEW), "dmFields").ToInt32();',
  '            int oOff = Marshal.OffsetOf(typeof(DEVMODEW), "dmOrientation").ToInt32();',
  '            int psOff = Marshal.OffsetOf(typeof(DEVMODEW), "dmPaperSize").ToInt32();',
  '            int plOff = Marshal.OffsetOf(typeof(DEVMODEW), "dmPaperLength").ToInt32();',
  '            int pwOff = Marshal.OffsetOf(typeof(DEVMODEW), "dmPaperWidth").ToInt32();',
  '            int cpOff = Marshal.OffsetOf(typeof(DEVMODEW), "dmCopies").ToInt32();',
  '            int srOff = Marshal.OffsetOf(typeof(DEVMODEW), "dmDefaultSource").ToInt32();',
  '            int qlOff = Marshal.OffsetOf(typeof(DEVMODEW), "dmPrintQuality").ToInt32();',
  '            int clOff = Marshal.OffsetOf(typeof(DEVMODEW), "dmColor").ToInt32();',
  '            int dpOff = Marshal.OffsetOf(typeof(DEVMODEW), "dmDuplex").ToInt32();',
  '            int yrOff = Marshal.OffsetOf(typeof(DEVMODEW), "dmYResolution").ToInt32();',
  '            int coOff = Marshal.OffsetOf(typeof(DEVMODEW), "dmCollate").ToInt32();',
  '            int mtOff = Marshal.OffsetOf(typeof(DEVMODEW), "dmMediaType").ToInt32();',
  '',
  '            double shortMm = widthMm > 10 && heightMm > 10 ? Math.Min(widthMm, heightMm) : 210.0;',
  '            double longMm = widthMm > 10 && heightMm > 10 ? Math.Max(widthMm, heightMm) : 297.0;',
  '            short paperKind = ResolvePaperKind(printerName, paperSize, paperName, shortMm, longMm);',
  '',
  '            // Pass 1: Paper Size & Orientation',
  '            int fields = Marshal.ReadInt32(pDev, fOff);',
  '            fields |= DM_ORIENTATION;',
  '            Marshal.WriteInt16(pDev, oOff, string.Equals(orientation, "landscape", StringComparison.OrdinalIgnoreCase) ? (short)2 : (short)1);',
  '            if (paperKind > 0 && paperKind != DMPAPER_USER)',
  '            {',
  '                fields |= DM_PAPERSIZE;',
  '                fields &= ~(DM_PAPERWIDTH | DM_PAPERLENGTH | DM_FORMNAME);',
  '                Marshal.WriteInt16(pDev, psOff, paperKind);',
  '            }',
  '            else',
  '            {',
  '                fields |= DM_PAPERSIZE | DM_PAPERWIDTH | DM_PAPERLENGTH;',
  '                fields &= ~DM_FORMNAME;',
  '                Marshal.WriteInt16(pDev, psOff, DMPAPER_USER);',
  '                Marshal.WriteInt16(pDev, pwOff, (short)Math.Max(100, Math.Min(20000, (int)Math.Round(shortMm * 10.0))));',
  '                Marshal.WriteInt16(pDev, plOff, (short)Math.Max(100, Math.Min(20000, (int)Math.Round(longMm * 10.0))));',
  '            }',
  '            Marshal.WriteInt32(pDev, fOff, fields);',
  '            DocumentProperties(IntPtr.Zero, hPrinter, printerName, pDev, pDev, DM_IN_BUFFER | DM_OUT_BUFFER);',
  '',
  '            // Pass 2: Duplex, Tray, MediaType, Color, Copies, Collate, DPI',
  '            fields = Marshal.ReadInt32(pDev, fOff);',
  '            fields |= DM_DUPLEX;',
  '            short dupVal = 1;',
  '            if (string.Equals(duplexMode, "long-edge", StringComparison.OrdinalIgnoreCase)) dupVal = 2;',
  '            else if (string.Equals(duplexMode, "short-edge", StringComparison.OrdinalIgnoreCase)) dupVal = 3;',
  '            Marshal.WriteInt16(pDev, dpOff, dupVal);',
  '',
  '            short binId = FindBinId(printerName, tray);',
  '            if (binId >= 0) { fields |= DM_DEFAULTSOURCE; Marshal.WriteInt16(pDev, srOff, binId); }',
  '',
  '            int mediaId = FindMediaTypeId(printerName, mediaType);',
  '            if (mediaId >= 0) { fields |= DM_MEDIATYPE; Marshal.WriteInt32(pDev, mtOff, mediaId); }',
  '',
  '            fields |= DM_COLOR;',
  '            bool isMono = string.Equals(colorMode, "bw", StringComparison.OrdinalIgnoreCase) || string.Equals(colorMode, "monochrome", StringComparison.OrdinalIgnoreCase);',
  '            Marshal.WriteInt16(pDev, clOff, isMono ? (short)1 : (short)2);',
  '',
  '            if (copies >= 1) { fields |= DM_COPIES; Marshal.WriteInt16(pDev, cpOff, (short)Math.Max(1, Math.Min(999, copies))); }',
  '            if (collateFlag >= 0) { fields |= DM_COLLATE; Marshal.WriteInt16(pDev, coOff, collateFlag > 0 ? (short)1 : (short)0); }',
  '            if (dpi >= 72)',
  '            {',
  '                short d = (short)Math.Max(72, Math.Min(9600, dpi));',
  '                fields |= DM_PRINTQUALITY | DM_YRESOLUTION;',
  '                Marshal.WriteInt16(pDev, qlOff, d);',
  '                Marshal.WriteInt16(pDev, yrOff, d);',
  '            }',
  '            Marshal.WriteInt32(pDev, fOff, fields);',
  '            DocumentProperties(IntPtr.Zero, hPrinter, printerName, pDev, pDev, DM_IN_BUFFER | DM_OUT_BUFFER);',
  '',
  '            byte[] result = new byte[dmBytes];',
  '            Marshal.Copy(pDev, result, 0, dmBytes);',
  '            return result;',
  '        }',
  '        finally',
  '        {',
  '            if (pDev != IntPtr.Zero) Marshal.FreeHGlobal(pDev);',
  '            if (hPrinter != IntPtr.Zero) ClosePrinter(hPrinter);',
  '        }',
  '    }',
  '',
  '    private static bool WritePerUserDevMode(string printerName, byte[] devBytes)',
  '    {',
  '        if (devBytes == null || devBytes.Length == 0) return false;',
  '        IntPtr hPrinter = IntPtr.Zero;',
  '        GCHandle pin = new GCHandle();',
  '        try',
  '        {',
  '            PRINTER_DEFAULTS defs = new PRINTER_DEFAULTS();',
  '            defs.DesiredAccess = PRINTER_ACCESS_USE;',
  '            if (!OpenPrinter(printerName, out hPrinter, ref defs) || hPrinter == IntPtr.Zero)',
  '            {',
  '                if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero) || hPrinter == IntPtr.Zero) return false;',
  '            }',
  '            pin = GCHandle.Alloc(devBytes, GCHandleType.Pinned);',
  '            PRINTER_INFO_9 info9 = new PRINTER_INFO_9();',
  '            info9.pDevMode = pin.AddrOfPinnedObject();',
  '            return SetPrinter(hPrinter, 9, ref info9, 0);',
  '        }',
  '        catch { return false; }',
  '        finally',
  '        {',
  '            if (pin.IsAllocated) pin.Free();',
  '            if (hPrinter != IntPtr.Zero) ClosePrinter(hPrinter);',
  '        }',
  '    }',
  '',
  '    public static bool ApplyProfileToPrinter(string printerName, string paperSize, string paperName, double widthMm, double heightMm, string orientation, string tray, string mediaType, string duplexMode, string colorMode, int dpi, int collateFlag)',
  '    {',
  '        byte[] bytes = BuildDevModeBytes(printerName, paperSize, paperName, widthMm, heightMm, orientation, tray, mediaType, duplexMode, colorMode, dpi, 1, collateFlag);',
  '        if (bytes == null) return false;',
  '        return WritePerUserDevMode(printerName, bytes);',
  '    }',
  '',
  '    public static bool ConfigurePrinterSettingsForPrint(PrinterSettings ps, string printerName, string paperSize, string paperName, double widthMm, double heightMm, string orientation, string tray, string mediaType, string duplexMode, string colorMode, int dpi, int copies, int collateFlag, bool syncPerUser)',
  '    {',
  '        byte[] bytes = BuildDevModeBytes(printerName, paperSize, paperName, widthMm, heightMm, orientation, tray, mediaType, duplexMode, colorMode, dpi, copies, collateFlag);',
  '        if (bytes == null) return false;',
  '        if (syncPerUser) WritePerUserDevMode(printerName, bytes);',
  '        IntPtr hGlobal = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, (UIntPtr)bytes.Length);',
  '        if (hGlobal == IntPtr.Zero) return false;',
  '        try',
  '        {',
  '            IntPtr locked = GlobalLock(hGlobal);',
  '            if (locked == IntPtr.Zero) return false;',
  '            try { Marshal.Copy(bytes, 0, locked, bytes.Length); }',
  '            finally { GlobalUnlock(hGlobal); }',
  '            ps.SetHdevmode(hGlobal);',
  '            ps.DefaultPageSettings.SetHdevmode(hGlobal);',
  '            return true;',
  '        }',
  '        finally { GlobalFree(hGlobal); }',
  '    }',
  '}',
].join('\r\n');

const USER_PRINT_TICKET_HELPER_PS = [
  'function Sync-PrintStudioUserPrintTicket {',
  '  param($cfg)',
  '  try {',
  '    Add-Type -AssemblyName System.Printing',
  '    Add-Type -AssemblyName ReachFramework',
  '    $lps = New-Object System.Printing.LocalPrintServer',
  '    $flags = @([System.Printing.EnumeratedPrintQueueTypes]::Local, [System.Printing.EnumeratedPrintQueueTypes]::Connections)',
  '    $q = @($lps.GetPrintQueues($flags) | Where-Object { $_.FullName -ieq [string]$cfg.printerName } | Select-Object -First 1)[0]',
  '    if (-not $q) { return }',
  '    $q.Refresh()',
  '    $t = if ($q.UserPrintTicket) { $q.UserPrintTicket.Clone() } elseif ($q.DefaultPrintTicket) { $q.DefaultPrintTicket.Clone() } else { New-Object System.Printing.PrintTicket }',
  '    $t.PageOrientation = if ([string]$cfg.orientation -eq "landscape") { [System.Printing.PageOrientation]::Landscape } else { [System.Printing.PageOrientation]::Portrait }',
  '    switch ([string]$cfg.duplexMode) {',
  '      "long-edge" { $t.Duplexing = [System.Printing.Duplexing]::TwoSidedLongEdge }',
  '      "short-edge" { $t.Duplexing = [System.Printing.Duplexing]::TwoSidedShortEdge }',
  '      default { $t.Duplexing = [System.Printing.Duplexing]::OneSided }',
  '    }',
  '    $t.OutputColor = if ([string]$cfg.colorMode -eq "bw" -or [string]$cfg.colorMode -eq "monochrome") { [System.Printing.OutputColor]::Monochrome } else { [System.Printing.OutputColor]::Color }',
  '    if ($null -ne $cfg.collate) { $t.Collation = if ([bool]$cfg.collate) { [System.Printing.Collation]::Collated } else { [System.Printing.Collation]::Uncollated } }',
  '    $capSr = New-Object System.IO.StreamReader($q.GetPrintCapabilitiesAsXml()); $capXml = [xml]($capSr.ReadToEnd()); $capSr.Dispose()',
  '    $tSr = New-Object System.IO.StreamReader($t.GetXmlStream()); $tXml = [xml]($tSr.ReadToEnd()); $tSr.Dispose()',
  '    $setFeatOpt = {',
  '      param($featNames, $targetVal)',
  '      if (-not $targetVal) { return }',
  '      $val = ([string]$targetVal).Trim()',
  '      foreach ($fn in $featNames) {',
  '        foreach ($feat in $capXml.SelectNodes("//*[local-name()=\'Feature\' and contains(@name,\'$fn\')]")) {',
  '          $exact = $null; $part = $null',
  '          foreach ($opt in $feat.SelectNodes("./*[local-name()=\'Option\']")) {',
  '            $rn = [string]$opt.GetAttribute("name")',
  '            $cr = $rn -replace "^[^:]+:", ""',
  '            $dnNode = $opt.SelectSingleNode("./*[local-name()=\'Property\' and contains(@name,\'DisplayName\')]/*[local-name()=\'Value\']")',
  '            $dn = if ($dnNode -and $dnNode.InnerText) { $dnNode.InnerText.Trim() } else { "" }',
  '            if ($dn -ieq $val -or $cr -ieq $val -or $rn -ieq $val) { $exact = $opt; break }',
  '            if (-not $part -and (($dn -and ($dn -like "*$val*" -or $val -like "*$dn*")) -or ($cr -and ($cr -like "*$val*" -or $val -like "*$cr*")))) { $part = $opt }',
  '          }',
  '          $pick = if ($exact) { $exact } else { $part }',
  '          if ($pick) {',
  '            $fullFn = [string]$feat.GetAttribute("name")',
  '            foreach ($old in @($tXml.SelectNodes("//*[local-name()=\'Feature\' and @name=\'$fullFn\']"))) { [void]$old.ParentNode.RemoveChild($old) }',
  '            $root = $tXml.DocumentElement; $ns = $root.NamespaceURI; $pfx = if ($root.Prefix) { $root.Prefix } else { "psf" }',
  '            $fEl = $tXml.CreateElement($pfx, "Feature", $ns); $fEl.SetAttribute("name", $fullFn)',
  '            $oEl = $tXml.CreateElement($pfx, "Option", $ns); $oEl.SetAttribute("name", [string]$pick.GetAttribute("name"))',
  '            foreach ($sc in $pick.ChildNodes) { if ($sc.LocalName -eq "ScoredProperty") { [void]$oEl.AppendChild($tXml.ImportNode($sc, $true)) } }',
  '            [void]$fEl.AppendChild($oEl); [void]$root.AppendChild($fEl)',
  '            return',
  '          }',
  '        }',
  '      }',
  '    }',
  '    $dupKey = switch ([string]$cfg.duplexMode) { "long-edge" { "TwoSidedLongEdge" } "short-edge" { "TwoSidedShortEdge" } default { "OneSided" } }',
  '    & $setFeatOpt @("JobDuplexAllDocumentsContiguously","DocumentDuplex","Duplex") $dupKey',
  '    if ($cfg.tray) { & $setFeatOpt @("JobInputBin","DocumentInputBin","PageInputBin","InputBin") $cfg.tray }',
  '    if ($cfg.mediaType) { & $setFeatOpt @("PageMediaType") $cfg.mediaType }',
  '    if ($cfg.paperName) { & $setFeatOpt @("PageMediaSize") $cfg.paperName } elseif ($cfg.paperSize -and $cfg.paperSize -ne "Custom") { & $setFeatOpt @("PageMediaSize") $cfg.paperSize }',
  '    if ($cfg.staple) { & $setFeatOpt @("JobStapleAllDocuments","DocumentStaple","Staple") $cfg.staple }',
  '    if ($cfg.holePunch) { & $setFeatOpt @("JobHolePunch","DocumentHolePunch","HolePunch") $cfg.holePunch }',
  '    if ($cfg.fold) { & $setFeatOpt @("JobFold","DocumentFold","Fold") $cfg.fold }',
  '    if ($cfg.outputBin) { & $setFeatOpt @("JobOutputBin","DocumentOutputBin","PageOutputBin","OutputBin") $cfg.outputBin }',
  '    $outMs = New-Object System.IO.MemoryStream',
  '    $tXml.Save($outMs); $outMs.Position = 0',
  '    $newTicket = New-Object System.Printing.PrintTicket($outMs)',
  '    $validated = $q.MergeAndValidatePrintTicket($newTicket, (New-Object System.Printing.PrintTicket)).ValidatedPrintTicket',
  '    $q.UserPrintTicket = $validated',
  '    $q.Commit()',
  '    $outMs.Dispose()',
  '  } catch {}',
  '}',
].join('\r\n');

export function buildApplyProfilePowerShellScript(jsonPath: string): string {
  const escapedJsonPath = jsonPath.replace(/'/g, "''");
  return [
    "$ErrorActionPreference = 'Stop'",
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    'Add-Type -AssemblyName System.Drawing',
    "$Win32Code = @'\r\n" + WIN32_DEVMODE_CSHARP + "\r\n'@",
    'if (-not ([System.Management.Automation.PSTypeName]"PrintStudioWin32DevMode").Type) {',
    '  Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition $Win32Code',
    '}',
    USER_PRINT_TICKET_HELPER_PS,
    `$cfg = Get-Content -LiteralPath '${escapedJsonPath}' -Raw -Encoding UTF8 | ConvertFrom-Json`,
    '$ok = [PrintStudioWin32DevMode]::ApplyProfileToPrinter(',
    '  [string]$cfg.printerName,',
    '  [string]$cfg.paperSize,',
    '  [string]$cfg.paperName,',
    '  [double]$cfg.paperWidthMm,',
    '  [double]$cfg.paperHeightMm,',
    '  [string]$cfg.orientation,',
    '  [string]$cfg.tray,',
    '  [string]$cfg.mediaType,',
    '  [string]$cfg.duplexMode,',
    '  [string]$cfg.colorMode,',
    '  [int]$cfg.dpi,',
    '  $(if ($null -eq $cfg.collate) { -1 } elseif ([bool]$cfg.collate) { 1 } else { 0 })',
    ')',
    'Sync-PrintStudioUserPrintTicket $cfg',
    '[PSCustomObject]@{ ok = [bool]$ok } | ConvertTo-Json -Compress',
  ].join('\r\n');
}

export async function applyProfileToWindowsPrinterViaPowerShell(
  printerName: string,
  profile: PrinterProfileSettings
): Promise<boolean> {
  if (process.platform !== 'win32' || !printerName.trim()) return false;

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const cfgFile = path.join(os.tmpdir(), `printstudio-profile-${stamp}.json`);
  const ps1File = path.join(os.tmpdir(), `printstudio-profile-${stamp}.ps1`);

  const payload = {
    printerName: printerName.trim(),
    paperSize: profile.paperSize || 'A4',
    paperName: profile.paperName || '',
    paperWidthMm: Number(profile.paperWidthMm) || 0,
    paperHeightMm: Number(profile.paperHeightMm) || 0,
    orientation: profile.orientation || 'portrait',
    tray: profile.tray || 'Auto Select',
    mediaType: profile.mediaType || 'Plain Paper',
    duplexMode: profile.duplexMode || 'none',
    colorMode: profile.colorMode || 'color',
    dpi: Math.max(72, Math.min(4800, Math.round(profile.dpi || 600))),
    collate: profile.collate ?? true,
    staple: profile.staple || '',
    outputBin: profile.outputBin || '',
    holePunch: profile.holePunch || '',
    fold: profile.fold || '',
  };

  await fs.writeFile(cfgFile, JSON.stringify(payload), 'utf8');
  await fs.writeFile(ps1File, '\uFEFF' + buildApplyProfilePowerShellScript(cfgFile), 'utf8');

  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1File],
      { timeout: 12000, windowsHide: true, maxBuffer: 512 * 1024, encoding: 'utf8' }
    );
    const parsed = parseJsonSafe<{ ok?: boolean }>(stdout);
    return Boolean(parsed?.ok);
  } catch {
    return false;
  } finally {
    await fs.rm(cfgFile, { force: true }).catch(() => undefined);
    await fs.rm(ps1File, { force: true }).catch(() => undefined);
  }
}

export function buildWindowsPrintPowerShellScript(jsonPath: string): string {
  const escapedJsonPath = jsonPath.replace(/'/g, "''");
  return [
    "$ErrorActionPreference = 'Stop'",
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    'Add-Type -AssemblyName System.Drawing',
    "$Win32Code = @'\r\n" + WIN32_DEVMODE_CSHARP + "\r\n'@",
    'if (-not ([System.Management.Automation.PSTypeName]"PrintStudioWin32DevMode").Type) {',
    '  Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition $Win32Code',
    '}',
    USER_PRINT_TICKET_HELPER_PS,
    `$cfg = Get-Content -LiteralPath '${escapedJsonPath}' -Raw -Encoding UTF8 | ConvertFrom-Json`,
    '$ps = New-Object System.Drawing.Printing.PrinterSettings',
    '$ps.PrinterName = [string]$cfg.printerName',
    'if (-not $ps.IsValid) { throw ("Printer is unavailable or not installed: " + $cfg.printerName) }',
    '$maxCopies = if ($ps.MaximumCopies -gt 0) { [int]$ps.MaximumCopies } else { 999 }',
    '$targetCopies = [int][Math]::Max(1, [Math]::Min($maxCopies, [int]$cfg.copies))',
    'Sync-PrintStudioUserPrintTicket $cfg',
    '[void][PrintStudioWin32DevMode]::ConfigurePrinterSettingsForPrint(',
    '  $ps,',
    '  [string]$cfg.printerName,',
    '  [string]$cfg.paperSize,',
    '  [string]$cfg.paperName,',
    '  [double]$cfg.paperWidthMm,',
    '  [double]$cfg.paperHeightMm,',
    '  [string]$cfg.orientation,',
    '  [string]$cfg.tray,',
    '  [string]$cfg.mediaType,',
    '  [string]$cfg.duplexMode,',
    '  [string]$cfg.colorMode,',
    '  [int]$cfg.dpi,',
    '  [int]$targetCopies,',
    '  $(if ([bool]$cfg.collate) { 1 } else { 0 }),',
    '  $true',
    ')',
    '$ps.Copies = $targetCopies',
    '$ps.Collate = [bool]$cfg.collate',
    'try {',
    '  switch ([string]$cfg.duplexMode) {',
    '    "long-edge" { $ps.Duplex = [System.Drawing.Printing.Duplex]::Vertical }',
    '    "short-edge" { $ps.Duplex = [System.Drawing.Printing.Duplex]::Horizontal }',
    '    default { $ps.Duplex = [System.Drawing.Printing.Duplex]::Simplex }',
    '  }',
    '} catch {',
    '  $ps.Duplex = [System.Drawing.Printing.Duplex]::Simplex',
    '}',
    '$doc = New-Object System.Drawing.Printing.PrintDocument',
    '$doc.PrinterSettings = $ps',
    '$doc.DocumentName = [string]$cfg.jobTitle',
    '$doc.OriginAtMargins = $false',
    '$doc.PrintController = New-Object System.Drawing.Printing.StandardPrintController',
    '$targetLandscape = ([string]$cfg.orientation -eq "landscape")',
    '$targetColor = ($ps.SupportsColor -and ([string]$cfg.colorMode -ne "bw"))',
    '$doc.DefaultPageSettings.Landscape = $targetLandscape',
    '$doc.DefaultPageSettings.Color = $targetColor',
    '$targetTray = $null',
    'if ($cfg.tray) {',
    '  $targetTray = @($ps.PaperSources | Where-Object { $_.SourceName -ieq [string]$cfg.tray } | Select-Object -First 1)[0]',
    '  if (-not $targetTray) { $targetTray = @($ps.PaperSources | Where-Object { $_.SourceName -like ("*" + [string]$cfg.tray + "*") } | Select-Object -First 1)[0] }',
    '  if (-not $targetTray -and [string]$cfg.tray -match "auto") { $targetTray = @($ps.PaperSources | Where-Object { $_.SourceName -match "auto|default" } | Select-Object -First 1)[0] }',
    '  if ($targetTray) { $doc.DefaultPageSettings.PaperSource = $targetTray }',
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
    '  $matchedPaper = New-Object System.Drawing.Printing.PaperSize("Custom", $w100, $h100)',
    '  $doc.DefaultPageSettings.PaperSize = $matchedPaper',
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
    '$queryHandler = [System.Drawing.Printing.QueryPageSettingsEventHandler]{',
    '  param($sender, $e)',
    '  $e.PageSettings.Landscape = $targetLandscape',
    '  $e.PageSettings.Color = $targetColor',
    '  if ($matchedPaper) { $e.PageSettings.PaperSize = $matchedPaper }',
    '  if ($targetTray) { $e.PageSettings.PaperSource = $targetTray }',
    '  if ($bestRes) { $e.PageSettings.PrinterResolution = $bestRes }',
    '}',
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
    '$doc.add_QueryPageSettings($queryHandler)',
    '$doc.add_PrintPage($handler)',
    'try { $doc.Print() } finally { $doc.remove_QueryPageSettings($queryHandler); $doc.remove_PrintPage($handler); $doc.Dispose() }',
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
  ].join('\r\n');
}

/**
 * Dispatches rendered imposed sheet images directly to a Windows Spooler printer queue
 * using 2-pass Win32 DocumentProperties DEVMODE + SetHdevmode + QueryPageSettings + PrintTicket sync
 * so paper size, media type, tray, orientation, duplex, and finishing always match and take effect.
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

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const jobFile = path.join(os.tmpdir(), `printstudio-dispatch-${stamp}.json`);
  const ps1File = path.join(os.tmpdir(), `printstudio-dispatch-${stamp}.ps1`);

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
  await fs.writeFile(ps1File, '\uFEFF' + buildWindowsPrintPowerShellScript(jobFile), 'utf8');

  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1File],
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
    await fs.rm(ps1File, { force: true }).catch(() => undefined);
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

export function enrichVirtualPrinterInfo(
  printer: PrinterInfo,
  virtualConfig?: VirtualPrinterConfig
): PrinterInfo {
  const isTargetVirtual =
    printer.name.toLowerCase() ===
      (virtualConfig?.printerName || VIRTUAL_PRINTER_DEFAULT_NAME).toLowerCase() ||
    printer.name.toLowerCase() === VIRTUAL_PRINTER_DEFAULT_NAME.toLowerCase();
  if (!isTargetVirtual) return printer;

  const standardIds: Array<Exclude<PaperSizeId, 'Custom'>> = [
    'A3',
    'A4',
    'A5',
    'B4',
    'B5',
    'Letter',
    'Legal',
  ];
  const mergedPapers: PaperSizeId[] = [...printer.capabilities.supportedPapers];
  for (const id of standardIds) {
    if (!mergedPapers.includes(id)) mergedPapers.push(id);
  }
  if (!mergedPapers.includes('Custom')) mergedPapers.push('Custom');

  const existingOptions = printer.capabilities.paperOptions ?? [];
  const mergedOptions: PrinterPaperOption[] = [...existingOptions];
  for (const id of standardIds) {
    if (!mergedOptions.some((o) => o.id === id)) {
      const dims = STANDARD_PAPER_SIZES[id];
      mergedOptions.push({
        id,
        name: id,
        widthMm: dims.widthMm,
        heightMm: dims.heightMm,
      });
    }
  }

  const dpiSet = new Set<number>([...(printer.capabilities.supportedDpi ?? []), 150, 300, 600, 1200]);
  if (virtualConfig?.dpi) dpiSet.add(virtualConfig.dpi);
  const supportedDpi = Array.from(dpiSet).sort((a, b) => a - b);

  return {
    ...printer,
    isVirtual: true,
    capabilities: {
      ...printer.capabilities,
      supportedPapers: mergedPapers,
      paperOptions: mergedOptions,
      supportedDpi,
      supportsColor: true,
      supportsCollate: true,
    },
    activeProfile: {
      ...printer.activeProfile,
      ...(virtualConfig
        ? {
            paperSize: virtualConfig.paperSize,
            paperName:
              virtualConfig.paperSize !== 'Custom'
                ? virtualConfig.paperSize
                : printer.activeProfile.paperName || 'Custom',
            paperWidthMm: virtualConfig.paperWidthMm,
            paperHeightMm: virtualConfig.paperHeightMm,
            orientation: virtualConfig.orientation,
            dpi: virtualConfig.dpi,
          }
        : {}),
    },
  };
}
