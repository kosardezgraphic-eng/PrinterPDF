import { execFile } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { PDFDocument } from 'pdf-lib';
import {
  STANDARD_PAPER_SIZES,
  VIRTUAL_PRINTER_DEFAULT_NAME,
  type PageOrientation,
  type PaperSizeId,
  type PrintJobRequest,
  type SpoolerJobInfo,
  type VirtualPrinterCapturedJob,
  type VirtualPrinterConfig,
  type VirtualPrinterIncomingPayload,
  type VirtualPrinterStatus,
} from '../shared/models';
import type { SessionStore } from './sessionStore';

const execFileAsync = promisify(execFile);
const MM_TO_PT = 72 / 25.4;

export function createDefaultVirtualPrinterConfig(): VirtualPrinterConfig {
  return {
    enabled: true,
    printerName: VIRTUAL_PRINTER_DEFAULT_NAME,
    paperSize: 'A4',
    paperWidthMm: 210,
    paperHeightMm: 297,
    orientation: 'portrait',
    dpi: 600,
    autoImportToStudio: true,
    switchToStudioOnReceive: true,
  };
}

export function normalizeVirtualPrinterConfig(
  patch: Partial<VirtualPrinterConfig> | null | undefined,
  base: VirtualPrinterConfig = createDefaultVirtualPrinterConfig()
): VirtualPrinterConfig {
  const nextPaperSize = (patch?.paperSize ?? base.paperSize) as PaperSizeId;
  const std =
    nextPaperSize !== 'Custom' && nextPaperSize in STANDARD_PAPER_SIZES
      ? STANDARD_PAPER_SIZES[nextPaperSize as Exclude<PaperSizeId, 'Custom'>]
      : null;

  const rawW =
    typeof patch?.paperWidthMm === 'number' && Number.isFinite(patch.paperWidthMm)
      ? patch.paperWidthMm
      : std
        ? std.widthMm
        : base.paperWidthMm;
  const rawH =
    typeof patch?.paperHeightMm === 'number' && Number.isFinite(patch.paperHeightMm)
      ? patch.paperHeightMm
      : std
        ? std.heightMm
        : base.paperHeightMm;

  const clampedW = Math.max(50, Math.min(2000, Math.round(rawW * 10) / 10));
  const clampedH = Math.max(50, Math.min(2000, Math.round(rawH * 10) / 10));
  const orientation: PageOrientation =
    patch?.orientation === 'landscape' || patch?.orientation === 'portrait'
      ? patch.orientation
      : base.orientation;

  const rawDpi =
    typeof patch?.dpi === 'number' && Number.isFinite(patch.dpi)
      ? Math.round(patch.dpi)
      : base.dpi;
  const dpi = Math.max(72, Math.min(2400, rawDpi));

  const printerName =
    typeof patch?.printerName === 'string' && patch.printerName.trim()
      ? patch.printerName.trim()
      : base.printerName;

  return {
    enabled: typeof patch?.enabled === 'boolean' ? patch.enabled : base.enabled,
    printerName,
    paperSize: nextPaperSize,
    paperWidthMm: Math.min(clampedW, clampedH),
    paperHeightMm: Math.max(clampedW, clampedH),
    orientation,
    dpi,
    autoImportToStudio:
      typeof patch?.autoImportToStudio === 'boolean'
        ? patch.autoImportToStudio
        : base.autoImportToStudio,
    switchToStudioOnReceive:
      typeof patch?.switchToStudioOnReceive === 'boolean'
        ? patch.switchToStudioOnReceive
        : base.switchToStudioOnReceive,
  };
}

