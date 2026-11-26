import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import {
  printToWindowsPrinterViaPowerShell,
  queryWindowsPrinterMarginsViaPowerShell,
  queryWindowsPrintersViaPowerShell,
  queryWindowsSpoolerJobsViaPowerShell,
  setWindowsDefaultPrinterViaPowerShell,
} from './electron/windowsPrinterFallback';
import { listInstalledSystemFonts } from './electron/systemFonts';
import type { PrinterMarginRequest, PrintJobRequest } from './shared/models';

function readJsonBody<T>(req: { on: (event: string, cb: (chunk?: any) => void) => void }): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8') || '{}';
        resolve(JSON.parse(text) as T);
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function windowsPrinterBridgePlugin(): Plugin {
  const attach = (middlewares: { use: (path: string, handler: (req: any, res: any, next: () => void) => void) => void }) => {
    middlewares.use('/api/windows-printers', async (_req, res) => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      if (process.platform !== 'win32') {
        res.end(
          JSON.stringify({
            supported: false,
            platform: process.platform,
            printers: [],
            note: `Web server host is running on "${process.platform}" (not Windows). Local Windows printers cannot be read from a non-Windows or cloud browser preview.`,
          })
        );
        return;
      }
      try {
        const printers = await queryWindowsPrintersViaPowerShell();
        res.end(
          JSON.stringify({
            supported: true,
            platform: 'win32',
            printers,
            note: null,
          })
        );
      } catch (error) {
        res.statusCode = 500;
        res.end(
          JSON.stringify({
            supported: true,
            platform: 'win32',
            printers: [],
            error: error instanceof Error ? error.message : String(error),
          })
        );
      }
    });

    middlewares.use('/api/windows-spooler-jobs', async (req, res) => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      if (process.platform !== 'win32') {
        res.end(JSON.stringify({ supported: false, jobs: [] }));
        return;
      }
      try {
        const url = new URL(req.url || '/', 'http://localhost');
        const printerName = url.searchParams.get('printerName') || undefined;
        const jobs = await queryWindowsSpoolerJobsViaPowerShell(printerName);
        res.end(JSON.stringify({ supported: true, jobs }));
      } catch {
        res.end(JSON.stringify({ supported: true, jobs: [] }));
      }
    });

    middlewares.use('/api/windows-margins', async (req, res) => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      if (process.platform !== 'win32' || req.method !== 'POST') {
        res.end(JSON.stringify({ status: 'unavailable', reason: 'Windows printer host required' }));
        return;
      }
      try {
        const request = await readJsonBody<PrinterMarginRequest>(req);
        const result = await queryWindowsPrinterMarginsViaPowerShell(request);
        res.end(JSON.stringify(result));
      } catch (error) {
        res.end(
          JSON.stringify({
            status: 'unavailable',
            reason: error instanceof Error ? error.message : String(error),
          })
        );
      }
    });

    middlewares.use('/api/windows-print-job', async (req, res) => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      if (process.platform !== 'win32' || req.method !== 'POST') {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Direct Windows spooler printing requires Windows host.' }));
        return;
      }
      const tempImagePaths: string[] = [];
      try {
        const body = await readJsonBody<{
          request: PrintJobRequest;
          pageImagesBase64?: string[];
        }>(req);
        const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        for (let i = 0; i < (body.pageImagesBase64?.length ?? 0); i++) {
          const p = path.join(os.tmpdir(), `printstudio-http-${stamp}-${i + 1}.png`);
          await fs.writeFile(p, Buffer.from(body.pageImagesBase64![i], 'base64'));
          tempImagePaths.push(p);
        }
        const job = await printToWindowsPrinterViaPowerShell(body.request, tempImagePaths);
        res.end(JSON.stringify(job));
      } catch (error) {
        res.statusCode = 500;
        res.end(
          JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          })
        );
      } finally {
        await Promise.all(
          tempImagePaths.map((p) => fs.rm(p, { force: true }).catch(() => undefined))
        );
      }
    });

    middlewares.use('/api/windows-set-default-printer', async (req, res) => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      if (process.platform !== 'win32' || req.method !== 'POST') {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false }));
        return;
      }
      try {
        const parsed = await readJsonBody<{ printerName?: string }>(req);
        const ok = parsed.printerName
          ? await setWindowsDefaultPrinterViaPowerShell(parsed.printerName)
          : false;
        res.end(JSON.stringify({ ok }));
      } catch {
        res.statusCode = 500;
        res.end(JSON.stringify({ ok: false }));
      }
    });

    middlewares.use('/api/system-fonts', async (req, res) => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      try {
        const url = new URL(req.url || '/', 'http://localhost');
        const refresh = url.searchParams.get('refresh') === '1';
        const fonts = await listInstalledSystemFonts(refresh);
        res.end(JSON.stringify({ fonts }));
      } catch (error) {
        res.statusCode = 500;
        res.end(
          JSON.stringify({
            fonts: [],
            error: error instanceof Error ? error.message : String(error),
          })
        );
      }
    });
  };

  return {
    name: 'windows-printer-bridge',
    configureServer(server) {
      attach(server.middlewares);
    },
    configurePreviewServer(server) {
      attach(server.middlewares);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), windowsPrinterBridgePlugin()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@shared': path.resolve(__dirname, './shared'),
      '@app': path.resolve(__dirname, './app/src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
    cors: true,
    hmr: false,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['app/src/**/*.test.ts'],
  },
});
