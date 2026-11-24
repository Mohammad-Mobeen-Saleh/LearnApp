import { describe, expect, it } from 'vitest';
import { GameController, START_LIVES, type GameQuestion } from '../src/domain/game.ts';
import { pointsForAnswer, roundDurationMs, speedBonus, streakMultiplier } from '../src/domain/scoring.ts';
import { computeStats } from '../src/domain/stats.ts';
import { seededRandom } from '../src/lib/random.ts';
import type { AnswerEvent, Deck, GameSessionRecord, Question } from '../src/domain/types.ts';

function makeQuestions(n: number): GameQuestion[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `q${i}`,
    deckId: 'd1',
    question: `Frage ${i}?`,
    answers: [`A${i}`, `B${i}`, `C${i}`],
    correctIndex: (i % 3) as 0 | 1 | 2,
    explanation: '',
    difficulty: 2,
    category: '',
  }));
}

describe('Punkteberechnung', () => {
  it('vergibt Grundpunkte nach Schwierigkeit plus Geschwindigkeitsbonus', () => {
    expect(pointsForAnswer({ correct: true, difficulty: 2, remainingFraction: 1, streak: 1 })).toEqual({
      points: 150,
      base: 100,
      speedBonus: 50,
      multiplier: 1,
    });
    expect(pointsForAnswer({ correct: true, difficulty: 2, remainingFraction: 0, streak: 1 }).points).toBe(100);
    expect(pointsForAnswer({ correct: true, difficulty: 3, remainingFraction: 0.5, streak: 1 }).points).toBe(130 + 33);
    expect(pointsForAnswer({ correct: true, difficulty: 1, remainingFraction: 0.5, streak: 1 }).points).toBe(80 + 20);
  });

  it('gibt für falsche Antworten keine Punkte', () => {
    expect(pointsForAnswer({ correct: false, difficulty: 3, remainingFraction: 1, streak: 5 }).points).toBe(0);
  });

  it('erhöht den Serienbonus um 10 % pro Treffer, höchstens 50 %', () => {
    expect(streakMultiplier(1)).toBe(1);
    expect(streakMultiplier(2)).toBe(1.1);
    expect(streakMultiplier(6)).toBe(1.5);
    expect(streakMultiplier(20)).toBe(1.5);
    expect(pointsForAnswer({ correct: true, difficulty: 2, remainingFraction: 1, streak: 6 }).points).toBe(225);
  });

  it('begrenzt den Geschwindigkeitsbonus auf 0–50 %', () => {
    expect(speedBonus(100, 2)).toBe(50);
    expect(speedBonus(100, -1)).toBe(0);
  });

  it('gibt längeren Texten mehr Lesezeit', () => {
    const short = roundDurationMs({ question: 'Kurz?', answers: ['a', 'b', 'c'] }, 'normal', 0);
    const long = roundDurationMs({ question: 'x'.repeat(200), answers: ['y'.repeat(60), 'z'.repeat(60), 'w'.repeat(60)] }, 'normal', 0);
    expect(long).toBeGreaterThan(short);
    expect(roundDurationMs({ question: 'Kurz?', answers: ['a', 'b', 'c'] }, 'slow', 0)).toBeGreaterThan(short);
  });
});