function escapePsSingleQuoted(value: string): string {
  return value.replace(/'/g, "''");
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

export function resolveVirtualSpoolDir(userDataDir: string): string {
  if (process.platform === 'win32') {
    const baseLocal = process.env.LOCALAPPDATA || userDataDir;
    return path.join(baseLocal, 'PrintStudioPro', 'VirtualSpool');
  }
  return path.join(userDataDir, 'VirtualSpool');
}

export function buildVirtualPrinterStatusScript(
  printerName: string = VIRTUAL_PRINTER_DEFAULT_NAME
): string {
  const escaped = escapePsSingleQuoted(printerName);
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    `$target = '${escaped}'`,
    '$p = Get-Printer -Name $target | Select-Object -First 1',
    'if (-not $p) {',
    '  $w = Get-CimInstance -ClassName Win32_Printer | Where-Object { $_.Name -ieq $target } | Select-Object -First 1',
    '  if ($w) { $p = [PSCustomObject]@{ Name = $w.Name; DriverName = $w.DriverName; PortName = $w.PortName } }',
    '}',
    'if ($p) {',
    '  [PSCustomObject]@{ installed = $true; driverName = [string]$p.DriverName; portName = [string]$p.PortName } | ConvertTo-Json -Compress',
    '} else {',
    '  [PSCustomObject]@{ installed = $false; driverName = $null; portName = $null } | ConvertTo-Json -Compress',
    '}',
  ].join('\r\n');
}

export function buildApplyVirtualPrinterConfigScript(
  printerName: string,
  config: VirtualPrinterConfig
): string {
  const escapedName = escapePsSingleQuoted(printerName);
  const paperArg =
    config.paperSize === 'Custom'
      ? 'A4'
      : config.paperSize === 'Letter'
        ? 'Letter'
        : config.paperSize === 'Legal'
          ? 'Legal'
          : config.paperSize;
  const escapedPaper = escapePsSingleQuoted(paperArg);
  const landscapeFlag = config.orientation === 'landscape' ? '$true' : '$false';
  const colorFlag = '$true';
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    `$target = '${escapedName}'`,
    `$paper = '${escapedPaper}'`,
    `$isLand = ${landscapeFlag}`,
    `$isColor = ${colorFlag}`,
    `$targetDpi = ${Math.round(config.dpi)}`,
    'if (Get-Command Set-PrintConfiguration -ErrorAction SilentlyContinue) {',
    '  $pc = Get-PrintConfiguration -PrinterName $target',
    '  if ($pc) {',
    '    Set-PrintConfiguration -PrinterName $target -PaperSize $paper -Color $isColor | Out-Null',
    '  }',
    '}',
    'try {',
    '  Add-Type -AssemblyName System.Drawing',
    '  $ps = New-Object System.Drawing.Printing.PrinterSettings',
    '  $ps.PrinterName = $target',
    '  if ($ps.IsValid) {',
    '    $ps.DefaultPageSettings.Landscape = $isLand',
    '    $ps.DefaultPageSettings.Color = $isColor',
    '    $bestRes = $ps.PrinterResolutions | Where-Object { $_.X -eq $targetDpi -or $_.Y -eq $targetDpi } | Select-Object -First 1',
    '    if ($bestRes) { $ps.DefaultPageSettings.PrinterResolution = $bestRes }',
    '  }',
    '} catch {}',
    '[PSCustomObject]@{ ok = $true } | ConvertTo-Json -Compress',
  ].join('\r\n');
}

