import { normalizeText, tidyText } from '../lib/text.ts';
import { LIMITS, type AnswerIndex, type Difficulty, type DraftQuestion } from '../domain/types.ts';

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

/** Ab dieser Länge ist eine Antwort auf kleinen Bildschirmen schwer lesbar. */
export const LONG_ANSWER_WARNING = 120;
export const LONG_QUESTION_WARNING = 300;

/**
 * Prüft eine Frage. Fehler verhindern den Import, Warnungen sind Hinweise.
 * `skipStructure` überspringt die Prüfung von Antwortanzahl und Lösung
 * (wenn der Aufrufer diese bereits selbst gemeldet hat).
 */
export function validateDraft(draft: Partial<DraftQuestion>, options: { skipStructure?: boolean } = {}): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const question = (draft.question ?? '').trim();
  if (!question) errors.push('Der Fragetext fehlt.');
  else if (question.length > LIMITS.question) errors.push(`Der Fragetext ist zu lang (max. ${LIMITS.question} Zeichen).`);
  else if (question.length > LONG_QUESTION_WARNING) warnings.push('Sehr lange Frage. Auf dem iPhone ist mehr Lesezeit nötig.');

  const answers = Array.isArray(draft.answers) ? draft.answers : [];
  if (answers.length !== 3) {
    if (!options.skipStructure) errors.push(`Genau 3 Antworten erforderlich (gefunden: ${answers.length}).`);
  } else {
    answers.forEach((a, i) => {
      const letter = 'ABC'[i];
      const text = typeof a === 'string' ? a.trim() : '';
      if (!text) errors.push(`Antwort ${letter} ist leer.`);
      else if (text.length > LIMITS.answer) errors.push(`Antwort ${letter} ist zu lang (max. ${LIMITS.answer} Zeichen).`);
      else if (text.length > LONG_ANSWER_WARNING) warnings.push(`Antwort ${letter} ist sehr lang und auf kleinen Bildschirmen schwer lesbar.`);
    });
    const normalized = answers.map((a) => (typeof a === 'string' ? normalizeText(a) : ''));
    if (normalized.every((n) => n) && new Set(normalized).size !== 3) errors.push('Die drei Antworten müssen sich unterscheiden.');
  }

  if (
    !options.skipStructure &&
    (draft.correctIndex === undefined || draft.correctIndex === null || ![0, 1, 2].includes(draft.correctIndex))
  ) {
    errors.push('Die richtige Antwort fehlt oder ist ungültig (A, B oder C).');
  }
  if ((draft.explanation ?? '').length > LIMITS.explanation) {
    errors.push(`Die Erklärung ist zu lang (max. ${LIMITS.explanation} Zeichen).`);
  }
  if ((draft.category ?? '').length > LIMITS.category) {
    errors.push(`Die Kategorie ist zu lang (max. ${LIMITS.category} Zeichen).`);
  }
  if (draft.acceptedAnswers !== undefined) {
    if (!Array.isArray(draft.acceptedAnswers) || draft.acceptedAnswers.some((a) => typeof a !== 'string')) {
      errors.push('Weitere akzeptierte Antworten müssen Texte sein.');
    } else if (draft.acceptedAnswers.filter((a) => a.trim()).length > LIMITS.acceptedAnswers) {
      errors.push(`Höchstens ${LIMITS.acceptedAnswers} weitere akzeptierte Antworten.`);
    } else if (draft.acceptedAnswers.some((a) => a.length > LIMITS.answer)) {
      errors.push(`Eine akzeptierte Antwort ist zu lang (max. ${LIMITS.answer} Zeichen).`);
    }
  }
  if (draft.difficulty !== undefined && ![1, 2, 3].includes(draft.difficulty)) {
    errors.push('Die Schwierigkeit muss 1 (leicht), 2 (mittel) oder 3 (schwer) sein.');
  }
  return { errors, warnings };
}

/** Bereinigt die zusätzlichen Lösungen: leere, doppelte und mit der Hauptlösung identische entfernen. */
export function cleanAcceptedAnswers(list: readonly string[] | undefined, mainAnswer: string): string[] {
  const seen = new Set([normalizeText(mainAnswer)]);
  const out: string[] = [];
  for (const raw of list ?? []) {
    const value = tidyText(raw).replace(/\n+/g, ' ');
    const key = normalizeText(value);
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/** Zerlegt «Geld; Zaster | Moneten» in einzelne Lösungen (Trennzeichen ; oder |). */
export function splitAcceptedAnswers(value: string): string[] {
  return value
    .split(/[;|\n]/)
    .map((a) => a.trim())
    .filter(Boolean);
}

/** Bereinigt eine gültige Frage (Leerzeichen, Standardwerte). */
export function cleanDraft(draft: DraftQuestion): DraftQuestion {
  const answers = draft.answers.map((a) => tidyText(a).replace(/\n+/g, ' ')) as DraftQuestion['answers'];
  const accepted = cleanAcceptedAnswers(draft.acceptedAnswers, answers[draft.correctIndex] ?? '');
  return {
    question: tidyText(draft.question),
    answers,
    correctIndex: draft.correctIndex,
    explanation: tidyText(draft.explanation ?? ''),
    difficulty: draft.difficulty ?? 2,
    category: tidyText(draft.category ?? '').replace(/\n+/g, ' '),
    ...(accepted.length ? { acceptedAnswers: accepted } : {}),
    ...(draft.sourceId ? { sourceId: draft.sourceId } : {}),
  };
}

const DIFFICULTY_WORDS: Record<string, Difficulty> = {
  '1': 1,
  leicht: 1,
  einfach: 1,
  easy: 1,
  '2': 2,
  mittel: 2,
  normal: 2,
  medium: 2,
  '3': 3,
  schwer: 3,
  schwierig: 3,
  hard: 3,
  difficult: 3,
};

/** Wandelt Angaben wie «leicht», «hard» oder 3 in eine Schwierigkeit um. */
export function parseDifficulty(value: unknown): Difficulty | null {
  if (value === undefined || value === null || value === '') return null;
  const key = String(value).trim().toLowerCase();
  return DIFFICULTY_WORDS[key] ?? null;
}

/** Wandelt «A», «b)», 1 oder einen Antworttext in einen Index 0–2 um. */
export function parseCorrect(value: unknown, answers: readonly string[]): AnswerIndex | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 2) return value as AnswerIndex;
  if (typeof value !== 'string') return null;
  const raw = value.trim().replace(/^(?:antwort|answer|option)\s+/i, '');
  const letter = /^\(?([a-c])(?:\)|\.|:|\]|\s|$)/i.exec(raw);
  if (letter) return ('abc'.indexOf(letter[1].toLowerCase()) as AnswerIndex);
  const normalized = normalizeText(raw);
  if (!normalized) return null;
  const idx = answers.findIndex((a) => normalizeText(a) === normalized);
  return idx >= 0 ? (idx as AnswerIndex) : null;
}
