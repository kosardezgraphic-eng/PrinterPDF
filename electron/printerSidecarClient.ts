import net from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import type {
  JsonRpcRequest,
  JsonRpcResponse,
} from '../shared/ipc-channels.js';
import type {
  PrinterInfo,
  PrinterMarginRequest,
  PrinterMarginResult,
  PrinterProfileSettings,
  PrintJobRequest,
  SpoolerJobInfo,
} from '../shared/models.js';

const PIPE_PATH = '\\\\.\\pipe\\PrintStudioPrinterService';

/**
 * Manages the lifecycle of the C# (.NET 8) PrinterService.exe sidecar
 * and communicates with it over Windows Named Pipe using JSON-RPC 2.0.
 */
export class PrinterSidecarClient {
  private child: ChildProcess | null = null;
  private reqCounter = 1;
  private startupError: string | null = null;

  public startSidecar(resourcesPath: string): void {
    if (process.platform !== 'win32') {
      return;
    }

    const exeCandidates = [
      path.join(resourcesPath, 'printer-service', 'PrinterService.exe'),
      path.join(
        process.cwd(),
        'printer-service',
        'bin',
        'Release',
        'net8.0-windows',
        'win-x64',
        'publish',
        'PrinterService.exe'
      ),
    ];

    const exePath = exeCandidates.find((candidate) => fs.existsSync(candidate));
    if (!exePath) {
      this.startupError = [
        'PrinterService.exe was not found.',
        'Expected it in the packaged resources/printer-service folder or printer-service/bin/Release/net8.0-windows/win-x64/publish.',
        'Run dotnet publish before building the installer and rebuild the application.',
      ].join(' ');
      return;
    }

    this.startupError = null;

    this.child = spawn(exePath, [], {
      stdio: 'ignore',
      windowsHide: true,
    });

    this.child.on('error', (error) => {
      this.startupError = `Could not start PrinterService.exe: ${error.message}`;
      this.child = null;
    });
    this.child.on('exit', (code, signal) => {
      if (this.child) {
        this.startupError = `PrinterService.exe stopped (code=${code ?? 'null'}, signal=${signal ?? 'none'}).`;
        this.child = null;
      }
    });
  }

  public stopSidecar(): void {
    if (this.child && !this.child.killed) {
      this.child.kill();
      this.child = null;
    }
  }

  public async callRpc<TResult>(method: string, params: unknown = {}): Promise<TResult> {
    if (this.startupError) throw new Error(this.startupError);
    if (!this.child || this.child.exitCode !== null) {
      throw new Error('PrinterService.exe is not running. Restart PrintStudio Pro after rebuilding the printer service.');
    }
    const id = this.reqCounter++;
    const payload: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };

    // The renderer can request printers immediately after Electron spawns the .NET sidecar.
    // Retry transient named-pipe connection errors while the service creates its pipe.
    return new Promise<TResult>((resolve, reject) => {
      let attempt = 0;
      let settled = false;
      let activeClient: net.Socket | null = null;
      let responseBuffer = '';
      const maxAttempts = 24;
      const retryDelayMs = 150;
      const timeout = setTimeout(() => {
        settled = true;
        activeClient?.destroy();
        reject(new Error(`Printer service did not respond to ${method} within 8 seconds`));
      }, 8000);

      const finish = (error?: Error, value?: TResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) reject(error);
        else resolve(value as TResult);
      };

      const connect = () => {
        if (settled) return;
        attempt += 1;
        responseBuffer = '';
        const client = net.connect(PIPE_PATH);
        activeClient = client;

        client.once('connect', () => {
          client.write(JSON.stringify(payload) + '\n', 'utf8');
        });

        client.on('data', (chunk: Buffer) => {
          responseBuffer += chunk.toString('utf8');
          const newlineIndex = responseBuffer.indexOf('\n');
          if (newlineIndex === -1) return;
          const line = responseBuffer.slice(0, newlineIndex).trim();
          client.end();
          try {
            const parsed = JSON.parse(line) as JsonRpcResponse<TResult>;
            if (parsed.error) finish(new Error(parsed.error.message));
            else finish(undefined, parsed.result as TResult);
          } catch (error) {
            finish(error instanceof Error ? error : new Error(String(error)));
          }
        });

        client.once('error', (error) => {
          client.destroy();
          if (settled) return;
          if (attempt < maxAttempts) {
            setTimeout(connect, retryDelayMs);
          } else {
            finish(new Error(`Cannot connect to Windows Print Spooler service: ${error.message}`));
          }
        });
      };

      connect();
    });
  }

  public async listPrinters(): Promise<PrinterInfo[]> {
    return this.callRpc<PrinterInfo[]>('printer:list');
  }

  public async getPrinterMargins(request: PrinterMarginRequest): Promise<PrinterMarginResult> {
    return this.callRpc<PrinterMarginResult>('printer:get-margins', request);
  }

  public async updateProfile(
    printerName: string,
    profile: PrinterProfileSettings
  ): Promise<PrinterInfo> {
    return this.callRpc<PrinterInfo>('printer:update-profile', {
      ...profile,
      printerName,
    });
  }

  public async setDefaultPrinter(printerName: string): Promise<boolean> {
    return this.callRpc<boolean>('printer:set-default', { printerName });
  }

  public async listSpoolerJobs(printerName?: string): Promise<SpoolerJobInfo[]> {
    return this.callRpc<SpoolerJobInfo[]>('spooler:list-jobs', { printerName });
  }

  public async controlSpoolerJob(
    printerName: string,
    jobId: number,
    action: 'pause' | 'resume' | 'restart' | 'cancel',
    priority?: number
  ): Promise<boolean> {
    return this.callRpc<boolean>('spooler:control-job', {
      printerName,
      jobId,
      action,
      priority,
    });
  }

  public async purgeQueue(printerName: string): Promise<boolean> {
    return this.callRpc<boolean>('spooler:purge-queue', { printerName });
  }

  public async submitPrintJob(
    request: PrintJobRequest,
    pdfFilePath?: string
  ): Promise<SpoolerJobInfo> {
    return this.callRpc<SpoolerJobInfo>('printer:print-job', {
      ...request,
      pdfFilePath,
    });
  }
}
