import { describe, expect, it } from 'vitest';
import { GameController, type GameQuestion } from '../src/domain/game.ts';
import { TypingController } from '../src/domain/typing.ts';
import { ShuffledQueue } from '../src/domain/questionQueue.ts';
import { acceptedSolutions, isTypedAnswerCorrect, normalizeAnswer } from '../src/domain/answerCheck.ts';
import { TYPING_WRONG_PENALTY, typingDurationMs } from '../src/domain/scoring.ts';
import { computeStats } from '../src/domain/stats.ts';
import { parseQuestionText } from '../src/import/textParser.ts';
import { parseQuestionJson } from '../src/import/jsonParser.ts';
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

const money: GameQuestion = {
  id: 'money',
  deckId: 'd1',
  question: 'Übersetze ins Deutsche: Money',
  answers: ['Haus', 'Geld', 'Baum'],
  correctIndex: 1,
  explanation: '',
  difficulty: 1,
  category: 'Englisch',
  acceptedAnswers: ['Zaster'],
};

describe('Fragenstapel (Endlos)', () => {
  it('stellt jede Frage einmal, bevor neu gemischt wird, und wiederholt die letzte nicht direkt', () => {
    const items = makeQuestions(7);
    const queue = new ShuffledQueue(items, { random: seededRandom(11) });
    for (let cycle = 0; cycle < 20; cycle++) {
      const seen = Array.from({ length: 7 }, () => queue.next()!.id);
      expect(new Set(seen).size).toBe(7);
    }
    let previous = '';
    const q2 = new ShuffledQueue(items, { random: seededRandom(3) });
    for (let i = 0; i < 300; i++) {
      const id = q2.next()!.id;
      expect(id).not.toBe(previous);
      previous = id;
    }
  });

  it('endet im Wiederholungsmodus nach einem Durchgang', () => {
    const queue = new ShuffledQueue(makeQuestions(2), { endless: false });
    expect(queue.next()).not.toBeNull();
    expect(queue.next()).not.toBeNull();
    expect(queue.next()).toBeNull();
  });
});

describe('Abwehrmodus (kontinuierlich)', () => {
  const endless = (qs: GameQuestion[], seed = 1) =>
    new GameController({ questions: qs, lives: 1, endless: true, repeatWrongInGame: false, random: seededRandom(seed) });

  it('richtige Antwort → nächste Frage unmittelbar, ohne Rückmeldungsphase; läuft über das Paketende hinaus', () => {
    const game = endless(makeQuestions(3));
    let round = game.start();
    for (let i = 0; i < 10; i++) {
      const result = game.answer(round.correctSlot, 500);
      expect(result.outcome).toBe('correct');
      // direkt aus der Abschussphase weiter – kein reveal()/Bestätigung nötig
      const next = game.next();
      expect(next).not.toBeNull();
      round = next!;
    }
    expect(game.roundNumber).toBe(11);
    expect(game.correctCount).toBe(10);
    expect(game.totalRounds).toBe(Infinity);
    expect(game.score).toBeGreaterThan(10 * 100);
  });

  it('eine falsche Antwort beendet das Spiel sofort', () => {
    const game = endless(makeQuestions(5));
    let round = game.start();
    game.answer(round.correctSlot, 100);
    round = game.next()!;
    game.answer((round.correctSlot + 1) % 3, 100);
    expect(game.next()).toBeNull();
    expect(game.phase).toBe('over');
    expect(game.reason).toBe('lives');
    const s = game.summary();
    expect(s.correctCount).toBe(1);
    expect(s.wrongCount).toBe(1);
    expect(s.wrongQuestions.map((q) => q.id)).toEqual([round.question.id]);
  });

  it('abgelaufene Zeit beendet das Spiel ebenfalls', () => {
    const game = endless(makeQuestions(5));
    game.start();
    game.timeout();
    expect(game.next()).toBeNull();
    expect(game.phase).toBe('over');
  });

  it('Geschwindigkeitsbonus bleibt erhalten: schnelle Antwort bringt mehr Punkte', () => {
    const fast = endless(makeQuestions(3), 5);
    const slow = endless(makeQuestions(3), 5);
    const rf = fast.start();
    const rs = slow.start();
    expect(fast.answer(rf.correctSlot, 0).points).toBeGreaterThan(slow.answer(rs.correctSlot, rs.durationMs - 1).points);
  });

  it('Tempo-Einstellung wirkt: «Schnell» ergibt kürzere Flugzeit als «Gemütlich»', () => {
    const qs = makeQuestions(1);
    const a = new GameController({ questions: qs, lives: 1, endless: true, speed: 'fast' }).start();
    const b = new GameController({ questions: qs, lives: 1, endless: true, speed: 'slow' }).start();
    expect(a.durationMs).toBeLessThan(b.durationMs);
  });
});

