// @vitest-environment node
/**
 * The sidecar log is the only witness to a crash nobody saw.
 *
 * PrinterService.exe is spawned without a console, so when it dies natively (a missing WPF DLL in
 * the single-file publish is the known case) the app is left with an exit code. Both sides of that
 * contract live in different languages and nothing but these tests keeps them pointing at the same
 * file: printer-service/Program.cs writes it, electron/printerSidecarClient.ts names it in the
 * message the user reads.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrinterSidecarClient } from '../../../electron/printerSidecarClient';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const repoRoot = path.resolve(__dirname, '../../..');

/** The class refuses to do anything off Windows; pretend otherwise to reach its messages. */
function asWindows(appData: string | undefined) {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  const previousAppData = process.env.APPDATA;
  if (appData === undefined) delete process.env.APPDATA;
  else process.env.APPDATA = appData;
  return () => {
    if (descriptor) Object.defineProperty(process, 'platform', descriptor);
    if (previousAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = previousAppData;
  };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('sidecar failure message', () => {
  it('names the log file the service writes to', () => {
    const restore = asWindows(path.join('C:', 'Users', 'mahsa', 'AppData', 'Roaming'));
    try {
      const client = new PrinterSidecarClient();
      // No exe in this checkout, which is exactly the "why is the list empty" case.
      client.startSidecar(path.join(repoRoot, 'release', 'unused-resources'));

      const message = client.describeFailure(new Error('no process is listening on the named pipe'));
      expect(message).toContain('no process is listening on the named pipe');
      expect(message).toMatch(/Service log: C:[/\\]Users[/\\]mahsa[/\\]AppData[/\\]Roaming[/\\]PrintStudioPro[/\\]printer-service\.log/);
      expect(message).toContain('PrinterService.exe was not found');

      const note = client.statusNote();
      expect(note).toContain('Service log:');
      expect(note).toContain(path.join('PrintStudioPro', 'printer-service.log'));
    } finally {
      restore();
    }
  });

  it('stays a readable message when there is no AppData to point at', () => {
    const restore = asWindows(undefined);
    try {
      const client = new PrinterSidecarClient();
      client.startSidecar(repoRoot);
      const message = client.describeFailure(new Error('pipe closed'));
      expect(message).toContain('pipe closed');
      expect(message).not.toContain('Service log:');
    } finally {
      restore();
    }
  });
});

describe('log path contract between C# and TypeScript', () => {
  const program = read('../../../printer-service/Program.cs');
  const client = read('../../../electron/printerSidecarClient.ts');

  it('uses the same folder and file name on both sides', () => {
    // Program.cs composes it from the ApplicationData special folder; the client from %APPDATA%.
    expect(program).toContain('Environment.SpecialFolder.ApplicationData');
    expect(program).toContain('"PrintStudioPro"');
    expect(program).toContain('"printer-service.log"');
    expect(client).toContain("'PrintStudioPro'");
    expect(client).toContain("'printer-service.log'");
  });

  it('installs the handlers that make an unwatched crash findable', () => {
    expect(program).toContain('AppDomain.CurrentDomain.UnhandledException');
    expect(program).toContain('TaskScheduler.UnobservedTaskException');
    expect(program).toContain('e.SetObserved()');
    // One line to stderr (the app shows the tail) and one to the file (survives the exit).
    expect(program).toContain('Console.Error.WriteLine');
    expect(program).toContain('File.AppendAllText');
  });

  it('never lets a System.Printing failure reach the process', () => {
    const service = read('../../../printer-service/Services/PrinterSpoolerService.cs');
    // Enumeration order: dependency-free winspool first, System.Printing only as the fallback.
    const listPrinters = service.slice(
      service.indexOf('public IReadOnlyList<PrinterInfoDto> ListPrinters()'),
      service.indexOf('private List<PrinterInfoDto> ListPrintersWithSystemPrinting()')
    );
    expect(listPrinters).toContain('ListPrintersWithWin32()');
    expect(listPrinters.indexOf('ListPrintersWithWin32()')).toBeLessThan(listPrinters.indexOf('ListPrintersWithSystemPrinting()'));
    expect(listPrinters).toContain('winspool enumeration failed');
    // The default queue comes from the spooler itself, not from a WPF-backed property.
    // Every printer list, native or not, asks the spooler for the default: the WPF-backed
    // LocalPrintServer.DefaultPrintQueue property is gone.
    const helperCalls = service.split('ReadDefaultPrinterName()').length - 1;
    expect(helperCalls).toBeGreaterThanOrEqual(4); // definition + three enumeration paths
    expect(service).toContain('WinSpoolInterop.GetDefaultPrinter');
    expect(service).not.toContain('DefaultPrintQueue');
    // Every System.Printing entry point is guarded, including the queue listing.
    const listJobs = service.slice(service.indexOf('public IReadOnlyList<SpoolerJobDto> ListJobs'), service.indexOf('public bool ControlJob'));
    expect(listJobs).toContain('try');
    expect(listJobs).toContain('spooler job enumeration failed');
    expect(service).toContain('System.Printing enumeration failed');
  });
});

describe('single-file publish keeps the native WPF dependencies', () => {
  it('bundles native libraries, which is what stops the HwndSubclass DllNotFoundException', () => {
    const csproj = read('../../../printer-service/PrinterService.csproj');
    expect(csproj).toContain('<PublishSingleFile>true</PublishSingleFile>');
    expect(csproj).toContain('<SelfContained>true</SelfContained>');
    expect(csproj).toContain('<UseWPF>true</UseWPF>');
    expect(csproj).toContain('<IncludeNativeLibrariesForSelfExtract>true</IncludeNativeLibrariesForSelfExtract>');
    // The flag only has a meaning together with single-file publishing, so pin the pair.
    const singleFile = csproj.indexOf('<PublishSingleFile>');
    const selfExtract = csproj.indexOf('<IncludeNativeLibrariesForSelfExtract>');
    expect(selfExtract).toBeGreaterThan(singleFile);
  });
});

describe('sidecar Win32 DEVMODE & PrintTicket driver sync contract', () => {
  const interop = read('../../../printer-service/Services/WinSpoolInterop.cs');
  const program = read('../../../printer-service/Program.cs');
  const service = read('../../../printer-service/Services/PrinterSpoolerService.cs');

  it('defines per-user PRINTER_INFO_9, DC_MEDIATYPES, and DM_MEDIATYPE in WinSpoolInterop', () => {
    expect(interop).toContain('DC_MEDIATYPES = 35');
    expect(interop).toContain('DM_MEDIATYPE = 0x02000000');
    expect(interop).toContain('struct PRINTER_INFO_9');
    expect(interop).toContain('ref PRINTER_INFO_9 pPrinter');
    expect(interop).toContain('int dmMediaType');
  });

  it('wires printer:reload-profile and 2-pass DEVMODE + PrintTicketConverter validation in C# sidecar', () => {
    expect(program).toContain('"printer:reload-profile"');
    expect(service).toContain('using System.Printing.Interop;');
    expect(service).toContain('TryBuildConfiguredDevModeBytes');
    expect(service).toContain('TryWritePerUserDevMode');
    expect(service).toContain('BuildValidatedPrintTicket');
    expect(service).toContain('PrintTicketConverter');
    expect(service).toContain('queue.MergeAndValidatePrintTicket(ticket, new PrintTicket())');
    expect(service).not.toContain('ResolutionX');
    expect(service).not.toContain('ResolutionY');
  });

  it('serializes C# spooler RPC calls on STA threads and guards Electron against mid-job native crashes', () => {
    const client = read('../../../electron/printerSidecarClient.ts');
    const mainTs = read('../../../electron/main.ts');
    expect(program).toContain('RpcSerialGate');
    expect(program).toContain('ApartmentState.STA');
    expect(program).toContain('Dispatcher.FromThread');
    expect(client).toContain('RPC_PRINT_TIMEOUT_MS');
    expect(client).toContain("client.once('close'");
    expect(client).toContain('restartIfStopped');
    expect(mainTs).toContain('sidecar.restartIfStopped()');
    expect(mainTs).toContain('printToWindowsPrinterViaPowerShell(payload.request, tempImagePaths)');
  });
});


