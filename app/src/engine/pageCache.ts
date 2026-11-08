/**
 * PrintStudio Pro — Bounded LRU Page Thumbnail & Bitmap Cache
 * Ensures bounded RAM usage even on 10,000-page PDF workloads.
 */

export class LRUPageCache<TValue = string> {
  private readonly cache = new Map<string, TValue>();
  private maxEntries: number;

  constructor(maxEntries = 300) {
    this.maxEntries = Math.max(16, maxEntries);
  }

  public get(key: string): TValue | undefined {
    if (!this.cache.has(key)) {
      return undefined;
    }
    const val = this.cache.get(key)!;
    // Refresh recency
    this.cache.delete(key);
    this.cache.set(key, val);
    return val;
  }

  public set(key: string, value: TValue): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(key, value);
  }

  public delete(key: string): boolean {
    return this.cache.delete(key);
  }

  public setMaxEntries(newLimit: number): void {
    this.maxEntries = Math.max(16, newLimit);
    while (this.cache.size > this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey === undefined) break;
      this.cache.delete(oldestKey);
    }
  }

  public clear(): void {
    this.cache.clear();
  }

  public get size(): number {
    return this.cache.size;
  }
}

export const globalThumbnailCache = new LRUPageCache<string>(400);
