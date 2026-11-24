import type { QuestionContent } from './types.ts';

/**
 * Antwortprüfung für den Tippmodus.
 * «Geld», «geld» und «  GELD » gelten als dieselbe Antwort.
 */
export function normalizeAnswer(value: string): string {
  return value
    .normalize('NFKC') // Unicode: zusammengesetzte Zeichen (z. B. «ü» als u + ¨) vereinheitlichen
    .toLocaleLowerCase('de')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Alle gültigen Lösungen einer Frage: Hauptlösung answers[correctIndex] + acceptedAnswers. */
export function acceptedSolutions(q: Pick<QuestionContent, 'answers' | 'correctIndex' | 'acceptedAnswers'>): string[] {
  const list = [q.answers[q.correctIndex], ...(q.acceptedAnswers ?? [])].filter((a): a is string => typeof a === 'string' && a.trim() !== '');
  return [...new Set(list)];
}

export function isTypedAnswerCorrect(input: string, q: Pick<QuestionContent, 'answers' | 'correctIndex' | 'acceptedAnswers'>): boolean {
  const typed = normalizeAnswer(input);
  if (!typed) return false;
  return acceptedSolutions(q).some((a) => normalizeAnswer(a) === typed);
}
