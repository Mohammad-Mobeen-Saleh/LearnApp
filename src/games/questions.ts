import type { LocalStore } from '../data/localStore.ts';
import type { GameQuestion } from '../domain/game.ts';
import { computeStats } from '../domain/stats.ts';
import { normalizeText } from '../lib/text.ts';

/**
 * Zentrale Fragenverwaltung für alle Spiele: lädt die Fragen eines Lernpakets (oder die
 * Wiederholungsfragen) einmal pro Spielstart. Fragen werden nie kopiert oder verändert.
 */

/** Spielbar mit drei Antworten: genau drei nicht leere, unterschiedliche Antworten und eine gültige Lösung. */
export function hasThreeValidAnswers(q: Pick<GameQuestion, 'answers' | 'correctIndex'>): boolean {
  if (!Array.isArray(q.answers) || q.answers.length !== 3) return false;
  if (![0, 1, 2].includes(q.correctIndex)) return false;
  const norm = q.answers.map((a) => (typeof a === 'string' ? normalizeText(a) : ''));
  return norm.every(Boolean) && new Set(norm).size === 3;
}

export interface LoadedQuestions {
  questions: GameQuestion[];
  /** Fragen, die übersprungen wurden (keine drei gültigen Antworten) */
  skipped: number;
  title: string;
  deckExists: boolean;
}

export async function loadGameQuestions(
  store: LocalStore,
  source: { deckId: string | null; repeat: boolean },
  options: { requireThreeAnswers?: boolean } = {},
): Promise<LoadedQuestions> {
  const decks = await store.listDecks();
  let all: GameQuestion[];
  let title: string;
  let deckExists = true;
  if (source.repeat) {
    const [questions, sessions, answers] = await Promise.all([store.listAllQuestions(), store.listSessions(), store.listAnswers()]);
    const ids = new Set(computeStats({ decks, questions, sessions, answers }).repeatQuestionIds);
    all = questions.filter((q) => ids.has(q.id));
    title = 'Wiederholung';
  } else {
    const deck = decks.find((d) => d.id === source.deckId);
    deckExists = !!deck;
    all = deck ? await store.listQuestions(deck.id) : [];
    title = deck?.name ?? 'Lernpaket';
  }
  if (!options.requireThreeAnswers) return { questions: all, skipped: 0, title, deckExists };
  const questions = all.filter(hasThreeValidAnswers);
  return { questions, skipped: all.length - questions.length, title, deckExists };
}
