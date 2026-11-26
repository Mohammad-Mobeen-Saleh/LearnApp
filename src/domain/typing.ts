import type { RandomFn } from '../lib/random.ts';
import { acceptedSolutions, isTypedAnswerCorrect, normalizeAnswer } from './answerCheck.ts';
import type { GameQuestion } from './game.ts';
import { ShuffledQueue } from './questionQueue.ts';
import { pointsForAnswer, remainingFraction, TYPING_WRONG_PENALTY, typingDurationMs } from './scoring.ts';
import type { GameMode, SpeedSetting } from './types.ts';

/**
 * Reine Spiellogik des Tippmodus (ohne Grafik, vollständig testbar).
 *
 * - Ein Meteorit pro Frage fällt Richtung Schutzschild.
 * - Richtige Eingabe: Meteorit zerstört, Punkte (+ Tempo- und Serienbonus), nächste Frage sofort.
 * - Falsche Eingabe: TYPING_WRONG_PENALTY Punkte Abzug (nie unter 0), der Meteorit fällt weiter.
 * - Erreicht der Meteorit den Schild: Game Over.
 */

export type TypingPhase = 'ready' | 'playing' | 'resolving' | 'over';
export type TypingFinishReason = 'impact' | 'completed' | 'quit';

export interface TypingRound {
  number: number;
  question: GameQuestion;
  solution: string;
  durationMs: number;
  wrongAttempts: number;
}

export type SubmitResult =
  | { kind: 'ignored'; reason: 'empty' | 'not_playing' }
  | { kind: 'wrong'; penalty: number; score: number; attempts: number }
  | { kind: 'correct'; points: number; speedBonus: number; multiplier: number; score: number; responseMs: number; firstTry: boolean };

export interface TypingSummary {
  gameType: 'typing';
  mode: GameMode;
  deckId: string | null;
  score: number;
  /** Anzahl Meteoriten (gestellte Fragen) */
  rounds: number;
  /** zerstörte Meteoriten */
  correctCount: number;
  /** abgeschickte falsche Eingaben */
  wrongCount: number;
  maxStreak: number;
  accuracy: number | null;
  reason: TypingFinishReason;
  /** Fragen mit Fehleingaben oder verpasst */
  wrongQuestions: GameQuestion[];
  /** die Frage, an der das Spiel endete (Meteorit eingeschlagen) */
  missedQuestion: GameQuestion | null;
  startedAt: string;
  endedAt: string;
}

export interface TypingOptions {
  questions: GameQuestion[];
  speed?: SpeedSetting;
  mode?: GameMode;
  deckId?: string | null;
  random?: RandomFn;
  now?: () => Date;
  /** false = jede Frage genau einmal (Wiederholungsmodus) */
  endless?: boolean;
}

export class TypingController {
  private readonly queue: ShuffledQueue<GameQuestion>;
  private readonly speed: SpeedSetting;
  private readonly now: () => Date;
  private readonly startedAt: string;
  private readonly endless: boolean;
  private endedAt: string | null = null;
  private wrong = new Map<string, GameQuestion>();
  private listeners = new Set<() => void>();

  readonly mode: GameMode;
  readonly deckId: string | null;
  phase: TypingPhase = 'ready';
  score = 0;
  streak = 0;
  maxStreak = 0;
  correctCount = 0;
  wrongAttempts = 0;
  roundNumber = 0;
  current: TypingRound | null = null;
  reason: TypingFinishReason | null = null;
  missedQuestion: GameQuestion | null = null;

  constructor(options: TypingOptions) {
    this.endless = options.endless ?? true;
    this.queue = new ShuffledQueue(options.questions, { random: options.random, endless: this.endless });
    this.speed = options.speed ?? 'normal';
    this.mode = options.mode ?? 'normal';
    this.deckId = options.deckId ?? null;
    this.now = options.now ?? (() => new Date());
    this.startedAt = this.now().toISOString();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    for (const l of [...this.listeners]) l();
  }

  get isEndless(): boolean {
    return this.endless;
  }

  start(): TypingRound {
    if (this.phase !== 'ready') throw new Error('Spiel läuft bereits');
    const round = this.nextRound();
    if (!round) throw new Error('Keine Fragen verfügbar');
    return round;
  }

