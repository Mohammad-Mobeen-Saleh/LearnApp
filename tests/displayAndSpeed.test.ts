import { describe, expect, it } from 'vitest';
import { containsRtl, paragraphDirection, splitBidiSegments } from '../src/lib/bidi.ts';
import { GameController, type GameQuestion } from '../src/domain/game.ts';
import { TypingController } from '../src/domain/typing.ts';
import { BASE_POINTS, remainingFraction, roundDurationMs, typingDurationMs } from '../src/domain/scoring.ts';
import { sanitizeSettings } from '../src/sync/collections.ts';
import { SPEED_LABELS } from '../src/domain/types.ts';

describe('Gemischte arabisch-lateinische Texte', () => {
  it('trennt Arabisch und Umschrift, ohne den Text zu verändern', () => {
    expect(splitBidiSegments('حَدِيقَة (ḥadīqa)')).toEqual([
      { text: 'حَدِيقَة', dir: 'rtl' },
      { text: '(ḥadīqa)', dir: 'ltr' },
    ]);
    expect(splitBidiSegments('بِجِوَار (bi-ǧiwār)')).toEqual([
      { text: 'بِجِوَار', dir: 'rtl' },
      { text: '(bi-ǧiwār)', dir: 'ltr' },
    ]);
  });

  it('hält Vokalzeichen beim Buchstaben und mehrere arabische Wörter zusammen', () => {
    const [seg] = splitBidiSegments('فِي الْبَيْتِ');
    expect(seg).toEqual({ text: 'فِي الْبَيْتِ', dir: 'rtl' });
    // jedes Zeichen des Originals bleibt erhalten (nur NFC-normalisiert)
    expect(splitBidiSegments('خَلْفَ (ḫalfa)').map((s) => s.text).join(' ')).toBe('خَلْفَ (ḫalfa)'.normalize('NFC'));
  });

  it('erkennt Umschrift zuerst, Arabisch danach, und reine deutsche/englische Texte', () => {
    expect(splitBidiSegments('Garten – حَدِيقَة')).toEqual([
      { text: 'Garten –', dir: 'ltr' },
      { text: 'حَدِيقَة', dir: 'rtl' },
    ]);
    expect(splitBidiSegments('neben / in der Nähe von')).toEqual([{ text: 'neben / in der Nähe von', dir: 'ltr' }]);
    expect(containsRtl('Money')).toBe(false);
    expect(paragraphDirection('حَدِيقَة (ḥadīqa)')).toBe('rtl');
    expect(paragraphDirection('Geld')).toBe('ltr');
  });
});

const q = (id: string, question = 'Money?'): GameQuestion => ({
  id,
  deckId: 'd',
  question,
  answers: ['Haus', 'Geld', 'Baum'],
  correctIndex: 1,
  explanation: '',
  difficulty: 2,
  category: '',
});

describe('Geschwindigkeit «Stillstand»', () => {
  it('ist als Einstellung wählbar und wird beim Synchronisieren nicht verworfen', () => {
    expect(SPEED_LABELS.still).toBe('Stillstand (unbegrenzte Zeit)');
    expect(sanitizeSettings({ speed: 'still' }).speed).toBe('still');
    expect(sanitizeSettings({ speed: 'unbekannt' }).speed).toBe('normal');
  });

  it('ergibt unbegrenzte Zeit in beiden Modi, die übrigen Tempi bleiben unverändert', () => {
    expect(roundDurationMs({ question: 'x', answers: ['a', 'b', 'c'] }, 'still', 0)).toBe(Infinity);
    expect(typingDurationMs({ question: 'x', solution: 'y' }, 'still', 0)).toBe(Infinity);
    expect(Number.isFinite(roundDurationMs({ question: 'x', answers: ['a', 'b', 'c'] }, 'normal', 0))).toBe(true);
    expect(remainingFraction(1000, Infinity)).toBe(0);
    expect(remainingFraction(0, 4000)).toBe(1);
  });

  it('Abwehrmodus: Punkte ohne Tempobonus, falsche Antwort beendet weiterhin das Spiel', () => {
    const game = new GameController({ questions: [q('a'), q('b')], speed: 'still', lives: 1, endless: true });
    const round = game.start();
    expect(round.durationMs).toBe(Infinity);
    const r = game.answer(round.correctSlot, 120_000);
    expect(r.points).toBe(BASE_POINTS[2]);
    expect(r.speedBonus).toBe(0);
    expect(r.responseMs).toBe(120_000);
    const next = game.next()!;
    game.answer((next.correctSlot + 1) % 3, 10);
    expect(game.next()).toBeNull();
    expect(game.reason).toBe('lives');
  });

  it('Tippmodus: beliebig lange Zeit, Fehleingaben ziehen weiterhin Punkte ab, Beenden liefert das Ergebnis', () => {
    const game = new TypingController({ questions: [q('a'), q('b')], speed: 'still' });
    const round = game.start();
    expect(round.durationMs).toBe(Infinity);
    const hit = game.submit('geld', 600_000);
    expect(hit).toMatchObject({ kind: 'correct', points: BASE_POINTS[2], speedBonus: 0 });
    game.next();
    expect(game.submit('falsch', 1)).toMatchObject({ kind: 'wrong', penalty: 10 });
    expect(game.phase).toBe('playing');
    game.quit();
    expect(game.summary()).toMatchObject({ reason: 'quit', correctCount: 1, wrongCount: 1, missedQuestion: null });
  });
});
