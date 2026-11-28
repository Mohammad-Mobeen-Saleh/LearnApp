import { shuffle, type RandomFn } from '../lib/random.ts';
import type { GameQuestion } from './game.ts';
import { ShuffledQueue } from './questionQueue.ts';
import { pointsForAnswer } from './scoring.ts';
import type { GameMode, SnakeMapSize, SnakeSpeed } from './types.ts';

/**
 * Reine Spiellogik von Snake (ohne Grafik, vollständig testbar).
 *
 * - Pro Frage liegen drei Früchte mit je einer Antwort auf dem Feld (richtige Antwort zufällig verteilt).
 * - Richtige Frucht: Schlange wächst, Punkte, nächste Frage mit drei neuen Früchten.
 * - Falsche Frucht: Bombe, Spielende.
 * - Wand oder eigener Körper: Spielende (klassische Snake-Regel).
 * - Eine Richtungsumkehr um 180 Grad ist nicht möglich.
 */

export type Direction = 'up' | 'down' | 'left' | 'right';
export interface Cell {
  x: number;
  y: number;
}

export const DIRECTION_VECTORS: Record<Direction, Cell> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};
const OPPOSITE: Record<Direction, Direction> = { up: 'down', down: 'up', left: 'right', right: 'left' };

/** Zellen auf der kurzen Seite des Feldes (die lange Seite richtet sich nach dem Bildschirm). */
export const SNAKE_MAP_SHORT_SIDE: Record<SnakeMapSize, number> = { small: 11, large: 17 };
/** Millisekunden pro Schritt */
export const SNAKE_STEP_MS: Record<SnakeSpeed, number> = { slow: 220, medium: 155, fast: 105 };
export const SNAKE_START_LENGTH = 3;
/** Mindestabstand (Manhattan) einer neuen Frucht vom Kopf und der Früchte untereinander */
const MIN_HEAD_DISTANCE = 4;
const MIN_FRUIT_DISTANCE = 3;

/** Feldgrösse aus Kartengrösse und Seitenverhältnis des verfügbaren Platzes. */
export function snakeGridSize(mapSize: SnakeMapSize, width: number, height: number): { cols: number; rows: number } {
  const short = SNAKE_MAP_SHORT_SIDE[mapSize];
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const ratio = Math.min(1.9, Math.max(1, Math.max(w, h) / Math.min(w, h)));
  const long = Math.max(short, Math.round(short * ratio));
  return w >= h ? { cols: long, rows: short } : { cols: short, rows: long };
}

export interface Fruit {
  slot: number;
  cell: Cell;
  answer: string;
  correct: boolean;
}

export type SnakePhase = 'ready' | 'playing' | 'over';
export type SnakeEndReason = 'bomb' | 'wall' | 'self' | 'completed' | 'quit';

export type StepResult =
  | { type: 'move' }
  | { type: 'eat'; fruit: Fruit; points: number; speedBonus: number; multiplier: number; responseSteps: number }
  | { type: 'bomb'; fruit: Fruit; question: GameQuestion }
  | { type: 'crash'; reason: 'wall' | 'self' };

export interface SnakeSummary {
  mode: GameMode;
  deckId: string | null;
  score: number;
  rounds: number;
  correctCount: number;
  wrongCount: number;
  maxStreak: number;
  length: number;
  accuracy: number | null;
  reason: SnakeEndReason;
  /** Frage, bei der die falsche Frucht gefressen wurde */
  missedQuestion: GameQuestion | null;
  startedAt: string;
  endedAt: string;
}

export interface SnakeOptions {
  questions: GameQuestion[];
  cols: number;
  rows: number;
  mode?: GameMode;
  deckId?: string | null;
  /** false: jede Frage genau einmal (Wiederholung) */
  endless?: boolean;
  random?: RandomFn;
  now?: () => Date;
}

/** Prüft, ob die drei Früchte (mit ihren Beschriftungen) so platziert werden können. */
export type PlacementCheck = (cells: Cell[]) => boolean;

const key = (c: Cell) => `${c.x},${c.y}`;
const manhattan = (a: Cell, b: Cell) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

export class SnakeEngine {
  readonly cols: number;
  readonly rows: number;
  readonly mode: GameMode;
  readonly deckId: string | null;
  private readonly random: RandomFn;
  private readonly now: () => Date;
  private readonly queue: ShuffledQueue<GameQuestion>;
  private readonly startedAt: string;
  private endedAt: string | null = null;
  private dirQueue: Direction[] = [];
  private growPending = 0;
  private stepsThisQuestion = 0;
  private shortestPath = 1;

