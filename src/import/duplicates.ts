import { normalizeText } from '../lib/text.ts';
import type { DraftQuestion, QuestionContent } from '../domain/types.ts';

/**
 * Duplikaterkennung für den Import.
 *  - duplicate: gleiche Frage mit gleichen Antworten und gleicher Lösung (oder gleiche ID)
 *  - similar:   gleiche Frage, aber andere Antworten/Lösung (möglicherweise korrigierte Version)
 *  - new:       unbekannte Frage
 */

export type DuplicateStatus = 'new' | 'duplicate' | 'similar';

export interface DuplicateInfo {
  status: DuplicateStatus;
  reason: string | null;
  matchId: string | null;
}

type Comparable = Pick<QuestionContent, 'question' | 'answers' | 'correctIndex'>;

export function questionKey(q: Pick<QuestionContent, 'question'>): string {
  return normalizeText(q.question);
}

export function contentKey(q: Comparable): string {
  const answers = q.answers.map((a) => normalizeText(a));
  const correct = answers[q.correctIndex] ?? '';
  return `${questionKey(q)}|${[...answers].sort().join('|')}|${correct}`;
}

export function classifyDuplicates(
  drafts: readonly DraftQuestion[],
  existing: ReadonlyArray<Comparable & { id: string }>,
): DuplicateInfo[] {
  const existingContent = new Map<string, string>();
  const existingQuestion = new Map<string, string>();
  const existingIds = new Set<string>();
  for (const q of existing) {
    existingContent.set(contentKey(q), q.id);
    if (!existingQuestion.has(questionKey(q))) existingQuestion.set(questionKey(q), q.id);
    existingIds.add(q.id);
  }
  const batchContent = new Set<string>();
  const batchQuestion = new Set<string>();

  return drafts.map((d) => {
    const ck = contentKey(d);
    const qk = questionKey(d);
    let info: DuplicateInfo;
    if (d.sourceId && existingIds.has(d.sourceId)) {
      info = { status: 'duplicate', reason: 'Diese Frage (gleiche ID) ist bereits vorhanden.', matchId: d.sourceId };
    } else if (existingContent.has(ck)) {
      info = { status: 'duplicate', reason: 'Bereits im Lernpaket vorhanden.', matchId: existingContent.get(ck) ?? null };
    } else if (batchContent.has(ck)) {
      info = { status: 'duplicate', reason: 'Kommt in dieser Importquelle mehrfach vor.', matchId: null };
    } else if (existingQuestion.has(qk)) {
      info = {
        status: 'similar',
        reason: 'Gleiche Frage mit anderen Antworten ist bereits vorhanden.',
        matchId: existingQuestion.get(qk) ?? null,
      };
    } else if (batchQuestion.has(qk)) {
      info = { status: 'similar', reason: 'Gleiche Frage kommt in dieser Importquelle mehrfach vor.', matchId: null };
    } else {
      info = { status: 'new', reason: null, matchId: null };
    }
    batchContent.add(ck);
    batchQuestion.add(qk);
    return info;
  });
}
