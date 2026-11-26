import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { sanitizeSettingsPresetList } from '../shared/models.js';
import type {
  AppSettings,
  LithoJobPreset,
  LithoPlateSizePreset,
  PspProjectFile,
  SettingsPreset,
  VirtualPrinterConfig,
} from '../shared/models.js';

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

  private get presetsPath(): string {
    return path.join(this.userDataDir, 'settings-presets.json');
  }

  /**
   * Presets live in their own file, not inside settings.json, so that "reset everything to the
   * defaults" can wipe the live settings without destroying the profiles the operator saved on purpose.
   */
  public async saveSettingsPresets(presets: SettingsPreset[]): Promise<boolean> {
    try {
      await fs.mkdir(this.userDataDir, { recursive: true });
      await fs.writeFile(this.presetsPath, JSON.stringify(presets, null, 2), 'utf8');
      return true;
    } catch {
      return false;
    }
  }

  public async loadSettingsPresets(): Promise<SettingsPreset[]> {
    try {
      const content = await fs.readFile(this.presetsPath, 'utf8');
      return sanitizeSettingsPresetList(JSON.parse(content));
    } catch {
      // A missing file is the normal case on a first run; a broken one is treated the same way.
      return [];
    }
  }

  private get lithoPresetsPath(): string {
    return path.join(this.userDataDir, 'litho-presets.json');
  }

  public async saveLithoPresets(presets: LithoJobPreset[]): Promise<boolean> {
    try {
      await fs.mkdir(this.userDataDir, { recursive: true });
      await fs.writeFile(this.lithoPresetsPath, JSON.stringify(presets, null, 2), 'utf8');
      return true;
    } catch {
      return false;
    }
  }

  public async loadLithoPresets(): Promise<LithoJobPreset[] | null> {
    try {
      const content = await fs.readFile(this.lithoPresetsPath, 'utf8');
      const parsed = JSON.parse(content);
      return Array.isArray(parsed) ? (parsed as LithoJobPreset[]) : null;
    } catch {
      return null;
    }
  }

  private get lithoPlateSizesPath(): string {
    return path.join(this.userDataDir, 'litho-plate-sizes.json');
  }

  public async saveLithoPlateSizes(sizes: LithoPlateSizePreset[]): Promise<boolean> {
    try {
      await fs.mkdir(this.userDataDir, { recursive: true });
      await fs.writeFile(this.lithoPlateSizesPath, JSON.stringify(sizes, null, 2), 'utf8');
      return true;
    } catch {
      return false;
    }
  }

  public async loadLithoPlateSizes(): Promise<LithoPlateSizePreset[] | null> {
    try {
      const content = await fs.readFile(this.lithoPlateSizesPath, 'utf8');
      const parsed = JSON.parse(content);
      return Array.isArray(parsed) ? (parsed as LithoPlateSizePreset[]) : null;
    } catch {
      return null;
    }
  }

  private get virtualPrinterPath(): string {
    return path.join(this.userDataDir, 'virtual-printer.json');
  }

  public async saveVirtualPrinterConfig(config: VirtualPrinterConfig): Promise<boolean> {
    try {
      await fs.mkdir(this.userDataDir, { recursive: true });
      await fs.writeFile(this.virtualPrinterPath, JSON.stringify(config, null, 2), 'utf8');
      return true;
    } catch {
      return false;
    }
  }

  public async loadVirtualPrinterConfig(): Promise<Partial<VirtualPrinterConfig> | null> {
    try {
      const content = await fs.readFile(this.virtualPrinterPath, 'utf8');
      return JSON.parse(content) as Partial<VirtualPrinterConfig>;
    } catch {
      return null;
    }
  }
}
