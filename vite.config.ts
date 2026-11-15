import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import {
  queryWindowsPrintersViaPowerShell,
  queryWindowsSpoolerJobsViaPowerShell,
  setWindowsDefaultPrinterViaPowerShell,
} from './electron/windowsPrinterFallback';

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

    middlewares.use('/api/windows-set-default-printer', (req, res) => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      if (process.platform !== 'win32' || req.method !== 'POST') {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false }));
        return;
      }
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf8');
      });
      req.on('end', async () => {
        try {
          const parsed = JSON.parse(body || '{}') as { printerName?: string };
          const ok = parsed.printerName
            ? await setWindowsDefaultPrinterViaPowerShell(parsed.printerName)
            : false;
          res.end(JSON.stringify({ ok }));
        } catch {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false }));
        }
      });
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