  phase: SnakePhase = 'ready';
  snake: Cell[] = [];
  /** Lage vor dem letzten Schritt (für flüssige Zwischenbilder) */
  previous: Cell[] = [];
  direction: Direction = 'right';
  fruits: Fruit[] = [];
  question: GameQuestion | null = null;
  /** Antworten in der Reihenfolge der Früchte (Slot 0–2) */
  slotAnswers: string[] = [];
  correctSlot = 0;
  score = 0;
  streak = 0;
  maxStreak = 0;
  correctCount = 0;
  wrongCount = 0;
  roundNumber = 0;
  reason: SnakeEndReason | null = null;
  missedQuestion: GameQuestion | null = null;

  constructor(options: SnakeOptions) {
    if (options.questions.length === 0) throw new Error('Keine Fragen mit drei gültigen Antworten.');
    this.cols = Math.max(6, Math.round(options.cols));
    this.rows = Math.max(6, Math.round(options.rows));
    this.mode = options.mode ?? 'normal';
    this.deckId = options.deckId ?? null;
    this.random = options.random ?? Math.random;
    this.now = options.now ?? (() => new Date());
    this.queue = new ShuffledQueue(options.questions, { random: this.random, endless: options.endless ?? true });
    this.startedAt = this.now().toISOString();
    const y = Math.floor(this.rows / 2);
    const x = Math.max(SNAKE_START_LENGTH, Math.floor(this.cols / 3));
    this.snake = Array.from({ length: SNAKE_START_LENGTH }, (_, i) => ({ x: x - i, y }));
    this.previous = this.snake.map((c) => ({ ...c }));
  }

  get length(): number {
    return this.snake.length;
  }

  get head(): Cell {
    return this.snake[0];
  }

  /** Nächste Frage vorbereiten: Antworten zufällig auf die drei Früchte verteilen. */
  nextQuestion(): GameQuestion | null {
    const q = this.queue.next();
    this.fruits = [];
    if (!q) {
      this.question = null;
      return null;
    }
    this.question = q;
    this.roundNumber += 1;
    const order = shuffle([0, 1, 2], this.random);
    this.slotAnswers = order.map((i) => q.answers[i]);
    this.correctSlot = order.indexOf(q.correctIndex);
    this.stepsThisQuestion = 0;
    return q;
  }

  private occupied(): Set<string> {
    return new Set(this.snake.map(key));
  }

  private freeCells(): Cell[] {
    const taken = this.occupied();
    const out: Cell[] = [];
    for (let y = 0; y < this.rows; y++) for (let x = 0; x < this.cols; x++) if (!taken.has(`${x},${y}`)) out.push({ x, y });
    return out;
  }

  /** Zellen direkt vor dem Kopf (in Fahrtrichtung): dort keine Frucht, damit sie nicht versehentlich gefressen wird. */
  private aheadCells(n: number): Set<string> {
    const v = DIRECTION_VECTORS[this.direction];
    const out = new Set<string>();
    for (let i = 1; i <= n; i++) out.add(`${this.head.x + v.x * i},${this.head.y + v.y * i}`);
    return out;
  }

  /**
   * Drei Früchte auf freien Zellen platzieren (nie auf der Schlange, nie ausserhalb des Feldes).
   * `check` kann zusätzlich prüfen, ob die Beschriftungen Platz haben.
   */
  placeFruits(check?: PlacementCheck, attempts = 400): boolean {
    if (!this.question) return false;
    const free = this.freeCells();
    const ahead = this.aheadCells(4);
    const levels: { head: number; fruit: number; useCheck: boolean }[] = [
      { head: MIN_HEAD_DISTANCE, fruit: MIN_FRUIT_DISTANCE, useCheck: true },
      { head: 3, fruit: 2, useCheck: true },
      { head: 3, fruit: 2, useCheck: false },
      { head: 1, fruit: 1, useCheck: false },
    ];
    for (const level of levels) {
      const candidates = free.filter((c) => manhattan(c, this.head) >= level.head && !ahead.has(key(c)));
      if (candidates.length < 3) continue;
      for (let i = 0; i < attempts; i++) {
        const picks: Cell[] = [];
        for (let tries = 0; tries < 40 && picks.length < 3; tries++) {
          const c = candidates[Math.floor(this.random() * candidates.length)];
          if (picks.every((p) => manhattan(p, c) >= level.fruit)) picks.push(c);
        }
        if (picks.length < 3) continue;
        if (level.useCheck && check && !check(picks)) continue;
        this.fruits = picks.map((cell, slot) => ({ slot, cell, answer: this.slotAnswers[slot], correct: slot === this.correctSlot }));
        const target = this.fruits[this.correctSlot].cell;
        this.shortestPath = Math.max(1, manhattan(this.head, target));
        return true;
      }
    }
    return false;
  }