export function buildInstallVirtualPrinterScript(
  printerName: string,
  spoolFilePath: string,
  config: VirtualPrinterConfig
): string {
  const escapedName = escapePsSingleQuoted(printerName);
  const escapedSpoolFile = escapePsSingleQuoted(spoolFilePath);
  const escapedSpoolDir = escapePsSingleQuoted(path.dirname(spoolFilePath));
  const paperName =
    config.paperSize === 'Custom' ? 'A4' : escapePsSingleQuoted(config.paperSize);
  return [
    "$ErrorActionPreference = 'Stop'",
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    `$printerName = '${escapedName}'`,
    `$spoolFile = '${escapedSpoolFile}'`,
    `$spoolDir = '${escapedSpoolDir}'`,
    "$portSuffix = '\\PrintStudioPro\\VirtualSpool\\incoming-job.pdf'",
    '$escapedNameRegex = [regex]::Escape($printerName)',
    'function Test-IsMatchingVirtualPrinter($p) {',
    '  if (-not $p) { return $false }',
    '  $n = [string]$p.Name',
    '  $pn = [string]$p.PortName',
    '  if ($n -ieq $printerName) { return $true }',
    '  if ($n -imatch ("^" + $escapedNameRegex + "\\s*\\(")) { return $true }',
    '  if ($pn -and (($pn -ieq $spoolFile) -or ($pn.ToLowerInvariant().EndsWith($portSuffix.ToLowerInvariant())))) { return $true }',
    '  return $false',
    '}',
    '$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)',
    'if (-not $isAdmin) {',
    '  $elevatedArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""',
    '  $proc = Start-Process -FilePath "powershell.exe" -ArgumentList $elevatedArgs -Verb RunAs -Wait -PassThru',
    '  if ($proc.ExitCode -ne 0) { throw ("Elevated installer exited with code " + $proc.ExitCode) }',
    '  $installedNow = Get-Printer -Name $printerName -ErrorAction SilentlyContinue',
    '  [PSCustomObject]@{ ok = [bool]$installedNow; driverName = if ($installedNow) { [string]$installedNow.DriverName } else { $null }; portName = if ($installedNow) { [string]$installedNow.PortName } else { $null } } | ConvertTo-Json -Compress',
    '  exit 0',
    '}',
    'New-Item -ItemType Directory -Force -Path $spoolDir | Out-Null',
    'try { & icacls $spoolDir /grant "*S-1-5-32-545:(OI)(CI)F" /grant "SYSTEM:(OI)(CI)F" /T /C | Out-Null } catch {}',
    '$driverName = $null',
    'foreach ($cand in @("Microsoft Print To PDF", "Microsoft XPS Document Writer v4")) {',
    '  $drv = Get-PrinterDriver -Name $cand -ErrorAction SilentlyContinue | Select-Object -First 1',
    '  if ($drv) { $driverName = $drv.Name; break }',
    '}',
    'if (-not $driverName) {',
    '  try {',
    '    Add-PrinterDriver -Name "Microsoft Print To PDF" -ErrorAction Stop',
    '    $driverName = "Microsoft Print To PDF"',
    '  } catch {}',
    '}',
    'if (-not $driverName) {',
    '  throw "No compatible Microsoft Print To PDF driver found. Enable Print-to-PDF-Services in Windows Features."',
    '}',
    '$allMatching = @(Get-Printer -ErrorAction SilentlyContinue | Where-Object { Test-IsMatchingVirtualPrinter $_ })',
    '$dups = @($allMatching | Where-Object { $_.Name -ine $printerName })',
    'foreach ($dup in $dups) {',
    '  try { Get-PrintJob -PrinterName $dup.Name -ErrorAction SilentlyContinue | ForEach-Object { Remove-PrintJob -PrinterName $dup.Name -ID $_.ID -ErrorAction SilentlyContinue } } catch {}',
    '  Remove-Printer -Name $dup.Name -ErrorAction SilentlyContinue',
    '}',
    '$portExists = Get-PrinterPort -Name $spoolFile -ErrorAction SilentlyContinue',
    'if (-not $portExists) {',
    '  Add-PrinterPort -Name $spoolFile -ErrorAction Stop',
    '}',
    '$existingMatches = @(Get-Printer -ErrorAction SilentlyContinue | Where-Object { $_.Name -ieq $printerName })',
    'if ($existingMatches.Count -gt 1) {',
    '  for ($i = 1; $i -lt $existingMatches.Count; $i++) { Remove-Printer -Name $existingMatches[$i].Name -ErrorAction SilentlyContinue }',
    '}',
    '$existingPrinter = $existingMatches | Select-Object -First 1',
    'if ($existingPrinter) {',
    '  Set-Printer -Name $printerName -DriverName $driverName -PortName $spoolFile -ErrorAction Stop',
    '} else {',
    '  Add-Printer -Name $printerName -DriverName $driverName -PortName $spoolFile -ErrorAction Stop',
    '}',
    '$stalePorts = @(Get-PrinterPort -ErrorAction SilentlyContinue | Where-Object { (($_.Name -ieq $spoolFile) -or ($_.Name.ToLowerInvariant().EndsWith($portSuffix.ToLowerInvariant()))) -and ($_.Name -ine $spoolFile) })',
    'foreach ($sp in $stalePorts) { Remove-PrinterPort -Name $sp.Name -ErrorAction SilentlyContinue }',
    'try {',
    `  Set-PrintConfiguration -PrinterName $printerName -PaperSize '${paperName}' -Color $true -ErrorAction SilentlyContinue | Out-Null`,
    '} catch {}',
    '[PSCustomObject]@{ ok = $true; driverName = $driverName; portName = $spoolFile } | ConvertTo-Json -Compress',
  ].join('\r\n');
}

