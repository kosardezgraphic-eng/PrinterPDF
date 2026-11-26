// @vitest-environment node
/**
 * Native file entry points. The desktop bridge is faked here; the point of the tests is that a
 * browser without the bridge behaves exactly as before, and that a path-only hand-off from
 * Explorer or the command line ends up as a readable `File`.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocalFilePayload } from '@shared/ipc-channels';
import {
  baseName,
  fileFromPayload,
  filesFromPaths,
  listenForNativeOpenFiles,
  mimeFromPath,
  nativeBridge,
} from './nativeFiles';

type Listener = (paths: string[]) => void;

function stubBridge(payloads: Record<string, LocalFilePayload | Error>) {
  const listeners: Listener[] = [];
  const readLocalFile = vi.fn(async (path: string) => {
    const entry = payloads[path];
    if (!entry) throw new Error(`no fixture for ${path}`);
    if (entry instanceof Error) throw entry;
    return entry;
  });
  const window = {
    printStudioAPI: {
      readLocalFile,
      onCliOpenFiles: (callback: Listener) => {
        listeners.push(callback);
        return () => {
          const index = listeners.indexOf(callback);
          if (index >= 0) listeners.splice(index, 1);
        };
      },
    },
  };
  vi.stubGlobal('window', window);
  return { listeners, readLocalFile };
}

const payload = (path: string, name: string, text: string): LocalFilePayload => ({
  name,
  path,
  size: text.length,
  mimeType: mimeFromPath(name),
  bytes: new TextEncoder().encode(text),
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('native file bridge', () => {
  it('is absent in a browser and never opens anything by path', () => {
    expect(nativeBridge()).toBeUndefined();
    expect(listenForNativeOpenFiles(() => {})).toBeTypeOf('function');
    expect(listenForNativeOpenFiles(() => {})()).toBeUndefined();
    return expect(filesFromPaths(['/tmp/a.pdf'])).rejects.toThrow('Opening a file by path needs the desktop app');
  });

  it('maps extensions to the MIME types the importer understands', () => {
    expect(mimeFromPath('C:\\Users\\mina\\Scan.PNG')).toBe('image/png');
    expect(mimeFromPath('/home/mina/album.JPEG')).toBe('image/jpeg');
    expect(mimeFromPath('/tmp/deck.pdf')).toBe('application/pdf');
    expect(mimeFromPath('/tmp/sheet.tiff')).toBe('image/tiff');
    expect(mimeFromPath('/tmp/no-extension')).toBe('application/octet-stream');
    expect(baseName('C:\\Users\\mina\\Scan.PNG')).toBe('Scan.PNG');
    expect(baseName('/home/mina/a/b.pdf')).toBe('b.pdf');
  });

  it('turns the payload read in the main process into a real File', async () => {
    const file = fileFromPayload(payload('/tmp/a.png', 'a.png', 'bytes'));
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('a.png');
    expect(file.type).toBe('image/png');
    expect(new TextDecoder().decode(await file.arrayBuffer())).toBe('bytes');
  });

  it('imports files the OS passed as paths', async () => {
    const { listeners, readLocalFile } = stubBridge({ 'C:\\in\\a.png': payload('C:\\in\\a.png', 'a.png', 'png!'), '/in/b.pdf': payload('/in/b.pdf', 'b.pdf', 'pdf!') });
    const seen: File[][] = [];
    listenForNativeOpenFiles(files => { seen.push(files); });
    expect(listeners).toHaveLength(1);
    listeners[0]!(['C:\\in\\a.png', '/in/b.pdf']);
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(readLocalFile).toHaveBeenCalledTimes(2);
    expect(seen[0]!.map(file => `${file.name}:${file.type}`)).toEqual(['a.png:image/png', 'b.pdf:application/pdf']);
    expect(await seen[0]![0]!.text()).toBe('png!');
  });

  it('reports a read failure instead of swallowing it', async () => {
    const { listeners } = stubBridge({ '/in/broken.png': new Error('File is larger than 128 MB') });
    const onFiles = vi.fn();
    const onError = vi.fn();
    listenForNativeOpenFiles(onFiles, onError);
    listeners[0]!(['/in/broken.png']);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError.mock.calls[0]![0]).toBeInstanceOf(Error);
    expect(onFiles).not.toHaveBeenCalled();
    listeners[0]!([]);                     // an empty drop is not an error, just nothing to do
    await Promise.resolve();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('stops listening when the caller unsubscribes', async () => {
    const { listeners } = stubBridge({ '/in/a.png': payload('/in/a.png', 'a.png', 'x') });
    const onFiles = vi.fn();
    const stop = listenForNativeOpenFiles(onFiles);
    stop();
    expect(listeners).toHaveLength(0);
    listeners[0]?.(['/in/a.png']);        // a stale event must not reach a torn-down app
    await Promise.resolve();
    expect(onFiles).not.toHaveBeenCalled();
  });
});

/**
 * The Electron side cannot be launched in this environment, so the wiring is pinned to the source:
 * a channel that stops being handled, or a job file that stops being deleted, fails here.
 */
describe('desktop wiring', () => {
  const main = readFileSync(new URL('../../../electron/main.ts', import.meta.url), 'utf8');
  const preload = readFileSync(new URL('../../../electron/preload.ts', import.meta.url), 'utf8');

  it('reads, forwards and cleans up after native files', () => {
    expect(main).toContain('IPC_CHANNELS.FILE_READ_LOCAL');
    expect(main).toContain('stats.isFile()');
    expect(main).toContain('MAX_NATIVE_FILE_BYTES');
    expect(main).toContain('IPC_CHANNELS.CLI_OPEN_FILES');
    expect(main).toContain('fileArguments(process.argv.slice(1))');
    expect(main).toMatch(/finally\(\) =>|finally \{/);
    expect(main).toContain('fs.rm(tempPdfPath');
    expect(preload).toContain('readLocalFile: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_READ_LOCAL, path)');
    expect(preload).toContain('onCliOpenFiles:');
    expect(preload).toContain('removeListener(IPC_CHANNELS.CLI_OPEN_FILES');
  });

  it('lets the renderer subscribe once and unsubscribe on unmount', () => {
    const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
    expect(app).toContain('listenForNativeOpenFiles');
    expect(app).toContain('return stop;');
  });
});
