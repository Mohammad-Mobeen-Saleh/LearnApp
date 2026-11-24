/** Gemeinsame Datentypen von Meteor Defense. */

export type Difficulty = 1 | 2 | 3;
export type AnswerIndex = 0 | 1 | 2;
export type AnswerTriple = [string, string, string];

/** Namen der synchronisierten Sammlungen (identisch mit den Supabase-Tabellen). */
export type Collection = 'decks' | 'questions' | 'user_settings' | 'sync_conflicts' | 'game_sessions' | 'answer_events';

export type MutableCollection = 'decks' | 'questions' | 'user_settings' | 'sync_conflicts';
export type AppendOnlyCollection = 'game_sessions' | 'answer_events';

/** Felder, die jeder veränderbare, synchronisierte Datensatz besitzt. */
export interface SyncFields {
  id: string;
  /** Server-Version, auf der der lokale Stand basiert (0 = noch nie mit der Cloud abgeglichen). */
  version: number;
  /** Löschmarker (Tombstone). Gelöschte Datensätze bleiben erhalten, damit sie nicht zurückkehren. */
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
  /** Gerät, das die Server-Version zuletzt geschrieben hat. */
  deviceId: string | null;
}

export interface Deck extends SyncFields {
  name: string;
  description: string;
}

export interface QuestionContent {
  question: string;
  answers: AnswerTriple;
  correctIndex: AnswerIndex;
  explanation: string;
  difficulty: Difficulty;
  category: string;
  /** Optional: weitere gültige Schreibweisen/Übersetzungen für den Tippmodus.
   *  Die Hauptlösung bleibt answers[correctIndex]. */
  acceptedAnswers?: string[];
}

export interface Question extends SyncFields, QuestionContent {
  deckId: string;
}

export type SpeedSetting = 'slow' | 'normal' | 'fast';

export interface SettingsContent {
  playerName: string;
  soundEnabled: boolean;
  volume: number;
  speed: SpeedSetting;
  /** 0 = alle Fragen des Pakets */
  questionsPerGame: number;
  reduceMotion: boolean;
}

export interface Settings extends SyncFields, SettingsContent {}

export type AnswerOutcome = 'correct' | 'wrong' | 'timeout';

/** Unveränderliches Spielereignis: eine beantwortete Frage. */
export interface AnswerEvent {
  id: string;
  sessionId: string;
  deckId: string;
  questionId: string;
  outcome: AnswerOutcome;
  points: number;
  responseMs: number;
  answeredAt: string;
  deviceId: string | null;
}

export type GameMode = 'normal' | 'repeat';

/** Spielmodus: Abwehrmodus (3 Antwortmeteoriten) oder Tippmodus (Antwort eintippen). */
export type GameType = 'defense' | 'typing';

export const GAME_TYPE_LABELS: Record<GameType, string> = { defense: 'Abwehrmodus', typing: 'Tippmodus' };

/** Unveränderliches Spielereignis: ein beendetes Spiel. */
export interface GameSessionRecord {
  id: string;
  deckId: string | null;
  mode: GameMode;
  /** fehlt bei älteren Datensätzen → 'defense' */
  gameType?: GameType;
  score: number;
  rounds: number;
  correctCount: number;
  wrongCount: number;
  maxStreak: number;
  startedAt: string;
  endedAt: string;
  deviceId: string | null;
}

export type ConflictReason = 'edit_edit' | 'remote_deleted' | 'local_deleted' | 'deck_deleted' | 'deck_changed';

export type ConflictResolution = 'use_local' | 'keep_remote' | 'keep_both' | 'restore' | 'delete_anyway';

/** Synchronisierungskonflikt: beide Versionen bleiben erhalten, bis der Benutzer entscheidet. */
export interface ConflictRecord extends SyncFields {
  collection: 'decks' | 'questions' | 'user_settings';
  recordId: string;
  reason: ConflictReason;
  localData: Record<string, unknown> | null;
  remoteData: Record<string, unknown> | null;
  deviceLabel: string;
  resolved: boolean;
  resolution: ConflictResolution | null;
}

/** Eine (noch nicht gespeicherte) Frage aus Import oder Editor. */
export interface DraftQuestion extends QuestionContent {
  /** ID aus einer importierten JSON-Datei (nur für die Duplikaterkennung). */
  sourceId?: string;
}

export const DIFFICULTY_LABELS: Record<Difficulty, string> = { 1: 'leicht', 2: 'mittel', 3: 'schwer' };
export const SPEED_LABELS: Record<SpeedSetting, string> = { slow: 'Gemütlich', normal: 'Normal', fast: 'Schnell' };
export const ANSWER_LETTERS = ['A', 'B', 'C'] as const;

/** Feste ID des Einstellungs-Datensatzes (pro Benutzerkonto genau einer). */
export const SETTINGS_ID = '00000000-0000-4000-8000-000000000001';

export const DEFAULT_SETTINGS: SettingsContent = {
  playerName: '',
  soundEnabled: true,
  volume: 0.7,
  speed: 'normal',
  questionsPerGame: 10,
  reduceMotion: false,
};

/** Grenzwerte – identisch mit den CHECK-Constraints in der Datenbank. */
export const LIMITS = {
  deckName: 200,
  deckDescription: 2000,
  question: 2000,
  answer: 500,
  explanation: 4000,
  category: 200,
  playerName: 60,
  acceptedAnswers: 20,
} as const;
