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
/** Total time a call may spend connecting and waiting for the reply. */
const RPC_TIMEOUT_MS = 8000;
/** Gap between named-pipe connect attempts while the service is still starting. */
const CONNECT_RETRY_DELAY_MS = 150;

/**
 * Where the sidecar writes its own log: `%APPDATA%\PrintStudioPro\printer-service.log`
 * (see printer-service/Program.cs). The service is spawned without a console, so this file is the
 * only record of a crash nobody was watching — an exit code alone tells an operator nothing.
 */
function serviceLogPath(): string | null {
  if (process.platform !== 'win32') return null;
  const appData = process.env.APPDATA;
  if (!appData) return null;
  return path.join(appData, 'PrintStudioPro', 'printer-service.log');
}

/** Appended to every failure message: the file that has the full stack trace. */
function logHint(): string {
  const log = serviceLogPath();
  return log ? `\nService log: ${log}` : '';
}

/** Worded for the user: the pipe has no owner, which is a setup problem, not a bug in the app. */
function connectFailure(method: string, attempts: number, error: NodeJS.ErrnoException): string {
  const unwritable = error.code === 'ENOENT' || error.code === 'EACCES' || error.code === 'EPERM';
  const what = unwritable
    ? `no process is listening on ${PIPE_PATH}`
    : `cannot reach ${PIPE_PATH}`;
  return `${method} failed after ${attempts} attempt(s): ${what} (${error.message})`;
}

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
  /** Set once the app asked the sidecar to stop, so a normal quit is not read as a crash. */
  private stopping = false;
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
    this.stopping = false;
    this.stderrTail.length = 0;

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
      if (this.stopping) {
        this.child = null;
        return;
      }
      const tail = this.stderrTail.join('').trim();
      this.startupError =
        `PrinterService.exe stopped before the app connected (exit code ${code ?? 'unknown'}${signal ? `, signal ${signal}` : ''}).` +
        (tail
          ? ` Last output:\n${tail}`
          : // A native crash (0xC000041D from a missing WPF DLL, for instance) dies before the
            // runtime can print anything, so the file written by the process itself is the lead.
            ` Nothing was written to stderr; check ${serviceLogPath() ?? 'the sidecar log file'} for the crash record.`);
      this.child = null;
    });
  }

  public stopSidecar(): void {
    this.stopping = true;
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
   * instead of spending the whole retry window on a pipe that nobody owns.
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
    return lines.join('\n') + logHint();
  }

  /** The same message on its own, for the status panel when no call has failed yet. */
  public statusNote(): string | null {
    if (this.isRunning || this.stopping) return null;
    return (this.startupError ?? 'The print sidecar is not running.') + logHint();
  }

  public async callRpc<TResult>(method: string, params: unknown = {}): Promise<TResult> {
    // Answer with the reason instead of a four-second wait when the service cannot possibly reply.
    if (this.blocked) throw new Error(this.blocked);
    if (this.startupError) throw new Error(this.startupError);
    if (!this.child || this.child.exitCode !== null) {
      throw new Error('PrinterService.exe is not running. Restart PrintStudio Pro after rebuilding the printer service.');
    }

    const id = this.reqCounter++;
    const payload: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };

    // The renderer asks for printers as soon as it mounts, which is often before the .NET process
    // has created its pipe, so transient connect errors are retried. The deadline is absolute:
    // retrying without one turns a dead service into a hang.
    return new Promise<TResult>((resolve, reject) => {
      let attempt = 0;
      let settled = false;
      let activeClient: net.Socket | null = null;
      let responseBuffer = '';
      const deadline = Date.now() + RPC_TIMEOUT_MS;
      const timer = setTimeout(() => finish(new Error(this.describeFailure(`Named pipe RPC timeout on method ${method} after ${attempt} attempt(s)`))), RPC_TIMEOUT_MS);

      const finish = (error?: Error, value?: TResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        activeClient?.destroy();
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

        client.once('error', (error: NodeJS.ErrnoException) => {
          client.destroy();
          if (settled) return;
          if (Date.now() + CONNECT_RETRY_DELAY_MS < deadline) {
            setTimeout(connect, CONNECT_RETRY_DELAY_MS);
            return;
          }
          finish(new Error(this.describeFailure(connectFailure(method, attempt, error))));
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
