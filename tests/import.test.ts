import { describe, expect, it } from 'vitest';
import { parseQuestionText } from '../src/import/textParser.ts';
import { parseQuestionJson } from '../src/import/jsonParser.ts';
import { classifyDuplicates } from '../src/import/duplicates.ts';
import { parseCorrect, parseDifficulty, validateDraft } from '../src/import/validate.ts';
import type { DraftQuestion } from '../src/domain/types.ts';

const EXAMPLE = `Frage: Was versteht man unter einer funktionalen Anforderung?

A) Eine Beschreibung einer Systemfunktion

B) Eine Vorgabe zur Hardwareleistung

C) Eine Beschreibung der Projektkosten

Richtig: A

Erklärung: Funktionale Anforderungen beschreiben die Funktionen eines Systems.`;

describe('Fragenimport – Textformat', () => {
  it('erkennt das Beispiel aus der Aufgabenstellung (mit Leerzeilen)', () => {
    const items = parseQuestionText(EXAMPLE);
    expect(items).toHaveLength(1);
    expect(items[0].errors).toEqual([]);
    expect(items[0].draft).toEqual({
      question: 'Was versteht man unter einer funktionalen Anforderung?',
      answers: ['Eine Beschreibung einer Systemfunktion', 'Eine Vorgabe zur Hardwareleistung', 'Eine Beschreibung der Projektkosten'],
      correctIndex: 0,
      explanation: 'Funktionale Anforderungen beschreiben die Funktionen eines Systems.',
      difficulty: 2,
      category: '',
    });
  });

  it('erkennt mehrere Fragen hintereinander inklusive Schwierigkeit und Kategorie', () => {
    const text = `${EXAMPLE}

Frage: Welcher HTTP-Statuscode bedeutet «Nicht gefunden»?
A) 200
B) 404
C) 500
Richtig: B
Schwierigkeit: leicht
Kategorie: Netzwerke

Frage: Was ist ein Primärschlüssel?
A) Ein Passwort
B) Die erste Spalte
C) Ein eindeutiges Merkmal jedes Datensatzes
Richtig: C
Erklärung: Er identifiziert Datensätze eindeutig.
Er darf nicht leer sein.`;
    const items = parseQuestionText(text);
    expect(items).toHaveLength(3);
    expect(items.every((i) => i.errors.length === 0)).toBe(true);
    expect(items[1].draft?.correctIndex).toBe(1);
    expect(items[1].draft?.difficulty).toBe(1);
    expect(items[1].draft?.category).toBe('Netzwerke');
    expect(items[2].draft?.correctIndex).toBe(2);
    expect(items[2].draft?.explanation).toBe('Er identifiziert Datensätze eindeutig.\nEr darf nicht leer sein.');
  });

  it('toleriert Windows-Zeilenumbrüche, Markdown, Kleinbuchstaben und «Richtig: b)»', () => {
    const text = '**Frage 1:** Was ist 2 + 2?\r\n- a) 3\r\n- b) 4\r\n- c) 5\r\n**Richtig:** b)\r\n';
    const [item] = parseQuestionText(text);
    expect(item.errors).toEqual([]);
    expect(item.draft?.question).toBe('Was ist 2 + 2?');
    expect(item.draft?.answers).toEqual(['3', '4', '5']);
    expect(item.draft?.correctIndex).toBe(1);
  });

  it('akzeptiert die Lösung als Antworttext', () => {
    const [item] = parseQuestionText('Frage: Hauptstadt der Schweiz?\nA) Zürich\nB) Bern\nC) Genf\nRichtig: Bern');
    expect(item.draft?.correctIndex).toBe(1);
  });

  it('erkennt Fragen ohne «Frage:»-Präfix, wenn Antworten folgen', () => {
    const items = parseQuestionText('Was ist 1+1?\nA) 1\nB) 2\nC) 3\nRichtig: B\n\nWas ist 2+2?\nA) 4\nB) 5\nC) 6\nRichtig: A');
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.draft?.correctIndex)).toEqual([1, 0]);
  });

  it('meldet fehlende Antworten, vier Antworten, fehlende und ungültige Lösungen', () => {
    const text = `Frage: Nur zwei Antworten?
A) Ja
B) Nein
Richtig: A

Frage: Vier Antworten?
A) 1
B) 2
C) 3
D) 4
Richtig: D

Frage: Ohne Lösung?
A) x
B) y
C) z

Frage: Falscher Buchstabe?
A) x
B) y
C) z
Richtig: D`;
    const items = parseQuestionText(text);
    expect(items).toHaveLength(4);
    expect(items.every((i) => i.draft === null)).toBe(true);
    expect(items[0].errors.join(' ')).toMatch(/Genau 3 Antworten/);
    expect(items[1].errors.join(' ')).toMatch(/gefunden: 4/);
    expect(items[2].errors.join(' ')).toMatch(/richtige Antwort fehlt/);
    expect(items[3].errors.join(' ')).toMatch(/nicht vorhandene Antwort/);
  });

  it('meldet gleiche Antworten und leeren Fragetext', () => {
    const items = parseQuestionText('Frage:\nA) gleich\nB) Gleich\nC) anders\nRichtig: C');
    expect(items[0].draft).toBeNull();
    expect(items[0].errors.join(' ')).toMatch(/Fragetext fehlt/);
    expect(items[0].errors.join(' ')).toMatch(/unterscheiden/);
  });

  it('übernimmt keinen Text stillschweigend, der zu keiner Frage gehört', () => {
    const items = parseQuestionText('Einleitung ohne Frage\n\nFrage: Test?\nA) a\nB) b\nC) c\nRichtig: A');
    expect(items).toHaveLength(2);
    expect(items[0].draft).toBeNull();
    expect(items[0].errors[0]).toMatch(/gehört zu keiner Frage/);
    expect(items[1].draft).not.toBeNull();
  });
});

