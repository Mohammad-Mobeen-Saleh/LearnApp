import { describe, expect, it } from 'vitest';
import { SnakeEngine, SNAKE_MAP_SHORT_SIDE, SNAKE_STEP_MS, snakeGridSize, type Direction } from '../src/domain/snake.ts';
import type { GameQuestion } from '../src/domain/game.ts';
import { computeGameBreakdown, computeStats, filterByGame, gameOfType, sessionGameType } from '../src/domain/stats.ts';
import { GAMES, gameRoute, getGame } from '../src/games/registry.ts';
import { hasThreeValidAnswers } from '../src/games/questions.ts';
import { COLLECTIONS, sanitizeSettings } from '../src/sync/collections.ts';
import { MemoryServer } from './helpers/memoryServer.ts';
import { closeAllDevices, openDevice } from './helpers/devices.ts';
import { seededRandom } from '../src/lib/random.ts';
import type { AnswerEvent, Deck, GameSessionRecord, Question } from '../src/domain/types.ts';

const q = (id: string, answers: [string, string, string] = ['ولد (walad)', 'بنت (bint)', 'طفل (ṭifl)'], correctIndex: 0 | 1 | 2 = 0): GameQuestion => ({
  id,
  deckId: 'd1',
  question: `Junge / Kind (Singular) ${id}`,
  answers,
  correctIndex,
  explanation: '',
  difficulty: 2,
  category: '',
});

function engine(seed = 1, questions = [q('a'), q('b'), q('c')]) {
  return new SnakeEngine({ questions, cols: 17, rows: 17, random: seededRandom(seed) });
}

/** Fährt den Kopf zur gewünschten Frucht (x zuerst, dann y), ohne andere Früchte zu berühren. */
function driveTo(e: SnakeEngine, wantCorrect: boolean) {
  const target = e.fruits.find((f) => f.correct === wantCorrect)!;
  const opposite: Record<Direction, Direction> = { up: 'down', down: 'up', left: 'right', right: 'left' };
  const vec: Record<Direction, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const others = e.fruits.filter((f) => f !== target).map((f) => `${f.cell.x},${f.cell.y}`);
  const round = e.roundNumber;
  for (let i = 0; i < 300 && e.phase === 'playing' && e.roundNumber === round; i++) {
    const h = e.head;
    const wanted: Direction[] = [];
    if (target.cell.x > h.x) wanted.push('right');
    if (target.cell.x < h.x) wanted.push('left');
    if (target.cell.y > h.y) wanted.push('down');
    if (target.cell.y < h.y) wanted.push('up');
    const safe = (d: Direction) => {
      const n = [h.x + vec[d][0], h.y + vec[d][1]];
      return n[0] >= 0 && n[1] >= 0 && n[0] < e.cols && n[1] < e.rows && !others.includes(n.join(',')) && !e.snake.slice(0, -1).some((c) => c.x === n[0] && c.y === n[1]);
    };
    const d = wanted.find((w) => w !== opposite[e.direction] && safe(w)) ?? (['up', 'down', 'left', 'right'] as Direction[]).find((w) => w !== opposite[e.direction] && safe(w));
    if (d) e.turn(d);
    const r = e.step();
    if (r.type !== 'move') return r;
  }
  return null;
}

describe('Snake: Spielfeld und Einstellungen', () => {
  it('kleine Karte hat weniger Felder als die grosse, beide passen sich dem Seitenverhältnis an', () => {
    const smallPortrait = snakeGridSize('small', 390, 600);
    const largePortrait = snakeGridSize('large', 390, 600);
    const largeLandscape = snakeGridSize('large', 1200, 600);
    expect(Math.min(smallPortrait.cols, smallPortrait.rows)).toBe(SNAKE_MAP_SHORT_SIDE.small);
    expect(Math.min(largePortrait.cols, largePortrait.rows)).toBe(SNAKE_MAP_SHORT_SIDE.large);
    expect(smallPortrait.rows).toBeGreaterThan(smallPortrait.cols);
    expect(largeLandscape.cols).toBeGreaterThan(largeLandscape.rows);
    expect(smallPortrait.cols * smallPortrait.rows).toBeLessThan(largePortrait.cols * largePortrait.rows);
  });

  it('drei Geschwindigkeiten mit sinnvollen Intervallen', () => {
    expect(SNAKE_STEP_MS.slow).toBeGreaterThan(SNAKE_STEP_MS.medium);
    expect(SNAKE_STEP_MS.medium).toBeGreaterThan(SNAKE_STEP_MS.fast);
    expect(SNAKE_STEP_MS.fast).toBeGreaterThanOrEqual(80);
  });

  it('Snake-Einstellungen werden synchronisiert und unbekannte Werte verworfen', () => {
    expect(sanitizeSettings({ snakeMapSize: 'small', snakeSpeed: 'fast' })).toMatchObject({ snakeMapSize: 'small', snakeSpeed: 'fast' });
    expect(sanitizeSettings({ snakeMapSize: 'riesig', snakeSpeed: 3 })).toMatchObject({ snakeMapSize: 'large', snakeSpeed: 'medium' });
    // ältere Einstellungen ohne Snake-Felder bleiben gültig
    expect(sanitizeSettings({ speed: 'fast' })).toMatchObject({ speed: 'fast', snakeMapSize: 'large' });
  });
});

