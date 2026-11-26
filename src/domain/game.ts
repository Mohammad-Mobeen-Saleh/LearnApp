import { shuffle, type RandomFn } from '../lib/random.ts';
import { pointsForAnswer, remainingFraction, roundDurationMs } from './scoring.ts';
import { ShuffledQueue } from './questionQueue.ts';
import type { AnswerOutcome, GameMode, Question, SpeedSetting } from './types.ts';

/** Reine Spiellogik (ohne Grafik) – vollständig testbar. */

export type GameQuestion = Pick<
  Question,
  'id' | 'deckId' | 'question' | 'answers' | 'correctIndex' | 'explanation' | 'difficulty' | 'category' | 'acceptedAnswers'
>;

export interface Round {
  /** laufende Nummer (1-basiert) */
  number: number;
  question: GameQuestion;
  /** angezeigte Reihenfolge: slot -> ursprünglicher Antwortindex */
  order: [number, number, number];
  /** Antworttexte in Anzeige-Reihenfolge */
  answers: [string, string, string];
  correctSlot: number;
  durationMs: number;
  isRepeat: boolean;
}

export interface RoundResult {
  outcome: AnswerOutcome;
  slot: number | null;
  correctSlot: number;
  points: number;
  speedBonus: number;
  multiplier: number;
  streak: number;
  lives: number;
  responseMs: number;
  question: GameQuestion;
  round: number;
}

export type GamePhase = 'ready' | 'playing' | 'resolving' | 'feedback' | 'over';
export type FinishReason = 'lives' | 'completed' | 'quit';

export interface GameSummary {
  mode: GameMode;
  deckId: string | null;
  score: number;
  rounds: number;
  correctCount: number;
  wrongCount: number;
  maxStreak: number;
  accuracy: number | null;
  reason: FinishReason;
  wrongQuestions: GameQuestion[];
  startedAt: string;
  endedAt: string;
}

export interface GameOptions {
  questions: GameQuestion[];
  lives?: number;
  /** 0 = alle Fragen */
  questionsPerGame?: number;
  speed?: SpeedSetting;
  mode?: GameMode;
  deckId?: string | null;
  random?: RandomFn;
  now?: () => Date;
  /** falsch beantwortete Fragen später im selben Spiel erneut stellen */
  repeatWrongInGame?: boolean;
  /**
   * Endlosbetrieb (Abwehrmodus): Fragen laufen ohne Ende weiter; ist das Paket durchgespielt,
   * wird automatisch neu gemischt. Zusammen mit `lives: 1` beendet ein Fehler das Spiel.
   */
  endless?: boolean;
}

export const START_LIVES = 3;
const REQUEUE_DISTANCE = 3;

export class GameController {
  private readonly random: RandomFn;
  private readonly now: () => Date;
  private readonly speed: SpeedSetting;
  private readonly repeatWrongInGame: boolean;
  private queue: { question: GameQuestion; isRepeat: boolean }[];
  private endlessQueue: ShuffledQueue<GameQuestion> | null = null;
  private requeued = new Set<string>();
  private wrong = new Map<string, GameQuestion>();
  private startedAt: string;
  private endedAt: string | null = null;
  private listeners = new Set<() => void>();

  readonly mode: GameMode;
  readonly deckId: string | null;
  phase: GamePhase = 'ready';
  score = 0;
  lives: number;
  streak = 0;
  maxStreak = 0;
  correctCount = 0;
  wrongCount = 0;
  roundNumber = 0;
  current: Round | null = null;
  lastResult: RoundResult | null = null;
  reason: FinishReason | null = null;

  constructor(options: GameOptions) {
    if (options.questions.length === 0) throw new Error('Das Lernpaket enthält keine Fragen.');
    this.random = options.random ?? Math.random;
    this.now = options.now ?? (() => new Date());
    this.speed = options.speed ?? 'normal';
    this.mode = options.mode ?? 'normal';
    this.deckId = options.deckId ?? null;
    this.lives = options.lives ?? START_LIVES;
    this.repeatWrongInGame = options.repeatWrongInGame ?? true;
    if (options.endless) {
      this.endlessQueue = new ShuffledQueue(options.questions, { random: this.random, endless: true });
      this.queue = [];
    } else {
      const limit = options.questionsPerGame && options.questionsPerGame > 0 ? options.questionsPerGame : Infinity;
      this.queue = shuffle(options.questions, this.random)
        .slice(0, limit)
        .map((question) => ({ question, isRepeat: false }));
    }
    this.startedAt = this.now().toISOString();
  }

  /** Gesamtzahl geplanter Runden (wächst, wenn Fragen wiederholt werden). */
  get totalRounds(): number {
    if (this.endlessQueue) return Infinity;
    return this.roundNumber + this.queue.length;
  }

  get isEndless(): boolean {
    return this.endlessQueue !== null;
  }