describe('Fragenimport – JSON', () => {
  it('liest ein Array von Fragen nach dem Datenmodell', () => {
    const json = JSON.stringify([
      {
        id: '0b4c6a8e-1d2f-4a3b-9c8d-7e6f5a4b3c2d',
        question: 'Was ist TCP?',
        answers: ['Ein Protokoll', 'Eine Datenbank', 'Ein Editor'],
        correctIndex: 0,
        explanation: 'Transmission Control Protocol',
        difficulty: 'schwer',
        category: 'Netzwerke',
      },
    ]);
    const result = parseQuestionJson(json);
    expect(result.kind).toBe('questions');
    expect(result.items[0].errors).toEqual([]);
    expect(result.items[0].draft).toMatchObject({ correctIndex: 0, difficulty: 3, sourceId: '0b4c6a8e-1d2f-4a3b-9c8d-7e6f5a4b3c2d' });
  });

  it('liest ein Lernpaket-Objekt mit Name und Beschreibung', () => {
    const result = parseQuestionJson(
      JSON.stringify({ name: 'Java', description: 'Grundlagen', questions: [{ question: 'Q?', answers: ['a', 'b', 'c'], correctIndex: 2 }] }),
    );
    expect(result.kind).toBe('deck');
    expect(result.deckName).toBe('Java');
    expect(result.items[0].draft?.correctIndex).toBe(2);
  });

  it('meldet Fehler statt fehlerhafte Fragen zu übernehmen', () => {
    const result = parseQuestionJson(
      JSON.stringify([
        { question: 'Zwei Antworten', answers: ['a', 'b'], correctIndex: 0 },
        { question: 'Index zu gross', answers: ['a', 'b', 'c'], correctIndex: 3 },
        { answers: ['a', 'b', 'c'], correctIndex: 0 },
        'kein Objekt',
      ]),
    );
    expect(result.items).toHaveLength(4);
    expect(result.items.every((i) => i.draft === null && i.errors.length > 0)).toBe(true);
  });

  it('erkennt ungültiges JSON und Sicherungsdateien', () => {
    expect(parseQuestionJson('{kaputt').kind).toBe('invalid');
    expect(parseQuestionJson(JSON.stringify({ format: 'meteor-defense-backup', version: 1 })).kind).toBe('backup');
  });
});

describe('Fragenvalidierung', () => {
  const valid: DraftQuestion = {
    question: 'Frage?',
    answers: ['a', 'b', 'c'],
    correctIndex: 1,
    explanation: '',
    difficulty: 2,
    category: '',
  };

  it('akzeptiert eine gültige Frage', () => {
    expect(validateDraft(valid).errors).toEqual([]);
  });

  it('verlangt genau drei Antworten und eine gültige Lösung', () => {
    expect(validateDraft({ ...valid, answers: ['a', 'b'] as unknown as DraftQuestion['answers'] }).errors.length).toBeGreaterThan(0);
    expect(validateDraft({ ...valid, correctIndex: 5 as unknown as 0 }).errors.length).toBeGreaterThan(0);
  });

  it('warnt bei sehr langen Antworten', () => {
    expect(validateDraft({ ...valid, answers: ['a'.repeat(150), 'b', 'c'] }).warnings.length).toBe(1);
  });

  it('wandelt Schwierigkeit und Lösung um', () => {
    expect(parseDifficulty('Leicht')).toBe(1);
    expect(parseDifficulty('hard')).toBe(3);
    expect(parseDifficulty('extrem')).toBeNull();
    expect(parseCorrect('c', ['x', 'y', 'z'])).toBe(2);
    expect(parseCorrect('Antwort B', ['x', 'y', 'z'])).toBe(1);
    expect(parseCorrect('Y', ['x', 'y', 'z'])).toBe(1);
  });
});

describe('Duplikaterkennung', () => {
  const q = (question: string, answers: [string, string, string], correctIndex: 0 | 1 | 2 = 0): DraftQuestion => ({
    question,
    answers,
    correctIndex,
    explanation: '',
    difficulty: 2,
    category: '',
  });

  it('erkennt vorhandene Fragen trotz anderer Gross-/Kleinschreibung und Satzzeichen', () => {
    const existing = [{ id: 'e1', ...q('Was ist ein Byte?', ['8 Bit', '4 Bit', '16 Bit']) }];
    const info = classifyDuplicates([q('was ist ein byte', ['8 bit', '16 Bit', '4 Bit'], 0)], existing);
    expect(info[0].status).toBe('duplicate');
    expect(info[0].matchId).toBe('e1');
  });

  it('unterscheidet ähnliche Fragen mit anderen Antworten', () => {
    const existing = [{ id: 'e1', ...q('Was ist ein Byte?', ['8 Bit', '4 Bit', '16 Bit']) }];
    expect(classifyDuplicates([q('Was ist ein Byte?', ['Acht Bit', 'Vier Bit', 'Zwei Bit'])], existing)[0].status).toBe('similar');
  });

  it('erkennt Duplikate innerhalb derselben Importquelle und per ID', () => {
    const a = q('Neu?', ['1', '2', '3']);
    const info = classifyDuplicates([a, { ...a }, { ...q('Andere?', ['x', 'y', 'z']), sourceId: 'e1' }], [
      { id: 'e1', ...q('Alt?', ['a', 'b', 'c']) },
    ]);
    expect(info.map((i) => i.status)).toEqual(['new', 'duplicate', 'duplicate']);
  });
});
