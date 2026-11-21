#!/usr/bin/env node
/**
 * Marks the compiled main-process output as CommonJS.
 *
 * The repository is `"type": "module"`, so Node parses every `.js` file under it as ESM — including
 * `dist-electron/electron/main.js`, which `tsc -p tsconfig.electron.json` emits as CommonJS
 * (`require`, `exports`, `__dirname`). Without a `{"type":"commonjs"}` package.json inside
 * `dist-electron`, `electron .` dies before the first window with:
 *
 *     ReferenceError: exports is not defined in ES module scope
 *
 * `npm run electron:dev` used to skip this step (only the packaging pre-flight wrote the shim), so
 * the dev app never started at all — this script puts the shim on both paths.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const distElectron = path.join(root, 'dist-electron');
const mainEntry = path.join(distElectron, 'electron', 'main.js');

if (!existsSync(mainEntry)) {
  console.error(
    `[electron-shim] no ${path.relative(root, mainEntry)} — run "npm run build:electron-main" first`,
  );
  process.exit(1);
}

mkdirSync(distElectron, { recursive: true });
writeFileSync(
  path.join(distElectron, 'package.json'),
  `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`,
);
console.log('[electron-shim] dist-electron is CommonJS');