describe('Antwortprüfung Tippmodus', () => {
  it('ignoriert Gross-/Kleinschreibung, Leerzeichen und Unicode-Varianten', () => {
    for (const input of ['Geld', 'geld', '  GELD ', 'gEld\t']) expect(isTypedAnswerCorrect(input, money)).toBe(true);
    expect(normalizeAnswer('  Neue   Zürcher ')).toBe('neue zürcher');
    // «ü» als u + kombinierendes Trema
    expect(normalizeAnswer('Zu\u0308rich')).toBe(normalizeAnswer('Zürich'));
    expect(isTypedAnswerCorrect('Haus', money)).toBe(false);
    expect(isTypedAnswerCorrect('   ', money)).toBe(false);
  });

  it('akzeptiert answers[correctIndex] und zusätzliche acceptedAnswers', () => {
    expect(acceptedSolutions(money)).toEqual(['Geld', 'Zaster']);
    expect(isTypedAnswerCorrect('zaster', money)).toBe(true);
    const { acceptedAnswers: _ignored, ...withoutAccepted } = money;
    expect(isTypedAnswerCorrect('Geld', withoutAccepted)).toBe(true);
  });
});

describe('Tippmodus', () => {
  const typing = (qs: GameQuestion[] = [money, ...makeQuestions(3)]) => new TypingController({ questions: qs, random: seededRandom(2) });

  it('richtige Eingabe zerstört den Meteoriten, gibt Punkte und startet sofort die nächste Frage', () => {
    const game = typing([money]);
    game.start();
    const r = game.submit(' GELD ', 1000);
    expect(r.kind).toBe('correct');
    if (r.kind === 'correct') expect(r.points).toBeGreaterThan(80);
    expect(game.phase).toBe('resolving');
    const next = game.next();
    expect(next).not.toBeNull();
    expect(game.phase).toBe('playing');
    expect(game.roundNumber).toBe(2);
  });

  it('falsche Eingabe zieht 10 Punkte ab (nie unter 0), beendet das Spiel aber nicht', () => {
    const game = typing([money]);
    game.start();
    const first = game.submit('Haus', 100);
    expect(first).toMatchObject({ kind: 'wrong', penalty: 0, score: 0 });
    expect(game.phase).toBe('playing');
    game.submit('Geld', 200);
    game.next();
    const score = game.score;
    const wrong = game.submit('falsch', 300);
    expect(wrong).toMatchObject({ kind: 'wrong', penalty: TYPING_WRONG_PENALTY, score: score - TYPING_WRONG_PENALTY });
    expect(game.phase).toBe('playing');
    // erneuter Versuch derselben Runde möglich
    expect(game.submit('geld', 400).kind).toBe('correct');
  });

  it('leere Eingaben und Eingaben ausserhalb der Runde werden nicht verarbeitet (kein doppelter Abzug)', () => {
    const game = typing([money]);
    expect(game.submit('Geld', 0)).toEqual({ kind: 'ignored', reason: 'not_playing' });
    game.start();
    expect(game.submit('   ', 0)).toEqual({ kind: 'ignored', reason: 'empty' });
    expect(game.wrongAttempts).toBe(0);
    game.submit('Geld', 0);
    // zweites Abschicken während der Abschussanimation
    expect(game.submit('Geld', 0)).toEqual({ kind: 'ignored', reason: 'not_playing' });
    expect(game.correctCount).toBe(1);
  });

  it('Einschlag im Schutzschild → Game Over mit der verpassten Frage', () => {
    const game = typing([money]);
    game.start();
    game.submit('Haus', 100);
    expect(game.impact()?.id).toBe('money');
    expect(game.submit('Geld', 0).kind).toBe('ignored');
    expect(game.next()).toBeNull();
    expect(game.phase).toBe('over');
    const s = game.summary();
    expect(s.reason).toBe('impact');
    expect(s.missedQuestion?.id).toBe('money');
    expect(s.wrongCount).toBe(1);
    expect(s.wrongQuestions.map((q) => q.id)).toEqual(['money']);
  });

  it('läuft endlos und mischt neu; Wiederholung endet nach einem Durchgang', () => {
    const endless = typing(makeQuestions(2));
    let round = endless.start();
    for (let i = 0; i < 6; i++) {
      endless.submit(round.solution, 100);
      round = endless.next()!;
    }
    expect(endless.roundNumber).toBe(7);
    const repeat = new TypingController({ questions: makeQuestions(2), endless: false, mode: 'repeat' });
    let r = repeat.start();
    repeat.submit(r.solution, 0);
    r = repeat.next()!;
    repeat.submit(r.solution, 0);
    expect(repeat.next()).toBeNull();
    expect(repeat.reason).toBe('completed');
  });

  it('gibt längeren Lösungen und langsamem Tempo mehr Fallzeit', () => {
    const short = typingDurationMs({ question: 'Money?', solution: 'Geld' }, 'normal', 0);
    expect(typingDurationMs({ question: 'Money?', solution: 'Eine sehr lange Lösung zum Tippen' }, 'normal', 0)).toBeGreaterThan(short);
    expect(typingDurationMs({ question: 'Money?', solution: 'Geld' }, 'slow', 0)).toBeGreaterThan(short);
    expect(typingDurationMs({ question: 'Money?', solution: 'Geld' }, 'fast', 0)).toBeLessThan(short);
  });
});

