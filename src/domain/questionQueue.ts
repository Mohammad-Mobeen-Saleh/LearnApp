import { shuffle, type RandomFn } from '../lib/random.ts';

/**
 * Gemischter Fragenstapel für den Endlosbetrieb.
 * Jede Frage kommt genau einmal pro Durchgang vor. Ist der Stapel leer, wird neu gemischt;
 * dabei steht die zuletzt gestellte Frage nie direkt wieder am Anfang.
 */
export class ShuffledQueue<T extends { id: string }> {
  private readonly items: readonly T[];
  private readonly random: RandomFn;
  private readonly endless: boolean;
  private stack: T[];
  private last: T | null = null;
  /** Anzahl abgeschlossener Durchgänge */
  cycles = 0;

  constructor(items: readonly T[], options: { random?: RandomFn; endless?: boolean } = {}) {
    if (items.length === 0) throw new Error('Das Lernpaket enthält keine Fragen.');
    this.items = items;
    this.random = options.random ?? Math.random;
    this.endless = options.endless ?? true;
    this.stack = shuffle(items, this.random);
  }

  get remainingInCycle(): number {
    return this.stack.length;
  }

  get size(): number {
    return this.items.length;
  }

  next(): T | null {
    if (this.stack.length === 0) {
      if (!this.endless) return null;
      this.cycles += 1;
      this.stack = shuffle(this.items, this.random);
      if (this.stack.length > 1 && this.last && this.stack[0].id === this.last.id) {
        const swap = 1 + Math.floor(this.random() * (this.stack.length - 1));
        [this.stack[0], this.stack[swap]] = [this.stack[swap], this.stack[0]];
      }
    }
    const item = this.stack.shift() ?? null;
    this.last = item;
    return item;
  }
}