  private nextRound(): TypingRound | null {
    const question = this.queue.next();
    if (!question) return null;
    this.roundNumber += 1;
    const solution = acceptedSolutions(question)[0] ?? '';
    this.current = {
      number: this.roundNumber,
      question,
      solution,
      durationMs: typingDurationMs({ question: question.question, solution }, this.speed, this.roundNumber - 1),
      wrongAttempts: 0,
    };
    this.phase = 'playing';
    this.emit();
    return this.current;
  }

  /** Ausdrücklich abgeschickte Eingabe prüfen. Leere Eingaben und Eingaben ausserhalb der Runde werden ignoriert. */
  submit(input: string, elapsedMs: number): SubmitResult {
    if (this.phase !== 'playing' || !this.current) return { kind: 'ignored', reason: 'not_playing' };
    if (!normalizeAnswer(input)) return { kind: 'ignored', reason: 'empty' };
    const round = this.current;
    if (isTypedAnswerCorrect(input, round.question)) {
      const responseMs = Math.max(0, Math.round(Math.min(elapsedMs, round.durationMs)));
      this.streak += 1;
      this.maxStreak = Math.max(this.maxStreak, this.streak);
      this.correctCount += 1;
      const breakdown = pointsForAnswer({
        correct: true,
        difficulty: round.question.difficulty,
        remainingFraction: remainingFraction(responseMs, round.durationMs),
        streak: this.streak,
      });
      this.score += breakdown.points;
      this.phase = 'resolving';
      this.emit();
      return {
        kind: 'correct',
        points: breakdown.points,
        speedBonus: breakdown.speedBonus,
        multiplier: breakdown.multiplier,
        score: this.score,
        responseMs,
        firstTry: round.wrongAttempts === 0,
      };
    }
    round.wrongAttempts += 1;
    this.wrongAttempts += 1;
    this.streak = 0;
    this.wrong.set(round.question.id, round.question);
    const before = this.score;
    this.score = Math.max(0, this.score - TYPING_WRONG_PENALTY);
    this.emit();
    return { kind: 'wrong', penalty: before - this.score, score: this.score, attempts: round.wrongAttempts };
  }

  /** Der Meteorit hat den Schutzschild erreicht → Game Over. */
  impact(): GameQuestion | null {
    if (this.phase !== 'playing' || !this.current) return null;
    const q = this.current.question;
    this.missedQuestion = q;
    this.wrong.set(q.id, q);
    this.streak = 0;
    this.phase = 'resolving';
    this.emit();
    return q;
  }

  /** Nach der Zerstörungsanimation: nächste Frage (oder Ende). */
  next(): TypingRound | null {
    if (this.phase !== 'resolving') return null;
    if (this.missedQuestion) {
      this.finish('impact');
      return null;
    }
    const round = this.nextRound();
    if (!round) this.finish('completed');
    return round;
  }

  quit(): void {
    if (this.phase !== 'over') this.finish('quit');
  }

  private finish(reason: TypingFinishReason) {
    this.phase = 'over';
    this.reason = reason;
    this.current = null;
    this.endedAt = this.now().toISOString();
    this.emit();
  }

  /** Anzahl Meteoriten, die zu Ende gespielt wurden (zerstört oder eingeschlagen). */
  get answeredRounds(): number {
    return this.correctCount + (this.missedQuestion ? 1 : 0);
  }

  summary(): TypingSummary {
    const rounds = this.answeredRounds;
    return {
      gameType: 'typing',
      mode: this.mode,
      deckId: this.deckId,
      score: this.score,
      rounds,
      correctCount: this.correctCount,
      wrongCount: this.wrongAttempts,
      maxStreak: this.maxStreak,
      accuracy: this.correctCount + this.wrongAttempts > 0 ? this.correctCount / (this.correctCount + this.wrongAttempts) : null,
      reason: this.reason ?? 'quit',
      wrongQuestions: [...this.wrong.values()],
      missedQuestion: this.missedQuestion,
      startedAt: this.startedAt,
      endedAt: this.endedAt ?? this.now().toISOString(),
    };
  }
}
