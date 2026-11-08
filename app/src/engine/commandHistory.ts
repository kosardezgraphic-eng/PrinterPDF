/**
 * PrintStudio Pro — Unlimited Undo/Redo Engine (Command Pattern - A5)
 */

export interface UndoableSnapshot<T> {
  id: string;
  labelFa: string;
  labelEn: string;
  timestamp: number;
  before: T;
  after: T;
}

export class CommandHistoryManager<T> {
  private undoStack: UndoableSnapshot<T>[] = [];
  private redoStack: UndoableSnapshot<T>[] = [];
  private readonly maxDepth: number;

  constructor(maxDepth = 500) {
    this.maxDepth = maxDepth;
  }

  public record(
    labelFa: string,
    labelEn: string,
    before: T,
    after: T
  ): UndoableSnapshot<T> {
    const entry: UndoableSnapshot<T> = {
      id: `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      labelFa,
      labelEn,
      timestamp: Date.now(),
      before: structuredClone(before),
      after: structuredClone(after),
    };

    this.undoStack.push(entry);
    if (this.undoStack.length > this.maxDepth) {
      this.undoStack.shift();
    }
    // Any new command invalidates the redo stack
    this.redoStack = [];
    return entry;
  }

  public undo(): UndoableSnapshot<T> | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.redoStack.push(entry);
    return entry;
  }

  public redo(): UndoableSnapshot<T> | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push(entry);
    return entry;
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public getUndoCount(): number {
    return this.undoStack.length;
  }

  public getRedoCount(): number {
    return this.redoStack.length;
  }

  public peekUndo(): UndoableSnapshot<T> | null {
    return this.undoStack[this.undoStack.length - 1] ?? null;
  }

  public peekRedo(): UndoableSnapshot<T> | null {
    return this.redoStack[this.redoStack.length - 1] ?? null;
  }

  public clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
