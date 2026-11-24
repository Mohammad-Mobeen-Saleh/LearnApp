import { createDemoDeck, DEMO_DECK_ID } from './demoDeck.ts';
import type { ConflictRecord, Deck, Question } from '../domain/types.ts';

/**
 * Erkennung der ursprünglichen, automatisch angelegten Demodaten.
 * IDs allein reichen nicht: An diesen Datensätzen können inzwischen eigene
 * Änderungen vorgenommen worden sein. Solche Inhalte dürfen nicht automatisch
 * verschwinden.
 */
const original = createDemoDeck('2000-01-01T00:00:00.000Z');
const originalQuestions = new Map(original.questions.map((q) => [q.id, q]));

export function isOriginalDemoDeck(deck: Pick<Deck, 'name' | 'description'> | Record<string, unknown>): boolean {
  return deck.name === original.deck.name && deck.description === original.deck.description;
}

export function isOriginalDemoQuestion(id: string, data: Partial<Question> | Record<string, unknown>): boolean {
  const expected = originalQuestions.get(id);
  if (!expected || data.deckId !== DEMO_DECK_ID) return false;
  return data.question === expected.question &&
    JSON.stringify(data.answers) === JSON.stringify(expected.answers) &&
    data.correctIndex === expected.correctIndex &&
    data.explanation === expected.explanation &&
    data.difficulty === expected.difficulty &&
    data.category === expected.category &&
    (data.acceptedAnswers === undefined || JSON.stringify(data.acceptedAnswers) === '[]');
}

export function isOriginalDemoConflict(conflict: ConflictRecord): boolean {
  if (conflict.deleted || conflict.resolved) return false;
  if (conflict.collection === 'decks' && conflict.recordId === DEMO_DECK_ID) {
    return [conflict.localData, conflict.remoteData].every((data) => !data || isOriginalDemoDeck(data));
  }
  if (conflict.collection === 'questions' && originalQuestions.has(conflict.recordId)) {
    return [conflict.localData, conflict.remoteData].every((data) => !data || isOriginalDemoQuestion(conflict.recordId, data));
  }
  return false;
}

export interface DemoCleanupPreview {
  questionsToRemove: number;
  deckToRemove: boolean;
  conflictsToResolve: number;
  protectedRecords: number;
  /** Falls persönliche Änderungen im Demo-Paket erkannt werden, nichts davon löschen. */
  contentBlocked: boolean;
}

export function planDemoCleanup(deck: Deck | undefined, questions: Question[], conflicts: ConflictRecord[]): DemoCleanupPreview {
  const protectedQuestions = questions.filter((q) => !q.deleted && !isOriginalDemoQuestion(q.id, q));
  const modifiedDeck = !!deck && !deck.deleted && !isOriginalDemoDeck(deck);
  const contentBlocked = modifiedDeck || protectedQuestions.length > 0;
  return {
    questionsToRemove: contentBlocked ? 0 : questions.filter((q) => !q.deleted && isOriginalDemoQuestion(q.id, q)).length,
    deckToRemove: !contentBlocked && !!deck && !deck.deleted && isOriginalDemoDeck(deck),
    conflictsToResolve: conflicts.filter(isOriginalDemoConflict).length,
    protectedRecords: protectedQuestions.length + (modifiedDeck ? 1 : 0) + conflicts.filter((c) => {
      if (c.deleted || c.resolved) return false;
      return (c.collection === 'decks' && c.recordId === DEMO_DECK_ID ||
        c.collection === 'questions' && originalQuestions.has(c.recordId)) && !isOriginalDemoConflict(c);
    }).length,
    contentBlocked,
  };
}
