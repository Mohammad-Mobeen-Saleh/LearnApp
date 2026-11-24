import {
  DEFAULT_SETTINGS,
  type AnswerEvent,
  type Collection,
  type ConflictRecord,
  type Deck,
  type GameSessionRecord,
  type Question,
  type Settings,
  type SettingsContent,
} from '../domain/types.ts';

/**
 * Beschreibung aller synchronisierten Sammlungen:
 *  - welche Felder inhaltlich verglichen/zusammengeführt werden
 *  - wie lokale Datensätze (camelCase) in Server-Zeilen (snake_case) übersetzt werden
 *  - in welcher Reihenfolge Änderungen hochgeladen werden
 */

export type AnyRecord = Record<string, unknown> & { id: string };
type Row = Record<string, unknown>;

export interface CollectionSpec {
  name: Collection;
  kind: 'mutable' | 'append';
  /** Inhaltsfelder für Vergleich und 3-Wege-Merge (bei veränderbaren Sammlungen inkl. `deleted`) */
  fields: readonly string[];
  /** Standardwerte für Felder, die ältere Datensätze noch nicht haben */
  defaults?: Record<string, unknown>;
  toServer(local: AnyRecord): Row;
  fromServer(row: Row): AnyRecord;
  /** kleinere Zahl = früher hochladen */
  priority(local: AnyRecord | undefined): number;
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v ?? fallback) || fallback);
const bool = (v: unknown): boolean => v === true || v === 'true';
/** Zeitstempel einheitlich als ISO-String (UTC, Millisekunden), damit Vergleiche stimmen. */
export const isoTime = (v: unknown): string => {
  if (typeof v !== 'string' || !v) return new Date(0).toISOString();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
};

function syncMeta(row: Row) {
  return {
    id: str(row.id).toLowerCase(),
    version: num(row.version, 1),
    deleted: bool(row.deleted),
    createdAt: isoTime(row.created_at),
    updatedAt: isoTime(row.updated_at),
    deviceId: typeof row.device_id === 'string' ? row.device_id : null,
  };
}

export function sanitizeSettings(data: unknown): SettingsContent {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const speed = d.speed === 'slow' || d.speed === 'fast' || d.speed === 'normal' ? d.speed : DEFAULT_SETTINGS.speed;
  const volume = typeof d.volume === 'number' && d.volume >= 0 && d.volume <= 1 ? d.volume : DEFAULT_SETTINGS.volume;
  const qpg = typeof d.questionsPerGame === 'number' && d.questionsPerGame >= 0 && d.questionsPerGame <= 500 ? Math.round(d.questionsPerGame) : DEFAULT_SETTINGS.questionsPerGame;
  return {
    playerName: typeof d.playerName === 'string' ? d.playerName.slice(0, 60) : DEFAULT_SETTINGS.playerName,
    soundEnabled: typeof d.soundEnabled === 'boolean' ? d.soundEnabled : DEFAULT_SETTINGS.soundEnabled,
    volume,
    speed,
    questionsPerGame: qpg,
    reduceMotion: typeof d.reduceMotion === 'boolean' ? d.reduceMotion : DEFAULT_SETTINGS.reduceMotion,
  };
}

const decks: CollectionSpec = {
  name: 'decks',
  kind: 'mutable',
  fields: ['name', 'description', 'deleted'],
  toServer: (l) => {
    const d = l as unknown as Deck;
    return { name: d.name, description: d.description, deleted: d.deleted, created_at: d.createdAt };
  },
  fromServer: (row): AnyRecord => {
    const deck: Deck = { ...syncMeta(row), name: str(row.name), description: str(row.description) };
    return deck as unknown as AnyRecord;
  },
  // Neue/geänderte Pakete zuerst (Fragen brauchen ihr Paket), Löschungen ganz zuletzt
  priority: (l) => (l && (l as unknown as Deck).deleted ? 90 : 0),
};

const questions: CollectionSpec = {
  name: 'questions',
  kind: 'mutable',
  fields: ['deckId', 'question', 'answers', 'correctIndex', 'explanation', 'difficulty', 'category', 'acceptedAnswers', 'deleted'],
  defaults: { acceptedAnswers: [] },
  toServer: (l) => {
    const q = l as unknown as Question;
    return {
      deck_id: q.deckId,
      question: q.question,
      answers: q.answers,
      correct_index: q.correctIndex,
      explanation: q.explanation,
      difficulty: q.difficulty,
      category: q.category,
      accepted_answers: q.acceptedAnswers ?? [],
      deleted: q.deleted,
      created_at: q.createdAt,
    };
  },
  fromServer: (row): AnyRecord => {
    const answers = Array.isArray(row.answers) ? row.answers.map((a) => str(a)) : ['', '', ''];
    const q: Question = {
      ...syncMeta(row),
      deckId: str(row.deck_id).toLowerCase(),
      question: str(row.question),
      answers: [answers[0] ?? '', answers[1] ?? '', answers[2] ?? ''],
      correctIndex: Math.min(2, Math.max(0, num(row.correct_index))) as Question['correctIndex'],
      explanation: str(row.explanation),
      difficulty: (Math.min(3, Math.max(1, num(row.difficulty, 2))) as Question['difficulty']),
      category: str(row.category),
      acceptedAnswers: Array.isArray(row.accepted_answers) ? row.accepted_answers.map((a) => str(a)).filter(Boolean) : [],
    };
    return q as unknown as AnyRecord;
  },
  priority: () => 10,
};