describe('Snake: Früchte und Antworten', () => {
  it('drei Früchte auf freien Feldern, genau eine richtig, Antworten unverändert', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const e = engine(seed);
      const question = e.start();
      expect(e.placeFruits()).toBe(true);
      expect(e.fruits).toHaveLength(3);
      expect(e.fruits.filter((f) => f.correct)).toHaveLength(1);
      expect(e.fruits.map((f) => f.answer).sort()).toEqual([...question.answers].sort());
      expect(e.fruits[e.correctSlot].answer).toBe(question.answers[question.correctIndex]);
      for (const f of e.fruits) {
        expect(f.cell.x).toBeGreaterThanOrEqual(0);
        expect(f.cell.y).toBeGreaterThanOrEqual(0);
        expect(f.cell.x).toBeLessThan(e.cols);
        expect(f.cell.y).toBeLessThan(e.rows);
        expect(e.snake.some((c) => c.x === f.cell.x && c.y === f.cell.y)).toBe(false);
      }
    }
  });

  it('die richtige Antwort landet zufällig auf jeder der drei Früchte', () => {
    const slots = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) {
      const e = engine(seed);
      e.start();
      slots.add(e.correctSlot);
    }
    expect([...slots].sort()).toEqual([0, 1, 2]);
  });

  it('Platzierungsprüfung (Platz für Beschriftungen) wird berücksichtigt', () => {
    const e = engine(3);
    e.start();
    const ok = e.placeFruits((cells) => cells.every((c) => c.y >= 2));
    expect(ok).toBe(true);
    expect(e.fruits.every((f) => f.cell.y >= 2)).toBe(true);
  });

  it('Fragen ohne drei gültige Antworten werden erkannt (und nicht ergänzt)', () => {
    expect(hasThreeValidAnswers(q('ok'))).toBe(true);
    expect(hasThreeValidAnswers({ answers: ['a', 'a', 'b'], correctIndex: 0 })).toBe(false);
    expect(hasThreeValidAnswers({ answers: ['a', '', 'b'], correctIndex: 0 })).toBe(false);
    expect(hasThreeValidAnswers({ answers: ['a', 'b'] as unknown as [string, string, string], correctIndex: 0 })).toBe(false);
  });
});

describe('Snake: Spielablauf', () => {
  it('richtige Frucht: wachsen, Punkte, nächste Frage mit neuen Früchten', () => {
    const e = engine(5);
    e.start();
    e.placeFruits();
    const r = driveTo(e, true);
    expect(r?.type).toBe('eat');
    expect(e.score).toBeGreaterThan(0);
    expect(e.correctCount).toBe(1);
    expect(e.roundNumber).toBe(2);
    expect(e.fruits).toHaveLength(0); // neue Früchte platziert die Ansicht (mit Beschriftungen)
    expect(e.placeFruits()).toBe(true);
    const before = e.length;
    e.step();
    expect(e.length).toBe(before + 1);
  });

  it('falsche Frucht: Bombe und Spielende', () => {
    const e = engine(6);
    e.start();
    e.placeFruits();
    const r = driveTo(e, false);
    expect(r?.type).toBe('bomb');
    expect(e.phase).toBe('over');
    expect(e.reason).toBe('bomb');
    expect(e.summary()).toMatchObject({ wrongCount: 1, correctCount: 0, rounds: 1 });
    expect(e.summary().missedQuestion?.id).toBe(e.question?.id);
  });

  it('Wand beendet das Spiel', () => {
    const e = engine(7);
    e.start();
    e.fruits = [];
    e.turn('up');
    let r = e.step();
    for (let i = 0; i < 40 && r.type === 'move'; i++) r = e.step();
    expect(r).toEqual({ type: 'crash', reason: 'wall' });
    expect(e.reason).toBe('wall');
  });

  it('eigener Körper beendet das Spiel', () => {
    const e = new SnakeEngine({ questions: [q('a')], cols: 17, rows: 17, random: seededRandom(1) });
    e.start();
    e.fruits = [];
    // Schlange künstlich verlängern und im Kreis fahren
    e.snake = [
      { x: 8, y: 8 },
      { x: 7, y: 8 },
      { x: 6, y: 8 },
      { x: 6, y: 9 },
      { x: 7, y: 9 },
      { x: 8, y: 9 },
      { x: 9, y: 9 }, // (8,9) ist damit nicht das Schwanzende, das im selben Schritt weiterzieht
    ];
    e.direction = 'right';
    e.turn('down');
    expect(e.step()).toEqual({ type: 'crash', reason: 'self' });
  });

  it('keine 180-Grad-Umkehr, auch nicht über zwei schnelle Eingaben', () => {
    const e = engine(8);
    e.start();
    e.fruits = [];
    expect(e.turn('left')).toBe(false);
    expect(e.turn('up')).toBe(true);
    expect(e.turn('down')).toBe(false); // Umkehr der gepufferten Richtung
    e.step();
    expect(e.direction).toBe('up');
  });

  it('Wiederholung endet nach der letzten Frage', () => {
    const e = new SnakeEngine({ questions: [q('x')], cols: 17, rows: 17, endless: false, mode: 'repeat', random: seededRandom(2) });
    e.start();
    e.placeFruits();
    expect(driveTo(e, true)?.type).toBe('eat');
    expect(e.phase).toBe('over');
    expect(e.reason).toBe('completed');
  });
});