export function buildUninstallVirtualPrinterScript(
  printerName: string,
  spoolFilePath: string
): string {
  const escapedName = escapePsSingleQuoted(printerName);
  const escapedSpoolFile = escapePsSingleQuoted(spoolFilePath);
  return [
    "$ErrorActionPreference = 'Stop'",
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    `$printerName = '${escapedName}'`,
    `$spoolFile = '${escapedSpoolFile}'`,
    "$portSuffix = '\\PrintStudioPro\\VirtualSpool\\incoming-job.pdf'",
    '$escapedNameRegex = [regex]::Escape($printerName)',
    '$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)',
    'if (-not $isAdmin) {',
    '  $elevatedArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""',
    '  $proc = Start-Process -FilePath "powershell.exe" -ArgumentList $elevatedArgs -Verb RunAs -Wait -PassThru',
    '  if ($proc.ExitCode -ne 0) { throw ("Elevated uninstaller exited with code " + $proc.ExitCode) }',
    '  [PSCustomObject]@{ ok = $true } | ConvertTo-Json -Compress',
    '  exit 0',
    '}',
    '$matches = @(Get-Printer -ErrorAction SilentlyContinue | Where-Object { ($_.Name -ieq $printerName) -or ($_.Name -imatch ("^" + $escapedNameRegex + "\\s*\\(")) -or ($_.PortName -and (($_.PortName -ieq $spoolFile) -or ($_.PortName.ToLowerInvariant().EndsWith($portSuffix.ToLowerInvariant())))) })',
    'foreach ($m in $matches) {',
    '  try { Get-PrintJob -PrinterName $m.Name -ErrorAction SilentlyContinue | ForEach-Object { Remove-PrintJob -PrinterName $m.Name -ID $_.ID -ErrorAction SilentlyContinue } } catch {}',
    '  Remove-Printer -Name $m.Name -ErrorAction Stop',
    '}',
    'Start-Sleep -Milliseconds 300',
    '$ports = @(Get-PrinterPort -ErrorAction SilentlyContinue | Where-Object { ($_.Name -ieq $spoolFile) -or ($_.Name.ToLowerInvariant().EndsWith($portSuffix.ToLowerInvariant())) })',
    'foreach ($port in $ports) {',
    '  Remove-PrinterPort -Name $port.Name -ErrorAction SilentlyContinue',
    '}',
    'if (Test-Path -LiteralPath $spoolFile) { Remove-Item -LiteralPath $spoolFile -Force -ErrorAction SilentlyContinue }',
    '[PSCustomObject]@{ ok = $true } | ConvertTo-Json -Compress',
  ].join('\r\n');
}

async function countPdfPagesSafe(bytes: Uint8Array): Promise<number> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    return Math.max(1, doc.getPageCount());
  } catch {
    return 1;
  }
}