describe('Spielablauf: richtige und falsche Antworten', () => {
  it('zählt richtige Antworten, Punkte und Serien', () => {
    const game = new GameController({ questions: makeQuestions(5), random: seededRandom(1), questionsPerGame: 0 });
    const round = game.start();
    const result = game.answer(round.correctSlot, 0);
    expect(result.outcome).toBe('correct');
    expect(result.points).toBe(150);
    expect(game.score).toBe(150);
    expect(game.lives).toBe(START_LIVES);
    expect(game.streak).toBe(1);
    game.reveal();
    const second = game.next()!;
    game.answer(second.correctSlot, 0);
    expect(game.streak).toBe(2);
    expect(game.score).toBe(150 + 165);
  });

  it('zieht bei falscher Antwort und abgelaufener Zeit je ein Leben ab', () => {
    const game = new GameController({ questions: makeQuestions(6), random: seededRandom(2) });
    const r1 = game.start();
    const wrongSlot = (r1.correctSlot + 1) % 3;
    const res = game.answer(wrongSlot, 1000);
    expect(res.outcome).toBe('wrong');
    expect(res.points).toBe(0);
    expect(game.lives).toBe(2);
    expect(game.streak).toBe(0);
    game.reveal();
    game.next();
    const timeout = game.timeout();
    expect(timeout.outcome).toBe('timeout');
    expect(game.lives).toBe(1);
  });

  it('beendet das Spiel nach drei Fehlern (Game Over) und merkt sich falsche Fragen', () => {
    const game = new GameController({ questions: makeQuestions(10), random: seededRandom(3), repeatWrongInGame: false });
    let round = game.start();
    for (let i = 0; i < 3; i++) {
      game.answer((round.correctSlot + 1) % 3, 100);
      game.reveal();
      const next = game.next();
      if (i < 2) round = next!;
      else expect(next).toBeNull();
    }
    expect(game.phase).toBe('over');
    expect(game.reason).toBe('lives');
    expect(game.summary().wrongQuestions).toHaveLength(3);
    expect(game.summary().accuracy).toBe(0);
  });

  it('stellt falsch beantwortete Fragen im selben Spiel erneut', () => {
    const game = new GameController({ questions: makeQuestions(4), random: seededRandom(4), questionsPerGame: 0 });
    const first = game.start();
    const firstId = first.question.id;
    game.answer((first.correctSlot + 1) % 3, 100);
    game.reveal();
    const seen: string[] = [];
    let round = game.next();
    while (round) {
      seen.push(round.question.id);
      game.answer(round.correctSlot, 0);
      game.reveal();
      round = game.next();
    }
    expect(seen.filter((id) => id === firstId)).toHaveLength(1);
    expect(game.reason).toBe('completed');
    expect(game.summary().rounds).toBe(5);
  });

  it('begrenzt die Anzahl Fragen pro Spiel', () => {
    const game = new GameController({ questions: makeQuestions(30), questionsPerGame: 10, random: seededRandom(5) });
    game.start();
    expect(game.totalRounds).toBe(10);
  });

  it('mischt die Antworten, hält aber die richtige Antwort nach', () => {
    const qs = makeQuestions(1);
    const game = new GameController({ questions: qs, random: seededRandom(9) });
    const round = game.start();
    expect(round.answers[round.correctSlot]).toBe(qs[0].answers[qs[0].correctIndex]);
  });
});

describe('Statistik', () => {
  it('berechnet Erfolgsquote, Highscore, Fortschritt pro Fach und Wiederholungsfragen', () => {
    const now = '2026-01-01T00:00:00.000Z';
    const deck: Deck = { id: 'd1', name: 'Java', description: '', deleted: false, version: 1, createdAt: now, updatedAt: now, deviceId: null };
    const questions: Question[] = makeQuestions(3).map((q) => ({ ...q, deleted: false, version: 1, createdAt: now, updatedAt: now, deviceId: null }));
    const answer = (id: string, questionId: string, outcome: AnswerEvent['outcome'], t: number): AnswerEvent => ({
      id,
      sessionId: 's1',
      deckId: 'd1',
      questionId,
      outcome,
      points: outcome === 'correct' ? 100 : 0,
      responseMs: 1000,
      answeredAt: new Date(Date.parse(now) + t * 1000).toISOString(),
      deviceId: 'laptop',
    });
    const answers = [answer('a1', 'q0', 'wrong', 1), answer('a2', 'q0', 'correct', 2), answer('a3', 'q1', 'correct', 3), answer('a4', 'q1', 'timeout', 4)];
    const sessions: GameSessionRecord[] = [
      { id: 's1', deckId: 'd1', mode: 'normal', score: 300, rounds: 4, correctCount: 2, wrongCount: 2, maxStreak: 2, startedAt: now, endedAt: now, deviceId: 'laptop' },
      { id: 's2', deckId: 'd1', mode: 'normal', score: 900, rounds: 6, correctCount: 6, wrongCount: 0, maxStreak: 6, startedAt: now, endedAt: now, deviceId: 'iphone' },
    ];
    const stats = computeStats({ decks: [deck], questions, sessions, answers });
    expect(stats.games).toBe(2);
    expect(stats.rounds).toBe(4);
    expect(stats.correct).toBe(2);
    expect(stats.wrong).toBe(2);
    expect(stats.successRate).toBe(0.5);
    expect(stats.highscore).toBe(900);
    expect(stats.repeatQuestionIds).toEqual(['q1']);
    expect(stats.decks[0]).toMatchObject({ total: 3, mastered: 1, toRepeat: 1, unseen: 1 });
  });
});
