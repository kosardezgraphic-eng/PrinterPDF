// @vitest-environment node
/**
 * Packaging contract for the Windows build.
 *
 * `npm run build:electron` fails *silently* if the compiled main process and the paths written
 * into `package.json` / `electron-builder.yml` drift apart: the installer builds, and the app dies
 * on the user's machine. These assertions cost nothing and read only committed files, so they run
 * in the normal suite on any platform — including where Electron itself cannot be downloaded.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const json = <T,>(rel: string): T => JSON.parse(read(rel)) as T;

const pkg = json<{ main: string; type?: string; scripts: Record<string, string> }>('../../../package.json');
const electronTsconfig = json<{ compilerOptions: { outDir: string; rootDir: string; module: string } }>('../../../tsconfig.electron.json');
const builder = read('../../../electron-builder.yml');
const mainProcess = read('../../../electron/main.ts');

describe('windows packaging layout', () => {
  it('points package.json at the file tsc actually emits', () => {
    // rootDir is the repo root and both electron/ and shared/ are inputs, so the output keeps the folder.
    const emitted = path.posix.join(electronTsconfig.compilerOptions.outDir, 'electron', 'main.js');
    expect(electronTsconfig.compilerOptions.rootDir).toBe('.');
    expect(pkg.main).toBe(emitted);
  });

  it('compiles the main process to CommonJS because the repository is type:module', () => {
    expect(pkg.type).toBe('module');
    expect(electronTsconfig.compilerOptions.module).toBe('CommonJS');
    // The build therefore has to mark the output folder as CommonJS, or `require` is undefined.
    expect(read('../../../scripts/prepare-win-build.mjs')).toContain("type: 'commonjs'");
    expect(pkg.scripts['build:electron']).toContain('prepare-win-build.mjs');
  });

  it('resolves the renderer and the preload from the packed layout', () => {
    const mainDir = path.posix.dirname(pkg.main);
    // A sandboxed renderer can only load a bundled CommonJS preload, never a .js emitted as ESM.
    expect(mainProcess).toContain(`path.join(__dirname, 'preload.cjs')`);
    expect(mainProcess).toContain('sandbox: true');
    expect(mainProcess).toContain('contextIsolation: true');
    const preloadBuild = pkg.scripts['build:preload'];
    expect(preloadBuild).toContain('electron/preload.ts');
    expect(preloadBuild).toContain('--format=cjs');
    expect(preloadBuild).toContain('--bundle');
    expect(preloadBuild).toContain('--external:electron');
    expect(preloadBuild).toContain(path.posix.join('dist-electron', 'electron', 'preload.cjs'));
    for (const script of ['build:electron', 'build:electron:nosidecar']) {
      expect(pkg.scripts[script]).toContain('build:preload');
    }
    const index = /loadFile\(path\.join\(__dirname, '([^']+)'\)\)/.exec(mainProcess)?.[1];
    expect(path.posix.normalize(path.posix.join(mainDir, index!))).toBe('dist/index.html');
    const files = /files:\s*\n((?:\s*-\s*\S+\n)+)/.exec(builder)?.[1] ?? '';
    expect(files).toContain('dist/**/*');
    expect(files).toContain('dist-electron/**/*');   // the compiled main process, shim included
  });

  it('copies the sidecar from the folder the C# project publishes to', () => {
    expect(pkg.scripts['build:service']).toContain('-r win-x64');
    expect(pkg.scripts['build:service']).toContain('--self-contained true');
    const csproj = read('../../../printer-service/PrinterService.csproj');
    const framework = /<TargetFramework>([^<]+)</.exec(csproj)?.[1];
    const rid = /<RuntimeIdentifier>([^<]+)</.exec(csproj)?.[1];
    const from = /extraResources:\s*\n\s*-\s*from:\s*(\S+)/m.exec(builder)?.[1];
    expect(framework).toBeTruthy();
    expect(from).toBe(`printer-service/bin/Release/${framework}/${rid}/publish`);
    // Losing the sidecar must be a loud build error, never a silent runtime surprise.
    const prepare = read('../../../scripts/prepare-win-build.mjs');
    // The pre-flight refuses to package without the CommonJS preload bundle, not the tsc .js.
    expect(prepare).toContain('build:preload');
    expect(prepare).toContain("electron', 'preload.cjs'");
    expect(pkg.scripts['build:service']).toContain('dotnet publish printer-service/PrinterService.csproj');
  });

  it('keeps the icon and association setup out of the way of a first build', () => {
    // No build/icon.ico is committed: electron-builder then uses its default icon and only warns.
    expect(builder).not.toMatch(/^\s*icon:/m);
    expect(builder).toContain('ext: psp');
  });
});
