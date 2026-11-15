/**
 * PrintStudio Pro — Bounded LRU Page Thumbnail & Bitmap Cache
 * Ensures bounded RAM usage even on 10,000-page PDF workloads.
 */

export class LRUPageCache<TValue = string> {
  private readonly cache = new Map<string, TValue>();
  private maxEntries: number;

  /**
   * `onEvict` runs for every value the cache drops — on overflow, on `delete`, on `clear` and on a
   * lowered limit. A cache of plain strings does not need it; a cache of image handles does, because
   * dropping the reference alone never gives the memory back to the browser.
   */
  constructor(maxEntries = 300, private readonly onEvict?: (value: TValue) => void) {
    this.maxEntries = Math.max(16, maxEntries);
  }

  /** Every entry, oldest first — the order entries would be evicted in. */
  public entries(): Array<[string, TValue]> {
    return [...this.cache.entries()];
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
      // Replacing an entry is not an eviction, but the value being overwritten does need releasing.
      const previous = this.cache.get(key)!;
      this.cache.delete(key);
      if (previous !== value) this.evict(previous);
    } else if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        const oldest = this.cache.get(oldestKey)!;
        this.cache.delete(oldestKey);
        this.evict(oldest);
      }
    }
    this.cache.set(key, value);
  }

  public delete(key: string): boolean {
    const value = this.cache.get(key);
    const removed = this.cache.delete(key);
    if (removed && value !== undefined) this.evict(value);
    return removed;
  }

  public setMaxEntries(newLimit: number): void {
    this.maxEntries = Math.max(16, newLimit);
    while (this.cache.size > this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey === undefined) break;
      const oldest = this.cache.get(oldestKey)!;
      this.cache.delete(oldestKey);
      this.evict(oldest);
    }
  }

  public clear(): void {
    const values = [...this.cache.values()];
    this.cache.clear();
    for (const value of values) this.evict(value);
  }

  public get size(): number {
    return this.cache.size;
  }

  private evict(value: TValue): void {
    try {
      this.onEvict?.(value);
    } catch (error) {
      // A release hook that throws must not take the cache down with it: the entry is already gone.
      console.error('Page cache eviction hook failed:', error);
    }
  }
}

export const globalThumbnailCache = new LRUPageCache<string>(400);