async function buildPdfFromPngSheets(
  pageImages: Uint8Array[],
  widthMm: number,
  heightMm: number,
  orientation: PageOrientation
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const shortMm = Math.min(widthMm, heightMm);
  const longMm = Math.max(widthMm, heightMm);
  const targetWidthPt = (orientation === 'landscape' ? longMm : shortMm) * MM_TO_PT;
  const targetHeightPt = (orientation === 'landscape' ? shortMm : longMm) * MM_TO_PT;

  for (const imgBytes of pageImages) {
    const embedded = await pdf.embedPng(imgBytes);
    const page = pdf.addPage([targetWidthPt, targetHeightPt]);
    page.drawImage(embedded, {
      x: 0,
      y: 0,
      width: targetWidthPt,
      height: targetHeightPt,
    });
  }
  return pdf.save();
}

export class VirtualPrinterManager {
  private readonly store: SessionStore;
  private readonly spoolDir: string;
  private config: VirtualPrinterConfig = createDefaultVirtualPrinterConfig();
  private installedInWindows = false;
  private driverName: string | null = null;
  private portName: string | null = null;
  private lastError: string | null = null;
  private recentJobs: VirtualPrinterCapturedJob[] = [];
  private watcher: fsSync.FSWatcher | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private onJobCallback: ((payload: VirtualPrinterIncomingPayload) => void) | null = null;
  private processingFiles = new Set<string>();
  private initialized = false;

  constructor(store: SessionStore, userDataDir: string) {
    this.store = store;
    this.spoolDir = resolveVirtualSpoolDir(userDataDir);
  }

  public get spoolFilePath(): string {
    return path.join(this.spoolDir, 'incoming-job.pdf');
  }

