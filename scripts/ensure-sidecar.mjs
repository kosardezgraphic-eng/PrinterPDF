#!/usr/bin/env node
/**
 * Builds printer-service/PrinterService.exe when it is missing, so `npm run electron:dev` does not
 * silently fall back to an empty printer list.
 *
 * This never fails the dev run: when the .NET SDK is absent, or the platform is not Windows, the
 * app still starts and the sidecar client reports the exact reason (missing executable, wrong OS)
 * in the printer area instead of showing a blank list.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const project = path.join(repoRoot, 'printer-service', 'PrinterService.csproj');
const publishDir = path.join(
  repoRoot,
  'printer-service',
  'bin',
  'Release',
  'net8.0-windows',
  'win-x64',
  'publish'
);
const exePath = path.join(publishDir, 'PrinterService.exe');

function note(message) {
  console.log(`[ensure-sidecar] ${message}`);
}

if (existsSync(exePath)) {
  note(`PrinterService.exe is present: ${exePath}`);
  process.exit(0);
}

if (process.platform !== 'win32') {
  note(
    `skipped: the print sidecar only runs on Windows (this system is "${process.platform}"). ` +
      'The desktop app is not usable here; the browser preview will show simulated printers.'
  );
  process.exit(0);
}

const dotnet = spawnSync('dotnet', ['--version'], { encoding: 'utf8', shell: true });
if (dotnet.status !== 0) {
  note(
    'PrinterService.exe is missing and the "dotnet" CLI was not found. Install the .NET 8 SDK, ' +
      'then run: npm run build:service'
  );
  process.exit(0);
}

note(`PrinterService.exe is missing — publishing with .NET ${dotnet.stdout.trim()} (first run restores packages, this takes a minute)`);
try {
  execFileSync(
    'dotnet',
    ['publish', project, '-c', 'Release', '-r', 'win-x64', '--self-contained', 'true'],
    { cwd: repoRoot, stdio: 'inherit', shell: true }
  );
} catch {
  note('dotnet publish failed — fix the C# build before the printer list can work.');
  process.exit(1);
}

if (!existsSync(exePath)) {
  note(`dotnet publish reported success but ${exePath} is still missing.`);
  process.exit(1);
}
note(`built ${exePath}`);
