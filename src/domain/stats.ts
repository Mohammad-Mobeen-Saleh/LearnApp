import type { AnswerEvent, AnswerOutcome, Deck, GameSessionRecord, GameType, Question } from './types.ts';

/**
 * Statistiken werden ausschliesslich aus unveränderlichen Spielereignissen berechnet.
 * Dadurch können sich Fortschritte verschiedener Geräte nie gegenseitig überschreiben –
 * die Ereignisse beider Geräte werden einfach zusammengezählt.
 */

export type QuestionStatus = 'unseen' | 'mastered' | 'repeat';

export interface QuestionProgress {
  questionId: string;
  attempts: number;
  correct: number;
  wrong: number;
  lastOutcome: AnswerOutcome | null;
  lastAnsweredAt: string | null;
  status: QuestionStatus;
}

export interface DeckProgress {
  deckId: string;
  name: string;
  total: number;
  unseen: number;
  mastered: number;
  toRepeat: number;
  answered: number;
  correct: number;
  wrong: number;
  successRate: number | null;
  highscore: number;
  games: number;
}

export interface StatsSummary {
  games: number;
  rounds: number;
  correct: number;
  wrong: number;
  timeouts: number;
  successRate: number | null;
  highscore: number;
  bestStreak: number;
  lastPlayedAt: string | null;
  decks: DeckProgress[];
  repeatQuestionIds: string[];
  recentSessions: GameSessionRecord[];
}

function byTime(a: AnswerEvent, b: AnswerEvent): number {
  if (a.answeredAt === b.answeredAt) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  return a.answeredAt < b.answeredAt ? -1 : 1;
}

export function computeQuestionProgress(answers: readonly AnswerEvent[]): Map<string, QuestionProgress> {
  const map = new Map<string, QuestionProgress>();
  for (const a of [...answers].sort(byTime)) {
    let p = map.get(a.questionId);
    if (!p) {
      p = { questionId: a.questionId, attempts: 0, correct: 0, wrong: 0, lastOutcome: null, lastAnsweredAt: null, status: 'unseen' };
      map.set(a.questionId, p);
    }
    p.attempts += 1;
    if (a.outcome === 'correct') p.correct += 1;
    else p.wrong += 1;
    p.lastOutcome = a.outcome;
    p.lastAnsweredAt = a.answeredAt;
    p.status = a.outcome === 'correct' ? 'mastered' : 'repeat';
  }
  return map;
}

export function sessionGameType(s: Pick<GameSessionRecord, 'gameType'>): GameType {
  return s.gameType === 'typing' ? 'typing' : 'defense';
}

/**
 * Beschränkt Spiele und Antworten auf einen Spielmodus. Antworten werden über ihre
 * Spiel-ID zugeordnet; Antworten ohne gespeichertes Spiel (ältere Daten) zählen zum Abwehrmodus.
 */
export function filterByGameType(
  sessions: readonly GameSessionRecord[],
  answers: readonly AnswerEvent[],
  gameType: GameType,
): { sessions: GameSessionRecord[]; answers: AnswerEvent[] } {
  const typeBySession = new Map(sessions.map((s) => [s.id, sessionGameType(s)]));
  return {
    sessions: sessions.filter((s) => sessionGameType(s) === gameType),
    answers: answers.filter((a) => (typeBySession.get(a.sessionId) ?? 'defense') === gameType),
  };
}

export function computeStats(
  input: {
    decks: readonly Deck[];
    questions: readonly Question[];
    sessions: readonly GameSessionRecord[];
    answers: readonly AnswerEvent[];
  },
  options: { gameType?: GameType } = {},
): StatsSummary {
  if (options.gameType) {
    const filtered = filterByGameType(input.sessions, input.answers, options.gameType);
    input = { ...input, ...filtered };
  }
  const activeDecks = input.decks.filter((d) => !d.deleted);
  const activeDeckIds = new Set(activeDecks.map((d) => d.id));
  const activeQuestions = input.questions.filter((q) => !q.deleted && activeDeckIds.has(q.deckId));
  const progress = computeQuestionProgress(input.answers);

  const correct = input.answers.filter((a) => a.outcome === 'correct').length;
  const timeouts = input.answers.filter((a) => a.outcome === 'timeout').length;
  const wrong = input.answers.length - correct;

  const sessionsSorted = [...input.sessions].sort((a, b) => (a.endedAt < b.endedAt ? 1 : a.endedAt > b.endedAt ? -1 : 0));
  const highscore = input.sessions.reduce((max, s) => Math.max(max, s.score), 0);
  const bestStreak = input.sessions.reduce((max, s) => Math.max(max, s.maxStreak), 0);
  const lastAnswer = input.answers.reduce<string | null>((max, a) => (max === null || a.answeredAt > max ? a.answeredAt : max), null);
  const lastSession = sessionsSorted[0]?.endedAt ?? null;
  const lastPlayedAt = [lastAnswer, lastSession].filter((x): x is string => !!x).sort().pop() ?? null;

  const decks: DeckProgress[] = activeDecks.map((deck) => {
    const qs = activeQuestions.filter((q) => q.deckId === deck.id);
    let unseen = 0;
    let mastered = 0;
    let toRepeat = 0;
    let answered = 0;
    let deckCorrect = 0;
    let deckWrong = 0;
    for (const q of qs) {
      const p = progress.get(q.id);
      if (!p) {
        unseen += 1;
        continue;
      }
      answered += p.attempts;
      deckCorrect += p.correct;
      deckWrong += p.wrong;
      if (p.status === 'mastered') mastered += 1;
      else toRepeat += 1;
    }
    const deckSessions = input.sessions.filter((s) => s.deckId === deck.id);
    return {
      deckId: deck.id,
      name: deck.name,
      total: qs.length,
      unseen,
      mastered,
      toRepeat,
      answered,
      correct: deckCorrect,
      wrong: deckWrong,
      successRate: answered > 0 ? deckCorrect / answered : null,
      highscore: deckSessions.reduce((max, s) => Math.max(max, s.score), 0),
      games: deckSessions.length,
    };
  });

  const repeatQuestionIds = activeQuestions.filter((q) => progress.get(q.id)?.status === 'repeat').map((q) => q.id);

  return {
    games: input.sessions.length,
    rounds: input.answers.length,
    correct,
    wrong,
    timeouts,
    successRate: input.answers.length > 0 ? correct / input.answers.length : null,
    highscore,
    bestStreak,
    lastPlayedAt,
    decks: decks.sort((a, b) => a.name.localeCompare(b.name, 'de')),
    repeatQuestionIds,
    recentSessions: sessionsSorted.slice(0, 10),
  };
}
