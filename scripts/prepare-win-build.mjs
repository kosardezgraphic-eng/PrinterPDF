#!/usr/bin/env node
/**
 * Windows packaging pre-flight, run by `npm run build:electron` between compilation and
 * `electron-builder`. Two mistakes here are silent enough to be worth checking in code:
 *
 * 1. The repository is `"type": "module"`, so a `.js` file next to it is parsed as ESM. The main
 *    process is compiled to CommonJS (the format `require('electron')` and `__dirname` expect), so
 *    `dist-electron` needs its own `package.json` saying otherwise — otherwise the packaged app
 *    dies before the first window with "require is not defined".
 * 2. `electron-builder.yml` copies the published .NET sidecar out of `printer-service`, which is a
 *    build artefact and is not in Git. Without it the copy step fails with a bare ENOENT, so we
 *    print the exact command instead — and only skip the sidecar when that was asked for.
 * 3. A sandboxed BrowserWindow loads a bundled CommonJS preload only. The tsc output for
 *    electron/preload.ts is ESM with extension-less relative imports, so it must never be the
 *    file referenced by `webPreferences.preload` — esbuild's preload.cjs is.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

const fail = (message) => { console.error(`\n[win-build] ${message}\n`); process.exit(1); };

/* ── 1. module format of the compiled main process ───────────────────────────── */
const distElectron = path.join(root, 'dist-electron');
const mainEntry = 'dist-electron/electron/main.js';
if (!existsSync(path.join(root, mainEntry))) {
  fail(`no ${mainEntry} — run "tsc -p tsconfig.electron.json" first (npm run build:electron does it for you)`);
}
// The preload is not tsc output: it must be the esbuild CommonJS bundle, because a sandboxed
// renderer cannot load an ESM preload (and reports no printStudioAPI at all if it tries).
if (!existsSync(path.join(distElectron, 'electron', 'preload.cjs'))) {
  fail('no dist-electron/electron/preload.cjs — run "npm run build:preload" (npm run build:electron does it for you); without it the window has no printStudioAPI and every printer call fails');
}
const pkgMain = JSON.parse(read('package.json')).main;
if (pkgMain !== mainEntry) {
  fail(`package.json "main" is "${pkgMain}" but Electron needs "${mainEntry}" (tsc keeps the electron/ folder because rootDir is the repo root)`);
}
writeFileSync(path.join(distElectron, 'package.json'), `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`);

/* ── 2. the .NET sidecar that electron-builder copies ───────────────────────── */
const yml = read('electron-builder.yml');
const from = /extraResources:\s*\n\s*-\s*from:\s*(\S+)/m.exec(yml)?.[1];
if (!from) fail('could not find extraResources.from in electron-builder.yml — the sidecar would silently not be packaged');
const sidecarDir = path.join(root, from);
const sidecarExe = path.join(sidecarDir, 'PrinterService.exe');
const allowMissing = process.argv.includes('--allow-missing-sidecar');

if (!existsSync(sidecarExe)) {
  if (!allowMissing) {
    fail(`no PrinterService.exe in ${from}
  build it first (Windows + .NET 8 SDK):
    npm run build:service
  or skip the sidecar to produce an app that merges, imposes and exports PDF but cannot
  query printers or spool jobs — it reports margins as "unavailable":
    npm run build:electron:nosidecar`);
  }
  mkdirSync(sidecarDir, { recursive: true });
  writeFileSync(
    path.join(sidecarDir, 'PRINTSTUDIO-NO-SIDECAR.txt'),
    'Placeholder created by scripts/prepare-win-build.mjs (--allow-missing-sidecar).\n' +
    'The C# print sidecar was not published, so printer enumeration, hard margins and job\n' +
    'spooling stay unavailable at runtime. Run "npm run build:service" and rebuild for them.\n',
  );
  console.warn(`[win-build] packaging without the print sidecar (${from})`);
} else {
  console.log(`[win-build] sidecar: ${from}`);
}
console.log('[win-build] ready for electron-builder');