  start(): GameQuestion {
    if (this.phase !== 'ready') throw new Error('Spiel läuft bereits');
    const q = this.nextQuestion();
    if (!q) throw new Error('Keine Fragen verfügbar');
    this.phase = 'playing';
    return q;
  }

  /** Richtung wechseln (Tastatur, Wischen, Steuerkreuz). Gibt false zurück, wenn ignoriert. */
  turn(dir: Direction): boolean {
    if (this.phase !== 'playing') return false;
    const last = this.dirQueue[this.dirQueue.length - 1] ?? this.direction;
    if (dir === last || dir === OPPOSITE[last]) return false;
    if (this.dirQueue.length >= 2) return false;
    this.dirQueue.push(dir);
    return true;
  }

  /** Einen Schritt weiterziehen. */
  step(): StepResult {
    if (this.phase !== 'playing') return { type: 'move' };
    const next = this.dirQueue.shift();
    if (next && next !== OPPOSITE[this.direction]) this.direction = next;
    const v = DIRECTION_VECTORS[this.direction];
    const head = { x: this.head.x + v.x, y: this.head.y + v.y };
    this.previous = this.snake.map((c) => ({ ...c }));
    this.stepsThisQuestion += 1;

    if (head.x < 0 || head.y < 0 || head.x >= this.cols || head.y >= this.rows) {
      this.finish('wall');
      return { type: 'crash', reason: 'wall' };
    }
    // Der Schwanz zieht im selben Schritt weiter, darf also betreten werden (ausser beim Wachsen)
    const body = this.growPending > 0 ? this.snake : this.snake.slice(0, -1);
    if (body.some((c) => c.x === head.x && c.y === head.y)) {
      this.finish('self');
      return { type: 'crash', reason: 'self' };
    }

    this.snake.unshift(head);
    if (this.growPending > 0) this.growPending -= 1;
    else this.snake.pop();

    const fruit = this.fruits.find((f) => f.cell.x === head.x && f.cell.y === head.y);
    if (!fruit) return { type: 'move' };

    const question = this.question!;
    if (!fruit.correct) {
      this.wrongCount += 1;
      this.streak = 0;
      this.missedQuestion = question;
      this.finish('bomb');
      return { type: 'bomb', fruit, question };
    }
    this.correctCount += 1;
    this.streak += 1;
    this.maxStreak = Math.max(this.maxStreak, this.streak);
    this.growPending += 1;
    const efficiency = Math.min(1, this.shortestPath / Math.max(1, this.stepsThisQuestion));
    const breakdown = pointsForAnswer({ correct: true, difficulty: question.difficulty, remainingFraction: efficiency, streak: this.streak });
    this.score += breakdown.points;
    const responseSteps = this.stepsThisQuestion;
    this.fruits = [];
    if (!this.nextQuestion()) this.finish('completed');
    return { type: 'eat', fruit, points: breakdown.points, speedBonus: breakdown.speedBonus, multiplier: breakdown.multiplier, responseSteps };
  }

  quit(): void {
    if (this.phase !== 'over') this.finish('quit');
  }

  private finish(reason: SnakeEndReason) {
    this.phase = 'over';
    this.reason = reason;
    this.dirQueue = [];
    this.endedAt = this.now().toISOString();
  }

  get answeredRounds(): number {
    return this.correctCount + this.wrongCount;
  }

  summary(): SnakeSummary {
    const answered = this.answeredRounds;
    return {
      mode: this.mode,
      deckId: this.deckId,
      score: this.score,
      rounds: answered,
      correctCount: this.correctCount,
      wrongCount: this.wrongCount,
      maxStreak: this.maxStreak,
      length: this.snake.length,
      accuracy: answered ? this.correctCount / answered : null,
      reason: this.reason ?? 'quit',
      missedQuestion: this.missedQuestion,
      startedAt: this.startedAt,
      endedAt: this.endedAt ?? this.now().toISOString(),
    };
  }
}