const userSettings: CollectionSpec = {
  name: 'user_settings',
  kind: 'mutable',
  fields: ['playerName', 'soundEnabled', 'volume', 'speed', 'questionsPerGame', 'reduceMotion', 'deleted'],
  toServer: (l) => {
    const s = l as unknown as Settings;
    return { data: sanitizeSettings(s), deleted: s.deleted, created_at: s.createdAt };
  },
  fromServer: (row): AnyRecord => {
    const s: Settings = { ...syncMeta(row), ...sanitizeSettings(row.data) };
    return s as unknown as AnyRecord;
  },
  priority: () => 20,
};

const syncConflicts: CollectionSpec = {
  name: 'sync_conflicts',
  kind: 'mutable',
  fields: ['resolved', 'resolution', 'deleted'],
  toServer: (l) => {
    const c = l as unknown as ConflictRecord;
    return {
      collection: c.collection,
      record_id: c.recordId,
      reason: c.reason,
      local_data: c.localData,
      remote_data: c.remoteData,
      device_label: c.deviceLabel,
      resolved: c.resolved,
      resolution: c.resolution,
      deleted: c.deleted,
      created_at: c.createdAt,
    };
  },
  fromServer: (row): AnyRecord => {
    const c: ConflictRecord = {
      ...syncMeta(row),
      collection: str(row.collection) as ConflictRecord['collection'],
      recordId: str(row.record_id).toLowerCase(),
      reason: str(row.reason) as ConflictRecord['reason'],
      localData: (row.local_data as Record<string, unknown> | null) ?? null,
      remoteData: (row.remote_data as Record<string, unknown> | null) ?? null,
      deviceLabel: str(row.device_label),
      resolved: bool(row.resolved),
      resolution: (typeof row.resolution === 'string' ? row.resolution : null) as ConflictRecord['resolution'],
    };
    return c as unknown as AnyRecord;
  },
  priority: () => 30,
};

const gameSessions: CollectionSpec = {
  name: 'game_sessions',
  kind: 'append',
  fields: [],
  toServer: (l) => {
    const s = l as unknown as GameSessionRecord;
    return {
      deck_id: s.deckId,
      mode: s.mode,
      game_type: s.gameType ?? 'defense',
      score: s.score,
      rounds: s.rounds,
      correct_count: s.correctCount,
      wrong_count: s.wrongCount,
      max_streak: s.maxStreak,
      started_at: s.startedAt,
      ended_at: s.endedAt,
    };
  },
  fromServer: (row): AnyRecord => {
    const s: GameSessionRecord = {
      id: str(row.id).toLowerCase(),
      deckId: typeof row.deck_id === 'string' ? row.deck_id.toLowerCase() : null,
      mode: row.mode === 'repeat' ? 'repeat' : 'normal',
      gameType: row.game_type === 'typing' ? 'typing' : 'defense',
      score: num(row.score),
      rounds: num(row.rounds),
      correctCount: num(row.correct_count),
      wrongCount: num(row.wrong_count),
      maxStreak: num(row.max_streak),
      startedAt: isoTime(row.started_at),
      endedAt: isoTime(row.ended_at),
      deviceId: typeof row.device_id === 'string' ? row.device_id : null,
    };
    return s as unknown as AnyRecord;
  },
  priority: () => 40,
};

const answerEvents: CollectionSpec = {
  name: 'answer_events',
  kind: 'append',
  fields: [],
  toServer: (l) => {
    const a = l as unknown as AnswerEvent;
    return {
      session_id: a.sessionId,
      deck_id: a.deckId,
      question_id: a.questionId,
      outcome: a.outcome,
      points: a.points,
      response_ms: a.responseMs,
      answered_at: a.answeredAt,
    };
  },
  fromServer: (row): AnyRecord => {
    const outcome = row.outcome === 'correct' || row.outcome === 'timeout' ? row.outcome : 'wrong';
    const a: AnswerEvent = {
      id: str(row.id).toLowerCase(),
      sessionId: str(row.session_id).toLowerCase(),
      deckId: str(row.deck_id).toLowerCase(),
      questionId: str(row.question_id).toLowerCase(),
      outcome,
      points: num(row.points),
      responseMs: num(row.response_ms),
      answeredAt: isoTime(row.answered_at),
      deviceId: typeof row.device_id === 'string' ? row.device_id : null,
    };
    return a as unknown as AnyRecord;
  },
  priority: () => 50,
};

export const COLLECTIONS: Record<Collection, CollectionSpec> = {
  decks,
  questions,
  user_settings: userSettings,
  sync_conflicts: syncConflicts,
  game_sessions: gameSessions,
  answer_events: answerEvents,
};

export const ALL_COLLECTIONS = Object.keys(COLLECTIONS) as Collection[];

export function isCollection(value: unknown): value is Collection {
  return typeof value === 'string' && value in COLLECTIONS;
}

export function outboxKey(collection: Collection, id: string): string {
  return `${collection}:${id}`;
}

/** Nur die Inhaltsfelder eines Datensatzes (für Vergleich, Merge und Konflikte). */
export function pickFields(spec: CollectionSpec, record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of spec.fields) out[f] = record[f] ?? spec.defaults?.[f];
  return out;
}
