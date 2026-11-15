import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  PaperSizeId,
  PrinterInfo,
  PrinterStatus,
  SpoolerJobInfo,
  SpoolerJobStatus,
} from '../shared/models';

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
  Capabilities?: number[];
  PaperNames?: string[];
  SupportsColor?: boolean;
  SupportsDuplex?: boolean;
  Resolutions?: number[];
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

const KNOWN_PAPER_IDS: PaperSizeId[] = [
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

function mapPaperNames(names?: string[]): PaperSizeId[] {
  if (!names || names.length === 0) return ['A4', 'A3', 'Letter'];
  const mapped: PaperSizeId[] = [];
  for (const raw of names) {
    const clean = raw.trim();
    const match = KNOWN_PAPER_IDS.find((id) =>
      new RegExp(`\\b${id}\\b`, 'i').test(clean)
    );
    if (match && !mapped.includes(match)) {
      mapped.push(match);
    }
  }
  return mapped.length > 0 ? mapped : ['A4', 'Letter', 'Custom'];
}

function mapWin32PrinterStatus(raw: RawWin32Printer): PrinterStatus {
  if (raw.WorkOffline) return 'Offline';
  switch (raw.DetectedErrorState) {
    case 4:
      return 'OutOfPaper';
    case 5:
      return 'LowToner';
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
  // Windows PRINTER_STATUS_* bitmask forwarded by Chromium's getPrintersAsync
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

/**
 * Queries real Windows printers via PowerShell + WMI/System.Drawing.Printing.
 * Returns [] immediately on non-Windows platforms.
 */
export async function queryWindowsPrintersViaPowerShell(): Promise<PrinterInfo[]> {
  if (process.platform !== 'win32') return [];

  const psScript = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    'Add-Type -AssemblyName System.Drawing',
    '$printers = Get-CimInstance -ClassName Win32_Printer',
    'if (-not $printers) { $printers = Get-WmiObject -Class Win32_Printer }',
    '$out = foreach ($p in @($printers)) {',
    '  $ps = New-Object System.Drawing.Printing.PrinterSettings',
    '  $ps.PrinterName = $p.Name',
    '  $papers = @(); $dpi = @()',
    '  if ($ps.IsValid) {',
    '    $papers = @($ps.PaperSizes | ForEach-Object { $_.PaperName } | Select-Object -Unique -First 30)',
    '    $dpi = @($ps.PrinterResolutions | Where-Object { $_.X -gt 0 } | ForEach-Object { [Math]::Max($_.X, $_.Y) } | Select-Object -Unique | Sort-Object)',
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
    '    PaperNames = $papers',
    '    Resolutions = $dpi',
    '  }',
    '}',
    '@($out) | ConvertTo-Json -Depth 4 -Compress',
  ].join('; ');

  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
    { timeout: 10000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }
  );

  const trimmed = stdout.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed) as RawWin32Printer | RawWin32Printer[];
  const list = Array.isArray(parsed) ? parsed : [parsed];

  return list
    .filter((item): item is RawWin32Printer & { Name: string } => Boolean(item?.Name?.trim()))
    .map((raw) => {
      const name = raw.Name.trim();
      const portName = (raw.PortName ?? '').trim() || 'LOCAL';
      const driverName = (raw.DriverName ?? '').trim() || 'Windows Printer Driver';
      const supportedPapers = mapPaperNames(raw.PaperNames);
      const supportedDpi =
        raw.Resolutions && raw.Resolutions.length > 0 ? raw.Resolutions : [300, 600];
      const supportsColor = raw.SupportsColor ?? true;
      const supportsDuplex = raw.SupportsDuplex ?? false;
      const defaultPaper: PaperSizeId = supportedPapers.includes('A4')
        ? 'A4'
        : supportedPapers[0] ?? 'A4';

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
          supportedTrays: ['Auto Select'],
          supportedMediaTypes: ['Plain Paper'],
          supportsDuplex,
          supportsColor,
          supportedDpi,
          maxCopies: 999,
        },
        activeProfile: {
          printerName: name,
          paperSize: defaultPaper,
          tray: 'Auto Select',
          mediaType: 'Plain Paper',
          duplexMode: supportsDuplex ? 'long-edge' : 'none',
          orientation: 'portrait',
          colorMode: supportsColor ? 'color' : 'monochrome',
          dpi: supportedDpi.includes(600) ? 600 : supportedDpi[0] ?? 300,
          quality: 'normal',
        },
      };
    });
}

export function mapElectronPrintersToPrinterInfo(
  electronPrinters: ElectronNativePrinter[]
): PrinterInfo[] {
  return electronPrinters
    .filter((item) => Boolean(item?.name?.trim()))
    .map((item) => {
      const name = item.name.trim();
      const opts = (item.options ?? {}) as Record<string, string | undefined>;
      const portName = opts['printer-location'] || 'WINDOWS_SPOOLER';
      const driverName =
        opts['printer-make-and-model'] ||
        item.description ||
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
        },
        activeProfile: {
          printerName: name,
          paperSize: 'A4',
          tray: 'Auto Select',
          mediaType: 'Plain Paper',
          duplexMode: 'none',
          orientation: 'portrait',
          colorMode: 'color',
          dpi: 600,
          quality: 'normal',
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
    { timeout: 8000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 }
  );

  const trimmed = stdout.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed) as RawWin32PrintJob | RawWin32PrintJob[];
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
