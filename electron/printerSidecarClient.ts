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
  PrinterMarginRequest,
  PrinterMarginResult,
  PrinterProfileSettings,
  PrintJobRequest,
  SpoolerJobInfo,
} from '../shared/models';

const PIPE_PATH = '\\\\.\\pipe\\PrintStudioPrinterService';
/** How many stderr chunks of the child process are remembered for diagnostics. */
const STDERR_TAIL_LINES = 40;

/**
 * Manages the lifecycle of the C# (.NET 8) PrinterService.exe sidecar
 * and communicates with it over Windows Named Pipe using JSON-RPC 2.0.
 */
export class PrinterSidecarClient {
  private child: ChildProcess | null = null;
  private reqCounter = 1;
  /**
   * Why the sidecar is not answering, in terms an operator can act on. An empty printer list is
   * never a diagnosis, so every early return below records what it found instead.
   */
  private startupError: string | null = null;
  /** A reason that makes the named pipe pointless to try: wrong OS, or no executable to run. */
  private blocked: string | null = null;
  private readonly stderrTail: string[] = [];

  /** The places PrinterService.exe is looked for, kept in one place for the messages. */
  private exeCandidates(resourcesPath: string): string[] {
    return [
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
  }

  public startSidecar(resourcesPath: string): void {
    this.startupError = null;
    this.blocked = null;

    if (process.platform !== 'win32') {
      this.blocked = `The print sidecar only runs on Windows (this system reports "${process.platform}").`;
      this.startupError = this.blocked;
      return;
    }

    const candidates = this.exeCandidates(resourcesPath);
    const exePath = candidates.find((candidate) => fs.existsSync(candidate));
    if (!exePath) {
      this.blocked =
        `PrinterService.exe was not found. Build it with "npm run build:service" (needs the .NET 8 SDK); looked in ${candidates.join(' and ')}.`;
      this.startupError = this.blocked;
      return;
    }

    // stderr is the only place the service reports a spooler or pipe-binding failure, and losing
    // it is why a missing printer list used to be undiagnosable.
    this.child = spawn(exePath, [], {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });

    this.child.stderr?.setEncoding('utf8');
    this.child.stderr?.on('data', (chunk: string) => {
      this.stderrTail.push(chunk);
      if (this.stderrTail.length > STDERR_TAIL_LINES) this.stderrTail.shift();
    });

    this.child.on('error', (error) => {
      this.startupError = `PrinterService.exe could not be started from ${exePath}: ${error.message}`;
      this.child = null;
    });

    this.child.on('exit', (code, signal) => {
      const tail = this.stderrTail.join('').trim();
      this.startupError =
        `PrinterService.exe stopped before the app connected (exit code ${code ?? 'unknown'}${signal ? `, signal ${signal}` : ''}).` +
        (tail ? ` Last output:\n${tail}` : ' It wrote nothing to stderr.');
      this.child = null;
    });
  }

  public stopSidecar(): void {
    if (this.child && !this.child.killed) {
      this.child.kill();
      this.child = null;
    }
  }

  /** True while the spawned process is alive, i.e. the app is not waiting for something to start. */
  public get isRunning(): boolean {
    return this.child !== null && !this.child.killed;
  }

  /**
   * Set when asking the sidecar anything is known to be futile, so the app answers immediately
   * instead of waiting four seconds for a pipe that nobody owns.
   */
  public get blockedReason(): string | null {
    return this.blocked;
  }

  /** A single multi-line explanation to show instead of an empty printer list. */
  public describeFailure(error: unknown): string {
    const reason = error instanceof Error ? error.message : String(error);
    const lines = [reason];
    if (this.startupError) lines.push(`Sidecar: ${this.startupError}`);
    else if (this.isRunning) lines.push('Sidecar: process is running but the named pipe did not answer.');
    const tail = this.stderrTail.join('').trim();
    if (tail && !this.startupError) lines.push(`Service output:\n${tail}`);
    return lines.join('\n');
  }

  /** The same message on its own, for the status panel when no call has failed yet. */
  public statusNote(): string | null {
    if (this.isRunning) return null;
    return this.startupError ?? 'The print sidecar is not running.';
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

      client.on('error', (err: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        // EPIPE/ENOENT both mean nobody owns the pipe: say so, and keep the underlying code.
        const hint = err.code === 'ENOENT' || err.code === 'EACCES' || err.code === 'EPERM'
          ? `no process is listening on ${PIPE_PATH}`
          : `cannot reach ${PIPE_PATH}`;
        reject(new Error(`${hint} (${err.message})`));
      });
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
