import { afterEach, describe, expect, it, vi } from 'vitest';
import { ipcBridge } from './ipcBridge';
import type { PrintStudioElectronAPI } from '@shared/ipc-channels';

afterEach(() => { vi.unstubAllGlobals(); });
describe('Electron bridge failures', () => {
  it('propagates sidecar errors rather than returning simulated printers or jobs', async () => {
    const error = new Error('pipe unavailable');
    const api = { isElectron: true, listPrinters: vi.fn().mockRejectedValue(error),
      listSpoolerJobs: vi.fn().mockRejectedValue(error),
      submitPrintJob: vi.fn().mockRejectedValue(error) } as unknown as PrintStudioElectronAPI;
    vi.stubGlobal('window', { printStudioAPI: api });
    await expect(ipcBridge.listPrinters()).rejects.toThrow('pipe unavailable');
    await expect(ipcBridge.listSpoolerJobs()).rejects.toThrow('pipe unavailable');
    await expect(ipcBridge.submitPrintJob({} as never, 1)).rejects.toThrow('pipe unavailable');
  });
  it('does not use the browser simulator when Electron preload is missing', async () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', { userAgent: 'Electron/34.0.0' });
    await expect(ipcBridge.listPrinters()).rejects.toThrow('preload bridge');
  });
  it('reads actual job list after a successful spooler operation', async () => {
    const listSpoolerJobs = vi.fn().mockResolvedValue([{ jobId: 7 }]);
    vi.stubGlobal('window', { printStudioAPI: { isElectron: true, controlSpoolerJob: vi.fn().mockResolvedValue(true), listSpoolerJobs } });
    expect(await ipcBridge.controlSpoolerJob('P', 7, 'pause')).toEqual([{ jobId: 7 }]);
    expect(listSpoolerJobs).toHaveBeenCalled();
  });
});

it('keeps printer lists empty and reports an initialization failure', async () => {
  const { useAppStore } = await import('../store/useAppStore');
  vi.stubGlobal('window', { printStudioAPI: { isElectron: true,
    listPrinters: vi.fn().mockRejectedValue(new Error('pipe unavailable')),
    listSpoolerJobs: vi.fn().mockRejectedValue(new Error('pipe unavailable')) } });
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  await useAppStore.getState().initializeWorkspace();
  expect(useAppStore.getState().printers).toEqual([]);
  expect(useAppStore.getState().spoolerJobs).toEqual([]);
  expect(useAppStore.getState().toasts.some(toast => toast.message?.includes('pipe unavailable'))).toBe(true);
  log.mockRestore();
});