  public async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    const saved = await this.store.loadVirtualPrinterConfig().catch(() => null);
    this.config = normalizeVirtualPrinterConfig(saved);
    await fs.mkdir(this.spoolDir, { recursive: true }).catch(() => undefined);
    await this.refreshOsStatus();
  }

  public getConfig(): VirtualPrinterConfig {
    return { ...this.config };
  }

  public isVirtualTargetPrinter(printerName?: string): boolean {
    if (!printerName) return false;
    return printerName.trim().toLowerCase() === this.config.printerName.toLowerCase();
  }

  private async refreshOsStatus(): Promise<void> {
    if (process.platform !== 'win32') {
      this.installedInWindows = false;
      this.driverName = null;
      this.portName = null;
      return;
    }
    try {
      const script = buildVirtualPrinterStatusScript(this.config.printerName);
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
        { timeout: 6000, windowsHide: true, encoding: 'utf8' }
      );
      const parsed = parseJsonSafe<{
        installed?: boolean;
        driverName?: string | null;
        portName?: string | null;
      }>(stdout);
      this.installedInWindows = Boolean(parsed?.installed);
      this.driverName = parsed?.driverName ?? null;
      this.portName = parsed?.portName ?? null;
      this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    }
  }

  public async getStatus(forceOsCheck = true): Promise<VirtualPrinterStatus> {
    await this.init();
    if (forceOsCheck) {
      await this.refreshOsStatus();
    }
    return {
      supportedOnOs: process.platform === 'win32',
      installedInWindows: this.installedInWindows,
      driverName: this.driverName,
      portName: this.portName,
      spoolDir: this.spoolDir,
      watcherActive: Boolean(this.watcher || this.pollTimer),
      lastError: this.lastError,
      config: { ...this.config },
      recentJobs: [...this.recentJobs],
    };
  }

  public async updateConfig(patch: Partial<VirtualPrinterConfig>): Promise<VirtualPrinterStatus> {
    await this.init();
    this.config = normalizeVirtualPrinterConfig(patch, this.config);
    await this.store.saveVirtualPrinterConfig(this.config);

    if (process.platform === 'win32' && this.installedInWindows) {
      try {
        const script = buildApplyVirtualPrinterConfigScript(this.config.printerName, this.config);
        await execFileAsync(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
          { timeout: 8000, windowsHide: true, encoding: 'utf8' }
        );
      } catch {
        // Best-effort OS PrintTicket sync
      }
    }

    return this.getStatus(false);
  }

  public async install(): Promise<VirtualPrinterStatus> {
    await this.init();
    if (process.platform !== 'win32') {
      this.lastError = 'Windows Virtual Printer installation is only available on Windows.';
      return this.getStatus(false);
    }

    const ps1File = path.join(os.tmpdir(), `printstudio-vp-install-${Date.now()}.ps1`);
    try {
      await fs.mkdir(this.spoolDir, { recursive: true });
      const script = buildInstallVirtualPrinterScript(
        this.config.printerName,
        this.spoolFilePath,
        this.config
      );
      await fs.writeFile(ps1File, '\uFEFF' + script, 'utf8');
      await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1File],
        { timeout: 60000, windowsHide: true, encoding: 'utf8' }
      );
      this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    } finally {
      await fs.rm(ps1File, { force: true }).catch(() => undefined);
    }
    return this.getStatus(true);
  }

  public async uninstall(): Promise<VirtualPrinterStatus> {
    await this.init();
    if (process.platform !== 'win32') {
      return this.getStatus(false);
    }

    const ps1File = path.join(os.tmpdir(), `printstudio-vp-uninstall-${Date.now()}.ps1`);
    try {
      const script = buildUninstallVirtualPrinterScript(
        this.config.printerName,
        this.spoolFilePath
      );
      await fs.writeFile(ps1File, '\uFEFF' + script, 'utf8');
      await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1File],
        { timeout: 45000, windowsHide: true, encoding: 'utf8' }
      );
      this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    } finally {
      await fs.rm(ps1File, { force: true }).catch(() => undefined);
    }
    return this.getStatus(true);
  }

  public async startWatching(
    onJob: (payload: VirtualPrinterIncomingPayload) => void
  ): Promise<void> {
    await this.init();
    this.onJobCallback = onJob;
    if (this.watcher || this.pollTimer) return;

    await fs.mkdir(this.spoolDir, { recursive: true }).catch(() => undefined);
    try {
      this.watcher = fsSync.watch(this.spoolDir, (_eventType, filename) => {
        if (!filename) return;
        const fullPath = path.join(this.spoolDir, filename.toString());
        void this.tryIngestSpoolFile(fullPath, 'windows-spool');
      });
      this.watcher.on('error', () => {
        // Polling fallback continues safely
      });
    } catch {
      this.watcher = null;
    }

    this.pollTimer = setInterval(() => {
      void this.scanSpoolDir();
    }, 1200);
  }

  public stopWatching(): void {
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch {
        // Ignore close error
      }
      this.watcher = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async scanSpoolDir(): Promise<void> {
    if (!this.config.enabled) return;
    try {
      const entries = await fs.readdir(this.spoolDir);
      for (const name of entries) {
        if (!/\.(pdf|png|jpe?g|tiff?)$/i.test(name)) continue;
        await this.tryIngestSpoolFile(path.join(this.spoolDir, name), 'windows-spool');
      }
    } catch {
      // Directory might be transiently locked
    }
  }

  private async tryIngestSpoolFile(
    filePath: string,
    source: VirtualPrinterCapturedJob['source']
  ): Promise<void> {
    if (!this.config.enabled || this.processingFiles.has(filePath)) return;
    if (!/\.(pdf|png|jpe?g|tiff?)$/i.test(filePath)) return;

    this.processingFiles.add(filePath);
    try {
      let lastSize = -1;
      for (let attempt = 0; attempt < 15; attempt++) {
        const stat = await fs.stat(filePath).catch(() => null);
        if (!stat || !stat.isFile()) return;
        if (stat.size > 0 && stat.size === lastSize) {
          break;
        }
        lastSize = stat.size;
        await new Promise((r) => setTimeout(r, 250));
      }

      const raw = await fs.readFile(filePath).catch(() => null);
      if (!raw || raw.byteLength === 0) return;

      const isPdf = /\.pdf$/i.test(filePath);
      if (isPdf) {
        const header = raw.subarray(0, Math.min(16, raw.byteLength)).toString('ascii');
        if (!header.includes('%PDF-')) return;
      }

      await fs.rm(filePath, { force: true }).catch(() => undefined);

      const bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
      const stamp = new Date();
      const baseTitle = path.basename(filePath).startsWith('incoming-job')
        ? `VirtualPrint-${stamp.toISOString().replace(/[:.]/g, '-').slice(0, 19)}.pdf`
        : path.basename(filePath);
      const ext = path.extname(baseTitle).toLowerCase();
      const mimeType =
        ext === '.png'
          ? 'image/png'
          : ext === '.jpg' || ext === '.jpeg'
            ? 'image/jpeg'
            : ext === '.tif' || ext === '.tiff'
              ? 'image/tiff'
              : 'application/pdf';

      const pageCount = mimeType === 'application/pdf' ? await countPdfPagesSafe(bytes) : 1;
      const job: VirtualPrinterCapturedJob = {
        id: `vp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        jobTitle: baseTitle,
        fileName: baseTitle,
        pageCount,
        sizeBytes: bytes.byteLength,
        paperSize: this.config.paperSize,
        orientation: this.config.orientation,
        dpi: this.config.dpi,
        receivedAt: stamp.toISOString(),
        source,
      };
      this.recentJobs = [job, ...this.recentJobs].slice(0, 25);

      this.onJobCallback?.({
        job,
        fileName: baseTitle,
        mimeType,
        bytes,
      });
    } finally {
      this.processingFiles.delete(filePath);
    }
  }

  public async captureInAppPrintJob(
    request: PrintJobRequest,
    pdfBytes?: Uint8Array,
    pageImages?: Uint8Array[]
  ): Promise<SpoolerJobInfo> {
    await this.init();
    const effectivePaper = request.paperSize ?? this.config.paperSize;
    const effectiveWidth = request.paperWidthMm ?? this.config.paperWidthMm;
    const effectiveHeight = request.paperHeightMm ?? this.config.paperHeightMm;
    const effectiveOrientation = request.orientation ?? this.config.orientation;
    const effectiveDpi = request.dpi ?? this.config.dpi;

    let finalBytes: Uint8Array;
    if (pdfBytes && pdfBytes.byteLength > 0) {
      finalBytes = new Uint8Array(pdfBytes);
    } else if (pageImages && pageImages.length > 0) {
      finalBytes = await buildPdfFromPngSheets(
        pageImages,
        effectiveWidth,
        effectiveHeight,
        effectiveOrientation
      );
    } else {
      throw new Error('No document content was supplied to Virtual Printer');
    }

    const pageCount = await countPdfPagesSafe(finalBytes);
    const cleanTitle = (request.jobTitle || 'VirtualPrint').replace(/[\\/:*?"<>|]/g, '_');
    const fileName = cleanTitle.toLowerCase().endsWith('.pdf')
      ? cleanTitle
      : `${cleanTitle}.pdf`;

    const jobRecord: VirtualPrinterCapturedJob = {
      id: `vp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      jobTitle: request.jobTitle || fileName,
      fileName,
      pageCount,
      sizeBytes: finalBytes.byteLength,
      paperSize: effectivePaper,
      orientation: effectiveOrientation,
      dpi: effectiveDpi,
      receivedAt: new Date().toISOString(),
      source: 'in-app',
    };
    this.recentJobs = [jobRecord, ...this.recentJobs].slice(0, 25);

    this.onJobCallback?.({
      job: jobRecord,
      fileName,
      mimeType: 'application/pdf',
      bytes: finalBytes,
    });

    return {
      jobId: Math.floor(Date.now() % 100000),
      printerName: this.config.printerName,
      documentTitle: request.jobTitle || fileName,
      userName: process.env.USERNAME || 'Windows User',
      status: 'Completed',
      totalPages: pageCount,
      pagesPrinted: pageCount,
      sizeBytes: finalBytes.byteLength,
      priority: 1,
      submittedAt: jobRecord.receivedAt,
    };
  }
}
