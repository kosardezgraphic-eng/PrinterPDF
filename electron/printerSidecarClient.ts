import net from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import type {
  JsonRpcRequest,
  JsonRpcResponse,
} from '../shared/ipc-channels';
import type {
  PrinterInfo,
  PrinterProfileSettings,
  PrintJobRequest,
  SpoolerJobInfo,
} from '../shared/models';

const PIPE_PATH = '\\\\.\\pipe\\PrintStudioPrinterService';

/**
 * Manages the lifecycle of the C# (.NET 8) PrinterService.exe sidecar
 * and communicates with it over Windows Named Pipe using JSON-RPC 2.0.
 */
export class PrinterSidecarClient {
  private child: ChildProcess | null = null;
  private reqCounter = 1;

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
      return;
    }

    this.child = spawn(exePath, [], {
      stdio: 'ignore',
      windowsHide: true,
    });

    this.child.on('error', () => {
      this.child = null;
    });
  }

  public stopSidecar(): void {
    if (this.child && !this.child.killed) {
      this.child.kill();
      this.child = null;
    }
  }

  public async callRpc<TResult>(method: string, params: unknown = {}): Promise<TResult> {
    const id = this.reqCounter++;
    const payload: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise<TResult>((resolve, reject) => {
      const client = net.connect(PIPE_PATH, () => {
        client.write(JSON.stringify(payload) + '\n', 'utf8');
      });

      let buffer = '';
      const timer = setTimeout(() => {
        client.destroy();
        reject(new Error(`Named pipe RPC timeout on method ${method}`));
      }, 4000);

      client.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        const newlineIndex = buffer.indexOf('\n');
        if (newlineIndex !== -1) {
          clearTimeout(timer);
          const line = buffer.slice(0, newlineIndex).trim();
          client.end();
          try {
            const parsed = JSON.parse(line) as JsonRpcResponse<TResult>;
            if (parsed.error) {
              reject(new Error(parsed.error.message));
            } else {
              resolve(parsed.result as TResult);
            }
          } catch (err) {
            reject(err);
          }
        }
      });

      client.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  public async listPrinters(): Promise<PrinterInfo[]> {
    return this.callRpc<PrinterInfo[]>('printer:list');
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
