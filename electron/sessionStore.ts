import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import type { AppSettings, PspProjectFile } from '../shared/models';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

/**
 * Handles compressed .psp project files, Auto-save crash recovery,
 * and persistent AppSettings on disk.
 */
export class SessionStore {
  private readonly userDataDir: string;

  constructor(userDataDir: string) {
    this.userDataDir = userDataDir;
  }

  private get autoSavePath(): string {
    return path.join(this.userDataDir, 'autosave-session.psp');
  }

  private get settingsPath(): string {
    return path.join(this.userDataDir, 'settings.json');
  }

  public async writePspFile(filePath: string, project: PspProjectFile): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const rawJson = JSON.stringify(project);
    const compressed = await gzip(Buffer.from(rawJson, 'utf8'));
    await fs.writeFile(filePath, compressed);
  }

  public async readPspFile(filePath: string): Promise<PspProjectFile | null> {
    try {
      const buf = await fs.readFile(filePath);
      const decompressed = await gunzip(buf);
      return JSON.parse(decompressed.toString('utf8')) as PspProjectFile;
    } catch {
      return null;
    }
  }

  public async writeAutoSave(project: PspProjectFile): Promise<boolean> {
    try {
      await this.writePspFile(this.autoSavePath, project);
      return true;
    } catch {
      return false;
    }
  }

  public async readAutoSave(): Promise<PspProjectFile | null> {
    return this.readPspFile(this.autoSavePath);
  }

  public async saveSettings(settings: AppSettings): Promise<boolean> {
    try {
      await fs.mkdir(this.userDataDir, { recursive: true });
      await fs.writeFile(this.settingsPath, JSON.stringify(settings, null, 2), 'utf8');
      return true;
    } catch {
      return false;
    }
  }

  public async loadSettings(): Promise<AppSettings | null> {
    try {
      const content = await fs.readFile(this.settingsPath, 'utf8');
      return JSON.parse(content) as AppSettings;
    } catch {
      return null;
    }
  }
}
