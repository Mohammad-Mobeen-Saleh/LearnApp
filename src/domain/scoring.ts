import { clamp } from '../lib/random.ts';
import type { Difficulty, SpeedSetting } from './types.ts';

/** Grundpunkte je Schwierigkeit. */
export const BASE_POINTS: Record<Difficulty, number> = { 1: 80, 2: 100, 3: 130 };
/** Maximaler Geschwindigkeitsbonus in Prozent der Grundpunkte. */
export const MAX_SPEED_BONUS_RATIO = 0.5;
/** Serienbonus: +10 % pro richtiger Antwort in Folge, höchstens +50 %. */
export const STREAK_STEP = 0.1;
export const MAX_STREAK_STEPS = 5;

/** Lesegeschwindigkeit (Zeichen pro Sekunde), mit der die Flugzeit verlängert wird. */
export const READING_CHARS_PER_SECOND = 14;
export const BASE_DURATION_MS: Record<SpeedSetting, number> = { slow: 9000, normal: 6000, fast: 3500 };
export const MIN_DURATION_MS = 6000;
export const MAX_DURATION_MS = 45000;

export interface PointsBreakdown {
  points: number;
  base: number;
  speedBonus: number;
  multiplier: number;
}

/** Multiplikator für eine Serie (streak = Anzahl richtiger Antworten in Folge inkl. der aktuellen). */
export function streakMultiplier(streak: number): number {
  const steps = clamp(Math.floor(streak) - 1, 0, MAX_STREAK_STEPS);
  return Math.round((1 + steps * STREAK_STEP) * 100) / 100;
}

/** Geschwindigkeitsbonus: je mehr Zeit übrig ist, desto mehr Bonuspunkte. */
export function speedBonus(base: number, remainingFraction: number): number {
  return Math.round(base * MAX_SPEED_BONUS_RATIO * clamp(remainingFraction, 0, 1));
}

export function pointsForAnswer(input: {
  correct: boolean;
  difficulty: Difficulty;
  remainingFraction: number;
  streak: number;
}): PointsBreakdown {
  if (!input.correct) return { points: 0, base: 0, speedBonus: 0, multiplier: 1 };
  const base = BASE_POINTS[input.difficulty] ?? BASE_POINTS[2];
  const bonus = speedBonus(base, input.remainingFraction);
  const multiplier = streakMultiplier(input.streak);
  return { points: Math.round((base + bonus) * multiplier), base, speedBonus: bonus, multiplier };
}

/**
 * Flugzeit eines Meteoritenschwarms. Längere Texte erhalten mehr Lesezeit,
 * im Spielverlauf wird es leicht schneller (höchstens 25 %).
 */
export function roundDurationMs(
  content: { question: string; answers: readonly string[] },
  speed: SpeedSetting,
  roundIndex: number,
): number {
  const chars = content.question.length + content.answers.reduce((sum, a) => sum + a.length, 0);
  const reading = (chars / READING_CHARS_PER_SECOND) * 1000;
  const acceleration = Math.max(0.75, 1 - 0.02 * Math.max(0, roundIndex));
  const total = (BASE_DURATION_MS[speed] + reading) * acceleration;
  return Math.round(clamp(total, MIN_DURATION_MS, MAX_DURATION_MS));
}

// ------------------------------------------------------------------ Tippmodus

/** Punktabzug pro ausdrücklich abgeschickter falscher Eingabe (Punktestand nie unter 0). */
export const TYPING_WRONG_PENALTY = 10;
/** Grund-Fallzeit eines Meteoriten im Tippmodus (Tippen braucht mehr Zeit als Antippen). */
export const TYPING_BASE_DURATION_MS: Record<SpeedSetting, number> = { slow: 24000, normal: 17000, fast: 11000 };
export const TYPING_MIN_DURATION_MS = 8000;
export const TYPING_MAX_DURATION_MS = 60000;
/** Tippgeschwindigkeit, mit der die Länge der Lösung eingerechnet wird. */
const TYPING_CHARS_PER_SECOND = 3;

export function typingDurationMs(
  content: { question: string; solution: string },
  speed: SpeedSetting,
  roundIndex: number,
): number {
  const reading = (content.question.length / READING_CHARS_PER_SECOND) * 1000;
  const typing = (content.solution.length / TYPING_CHARS_PER_SECOND) * 1000;
  const acceleration = Math.max(0.75, 1 - 0.02 * Math.max(0, roundIndex));
  const total = (TYPING_BASE_DURATION_MS[speed] + reading + typing) * acceleration;
  return Math.round(clamp(total, TYPING_MIN_DURATION_MS, TYPING_MAX_DURATION_MS));
}
