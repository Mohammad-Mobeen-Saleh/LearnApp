import { isUuid } from '../lib/uuid.ts';
import type { Difficulty, DraftQuestion } from '../domain/types.ts';
import type { ParsedItem } from './textParser.ts';
import { cleanDraft, parseCorrect, parseDifficulty, validateDraft } from './validate.ts';

/**
 * JSON-Import. Unterstützte Formen:
 *  1. Array von Fragen: [{ "question": "...", "answers": ["..","..",".."], "correctIndex": 0, ... }]
 *  2. Lernpaket:        { "name": "Java", "description": "...", "questions": [ ... ] }
 *  3. Vollständige Sicherung ("format": "meteor-defense-backup") → wird an die Wiederherstellung verwiesen
 *
 * Datenmodell einer Frage: id, question, answers (genau 3), correctIndex (0–2),
 * explanation, difficulty (1–3 bzw. leicht/mittel/schwer), category und optional
 * acceptedAnswers (weitere gültige Schreibweisen für den Tippmodus).
 */

export type JsonImportKind = 'questions' | 'deck' | 'backup';

export interface JsonImportResult {
  kind: JsonImportKind | 'invalid';
  deckName: string | null;
  deckDescription: string | null;
  items: ParsedItem[];
  error: string | null;
  raw: unknown;
}

export const DECK_EXPORT_FORMAT = 'meteor-defense-deck';
export const BACKUP_FORMAT = 'meteor-defense-backup';

function invalid(error: string, raw: unknown = null): JsonImportResult {
  return { kind: 'invalid', deckName: null, deckDescription: null, items: [], error, raw };
}

export function parseQuestionJson(text: string): JsonImportResult {
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (err) {
    return invalid(`Die Datei ist kein gültiges JSON: ${(err as Error).message}`);
  }
  if (Array.isArray(data)) {
    return { kind: 'questions', deckName: null, deckDescription: null, items: data.map(parseJsonQuestion), error: null, raw: data };
  }
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (obj.format === BACKUP_FORMAT) {
      return { kind: 'backup', deckName: null, deckDescription: null, items: [], error: null, raw: data };
    }
    // Lernpaket (eigenes Exportformat oder { name, questions })
    const deck = (obj.deck && typeof obj.deck === 'object' ? obj.deck : obj) as Record<string, unknown>;
    const questions = obj.questions;
    if (Array.isArray(questions)) {
      return {
        kind: 'deck',
        deckName: typeof deck.name === 'string' && deck.name.trim() ? deck.name.trim() : null,
        deckDescription: typeof deck.description === 'string' ? deck.description.trim() : null,
        items: questions.map(parseJsonQuestion),
        error: null,
        raw: data,
      };
    }
    if ('question' in obj) {
      return { kind: 'questions', deckName: null, deckDescription: null, items: [parseJsonQuestion(obj, 0)], error: null, raw: data };
    }
  }
  return invalid('Unbekanntes JSON-Format. Erwartet wird ein Array von Fragen oder ein Objekt mit «questions».', data);
}