  get wrongQuestions(): GameQuestion[] {
    return [...this.wrong.values()];
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  start(): Round {
    if (this.phase !== 'ready') throw new Error('Spiel läuft bereits');
    const round = this.nextRound();
    if (!round) throw new Error('Keine Fragen verfügbar');
    return round;
  }

  private nextRound(): Round | null {
    const fromEndless = this.endlessQueue?.next();
    const item = fromEndless ? { question: fromEndless, isRepeat: false } : this.queue.shift();
    if (!item) return null;
    const order = shuffle([0, 1, 2], this.random) as [number, number, number];
    const answers = order.map((i) => item.question.answers[i]) as [string, string, string];
    this.roundNumber += 1;
    this.current = {
      number: this.roundNumber,
      question: item.question,
      order,
      answers,
      correctSlot: order.indexOf(item.question.correctIndex),
      durationMs: roundDurationMs(item.question, this.speed, this.roundNumber - 1),
      isRepeat: item.isRepeat,
    };
    this.phase = 'playing';
    this.lastResult = null;
    this.emit();
    return this.current;
  }

  /** Spieler hat auf den Meteoriten in `slot` geschossen. */
  answer(slot: number, elapsedMs: number): RoundResult {
    const round = this.requirePlaying();
    const correct = slot === round.correctSlot;
    return this.resolve(correct ? 'correct' : 'wrong', slot, elapsedMs, round);
  }

  /** Die Meteoriten haben den Schutzschild erreicht. */
  timeout(elapsedMs?: number): RoundResult {
    const round = this.requirePlaying();
    return this.resolve('timeout', null, elapsedMs ?? (Number.isFinite(round.durationMs) ? round.durationMs : 0), round);
  }

  private requirePlaying(): Round {
    if (this.phase !== 'playing' || !this.current) throw new Error('Keine aktive Runde');
    return this.current;
  }

  private resolve(outcome: AnswerOutcome, slot: number | null, elapsedMs: number, round: Round): RoundResult {
    const responseMs = Math.max(0, Math.round(Math.min(elapsedMs, round.durationMs)));
    let points = 0;
    let bonus = 0;
    let multiplier = 1;
    if (outcome === 'correct') {
      this.streak += 1;
      this.maxStreak = Math.max(this.maxStreak, this.streak);
      this.correctCount += 1;
      const breakdown = pointsForAnswer({
        correct: true,
        difficulty: round.question.difficulty,
        remainingFraction: remainingFraction(responseMs, round.durationMs),
        streak: this.streak,
      });
      points = breakdown.points;
      bonus = breakdown.speedBonus;
      multiplier = breakdown.multiplier;
      this.score += points;
    } else {
      this.streak = 0;
      this.wrongCount += 1;
      this.lives = Math.max(0, this.lives - 1);
      this.wrong.set(round.question.id, round.question);
      if (this.repeatWrongInGame && this.lives > 0 && !this.requeued.has(round.question.id)) {
        this.requeued.add(round.question.id);
        const position = Math.min(REQUEUE_DISTANCE, this.queue.length);
        this.queue.splice(position, 0, { question: round.question, isRepeat: true });
      }
    }
    this.lastResult = {
      outcome,
      slot,
      correctSlot: round.correctSlot,
      points,
      speedBonus: bonus,
      multiplier,
      streak: this.streak,
      lives: this.lives,
      responseMs,
      question: round.question,
      round: round.number,
    };
    this.phase = 'resolving';
    this.emit();
    return this.lastResult;
  }

  /** Animation abgeschlossen – Rückmeldung anzeigen. */
  reveal(): void {
    if (this.phase === 'resolving') {
      this.phase = 'feedback';
      this.emit();
    }
  }

  get isGameOver(): boolean {
    return this.lives <= 0;
  }

  /** Nächste Runde oder Spielende (null). */
  next(): Round | null {
    if (this.phase !== 'feedback' && this.phase !== 'resolving') throw new Error('Runde ist noch nicht beendet');
    if (this.lives <= 0) {
      this.finish('lives');
      return null;
    }
    const round = this.nextRound();
    if (!round) {
      this.finish('completed');
      return null;
    }
    return round;
  }

  quit(): void {
    if (this.phase !== 'over') this.finish('quit');
  }

  private finish(reason: FinishReason) {
    this.phase = 'over';
    this.reason = reason;
    this.current = null;
    this.endedAt = this.now().toISOString();
    this.emit();
  }

  /** Anzahl tatsächlich beantworteter Runden. */
  get answeredRounds(): number {
    return this.correctCount + this.wrongCount;
  }

  summary(): GameSummary {
    const answered = this.answeredRounds;
    return {
      mode: this.mode,
      deckId: this.deckId,
      score: this.score,
      rounds: answered,
      correctCount: this.correctCount,
      wrongCount: this.wrongCount,
      maxStreak: this.maxStreak,
      accuracy: answered > 0 ? this.correctCount / answered : null,
      reason: this.reason ?? 'quit',
      wrongQuestions: this.wrongQuestions,
      startedAt: this.startedAt,
      endedAt: this.endedAt ?? this.now().toISOString(),
    };
  }
}