describe('LernArcade: Spiele und gemeinsame Statistik', () => {
  it('Registry mit Meteor Defense und Snake, Routen mit Lernpaket', () => {
    expect(GAMES.map((g) => g.id)).toEqual(['meteor-defense', 'snake']);
    expect(getGame('snake')?.variants).toEqual(['snake']);
    expect(gameRoute('snake', { deckId: 'abc' })).toBe('/games/snake?deck=abc');
    expect(gameRoute('meteor-defense', { repeat: true })).toBe('/games/meteor-defense?mode=repeat');
    expect(gameOfType('typing')).toBe('meteor-defense');
    expect(gameOfType('snake')).toBe('snake');
  });

  it('Statistik je Spiel; bestehende Spiele ohne Modus zählen weiter zu Meteor Defense', () => {
    const now = '2026-01-01T00:00:00.000Z';
    const deck: Deck = { id: 'd1', name: 'Arabisch', description: '', deleted: false, version: 1, createdAt: now, updatedAt: now, deviceId: null };
    const questions: Question[] = [q('a'), q('b')].map((x) => ({ ...x, deleted: false, version: 1, createdAt: now, updatedAt: now, deviceId: null }));
    const session = (id: string, score: number, gameType?: GameSessionRecord['gameType']): GameSessionRecord => ({
      id, deckId: 'd1', mode: 'normal', ...(gameType ? { gameType } : {}), score, rounds: 1, correctCount: 1, wrongCount: 0, maxStreak: 1, startedAt: now, endedAt: now, deviceId: null,
    });
    const answer = (id: string, sessionId: string, outcome: AnswerEvent['outcome']): AnswerEvent => ({
      id, sessionId, deckId: 'd1', questionId: 'a', outcome, points: 0, responseMs: 0, answeredAt: now, deviceId: null,
    });
    const sessions = [session('old', 300), session('typ', 400, 'typing'), session('sn1', 700, 'snake'), session('sn2', 200, 'snake')];
    const answers = [answer('1', 'old', 'correct'), answer('2', 'typ', 'wrong'), answer('3', 'sn1', 'correct'), answer('4', 'sn1', 'correct'), answer('5', 'sn2', 'wrong')];
    expect(sessionGameType(sessions[0])).toBe('defense');
    expect(filterByGame(sessions, answers, 'snake').sessions).toHaveLength(2);
    const [meteor, snake] = computeGameBreakdown(sessions, answers, ['meteor-defense', 'snake']);
    expect(meteor).toMatchObject({ games: 2, rounds: 2, correct: 1, wrong: 1, highscore: 400, totalScore: 700 });
    expect(snake).toMatchObject({ games: 2, rounds: 3, correct: 2, wrong: 1, highscore: 700, totalScore: 900 });
    const input = { decks: [deck], questions, sessions, answers };
    expect(computeStats(input).games).toBe(4);
    expect(computeStats(input, { game: 'snake' })).toMatchObject({ games: 2, highscore: 700 });
    expect(computeStats(input, { game: 'meteor-defense' })).toMatchObject({ games: 2, highscore: 400 });
    expect(computeStats(input, { gameType: 'typing' })).toMatchObject({ games: 1 });
  });
});

describe('LernArcade: Synchronisierung der Snake-Daten', () => {
  it('Snake-Spiel und Snake-Einstellungen erscheinen auf dem zweiten Gerät', async () => {
    const server = new MemoryServer();
    const laptop = await openDevice('laptop', server.remote(), { seed: true });
    const iphone = await openDevice('iphone', server.remote(), { seed: true });
    const now = new Date().toISOString();
    await laptop.store.recordSession({ deckId: null, mode: 'normal', gameType: 'snake', score: 640, rounds: 5, correctCount: 4, wrongCount: 1, maxStreak: 4, startedAt: now, endedAt: now });
    await laptop.store.updateSettings({ snakeMapSize: 'small', snakeSpeed: 'fast' });
    await laptop.sync.sync();
    await iphone.sync.sync();
    const sessions = await iphone.store.listSessions();
    expect(sessions.map((x) => [x.gameType, x.score])).toEqual([['snake', 640]]);
    expect(await iphone.store.getSettings()).toMatchObject({ snakeMapSize: 'small', snakeSpeed: 'fast' });
    expect(server.rows('game_sessions')[0].game_type).toBe('snake');
    expect(COLLECTIONS.game_sessions.fromServer({ ...server.rows('game_sessions')[0] }).gameType).toBe('snake');
    closeAllDevices();
  });
});