describe('Import: zusätzliche akzeptierte Antworten', () => {
  it('Textformat «Auch richtig:» und JSON acceptedAnswers', () => {
    const [item] = parseQuestionText('Frage: Übersetze: Money\nA) Haus\nB) Geld\nC) Baum\nRichtig: B\nAuch richtig: Zaster; Moneten | geld');
    expect(item.errors).toEqual([]);
    expect(item.draft?.acceptedAnswers).toEqual(['Zaster', 'Moneten']);
    const json = parseQuestionJson(JSON.stringify([{ question: 'Money', answers: ['Haus', 'Geld', 'Baum'], correctIndex: 1, acceptedAnswers: ['Kohle'] }]));
    expect(json.items[0].draft?.acceptedAnswers).toEqual(['Kohle']);
    const plain = parseQuestionJson(JSON.stringify([{ question: 'Money', answers: ['Haus', 'Geld', 'Baum'], correctIndex: 1 }]));
    expect(plain.items[0].draft?.acceptedAnswers).toBeUndefined();
  });
});

describe('Statistik getrennt nach Spielmodus', () => {
  it('ordnet Spiele und Antworten dem Modus zu (ältere Daten ohne Modus = Abwehrmodus)', () => {
    const now = '2026-01-01T00:00:00.000Z';
    const deck: Deck = { id: 'd1', name: 'Englisch', description: '', deleted: false, version: 1, createdAt: now, updatedAt: now, deviceId: null };
    const questions: Question[] = makeQuestions(2).map((q) => ({ ...q, deleted: false, version: 1, createdAt: now, updatedAt: now, deviceId: null }));
    const session = (id: string, score: number, gameType?: 'defense' | 'typing'): GameSessionRecord => ({
      id, deckId: 'd1', mode: 'normal', ...(gameType ? { gameType } : {}), score, rounds: 1, correctCount: 1, wrongCount: 0, maxStreak: 1, startedAt: now, endedAt: now, deviceId: null,
    });
    const answer = (id: string, sessionId: string, questionId: string, outcome: AnswerEvent['outcome']): AnswerEvent => ({
      id, sessionId, deckId: 'd1', questionId, outcome, points: 0, responseMs: 0, answeredAt: now, deviceId: null,
    });
    const sessions = [session('old', 300), session('def', 500, 'defense'), session('typ', 900, 'typing')];
    const answers = [answer('a1', 'old', 'q0', 'correct'), answer('a2', 'def', 'q1', 'wrong'), answer('a3', 'typ', 'q0', 'correct'), answer('a4', 'typ', 'q1', 'timeout')];
    const input = { decks: [deck], questions, sessions, answers };
    const all = computeStats(input);
    const defense = computeStats(input, { gameType: 'defense' });
    const typing = computeStats(input, { gameType: 'typing' });
    expect(all.games).toBe(3);
    expect(defense).toMatchObject({ games: 2, rounds: 2, highscore: 500, correct: 1, wrong: 1 });
    expect(typing).toMatchObject({ games: 1, rounds: 2, highscore: 900, correct: 1, wrong: 1 });
  });
});