function parseJsonQuestion(value: unknown, position: number): ParsedItem {
  const base: ParsedItem = { index: position + 1, line: position + 1, draft: null, errors: [], warnings: [], preview: '' };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...base, errors: ['Eintrag ist kein Objekt.'], preview: String(value).slice(0, 80) };
  }
  const q = value as Record<string, unknown>;
  const errors: string[] = [];
  const warnings: string[] = [];

  const question = typeof q.question === 'string' ? q.question : '';
  if (typeof q.question !== 'string') errors.push('Feld «question» fehlt oder ist kein Text.');

  let answers: string[] = [];
  if (!Array.isArray(q.answers)) {
    errors.push('Feld «answers» fehlt oder ist keine Liste.');
  } else {
    if (q.answers.some((a) => typeof a !== 'string')) errors.push('Alle Antworten müssen Texte sein.');
    answers = q.answers.map((a) => (typeof a === 'string' ? a : ''));
    if (answers.length !== 3) errors.push(`Genau 3 Antworten erforderlich (gefunden: ${answers.length}).`);
  }

  let correctIndex: number | null = null;
  const rawCorrect = q.correctIndex ?? q.correct ?? q.answer;
  if (rawCorrect === undefined) {
    errors.push('Feld «correctIndex» fehlt (0, 1 oder 2).');
  } else if (typeof rawCorrect === 'number' || (typeof rawCorrect === 'string' && /^\d+$/.test(rawCorrect.trim()))) {
    const n = Number(rawCorrect);
    if (Number.isInteger(n) && n >= 0 && n <= 2) correctIndex = n;
    else errors.push(`«correctIndex» muss 0, 1 oder 2 sein (gefunden: ${String(rawCorrect)}).`);
  } else {
    correctIndex = parseCorrect(rawCorrect, answers);
    if (correctIndex === null) errors.push(`Die Lösung «${String(rawCorrect).slice(0, 40)}» passt zu keiner Antwort.`);
  }

  let difficulty: Difficulty = 2;
  if (q.difficulty !== undefined && q.difficulty !== null && q.difficulty !== '') {
    const parsed = parseDifficulty(q.difficulty);
    if (parsed) difficulty = parsed;
    else warnings.push(`Unbekannte Schwierigkeit «${String(q.difficulty)}» – «mittel» wird verwendet.`);
  }

  const explanation = typeof q.explanation === 'string' ? q.explanation : '';
  if (q.explanation !== undefined && typeof q.explanation !== 'string') warnings.push('«explanation» ist kein Text und wird ignoriert.');
  const category = typeof q.category === 'string' ? q.category : '';
  if (q.category !== undefined && typeof q.category !== 'string') warnings.push('«category» ist kein Text und wird ignoriert.');

  let acceptedAnswers: string[] | undefined;
  if (q.acceptedAnswers !== undefined && q.acceptedAnswers !== null) {
    if (Array.isArray(q.acceptedAnswers) && q.acceptedAnswers.every((a) => typeof a === 'string')) acceptedAnswers = q.acceptedAnswers as string[];
    else if (typeof q.acceptedAnswers === 'string') acceptedAnswers = [q.acceptedAnswers];
    else errors.push('«acceptedAnswers» muss eine Liste von Texten sein.');
  }

  let sourceId: string | undefined;
  if (q.id !== undefined) {
    if (isUuid(q.id)) sourceId = q.id.toLowerCase();
    else warnings.push('«id» ist keine UUID – es wird eine neue ID vergeben.');
  }

  const candidate: Partial<DraftQuestion> = {
    question,
    answers: answers as DraftQuestion['answers'],
    correctIndex: (correctIndex ?? undefined) as DraftQuestion['correctIndex'] | undefined,
    explanation,
    difficulty,
    category,
    ...(acceptedAnswers ? { acceptedAnswers } : {}),
  };
  const validation = validateDraft(candidate, { skipStructure: true });
  errors.push(...validation.errors);
  warnings.push(...validation.warnings);

  const draft =
    errors.length === 0 ? cleanDraft({ ...(candidate as DraftQuestion), ...(sourceId ? { sourceId } : {}) }) : null;
  return { ...base, draft, errors, warnings, preview: (question || '(ohne Fragetext)').slice(0, 120) };
}

/** Exportformat eines einzelnen Lernpakets (kompatibel mit dem Import). */
export interface DeckExportFile {
  format: typeof DECK_EXPORT_FORMAT;
  version: 1;
  exportedAt: string;
  deck: { name: string; description: string };
  questions: Array<{
    id: string;
    question: string;
    answers: [string, string, string];
    correctIndex: number;
    explanation: string;
    difficulty: Difficulty;
    category: string;
    acceptedAnswers?: string[];
  }>;
}
