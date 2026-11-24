import { isUuid } from '../lib/uuid.ts';
import { contentKey } from '../import/duplicates.ts';
import { validateDraft } from '../import/validate.ts';
import { BACKUP_FORMAT, DECK_EXPORT_FORMAT, type DeckExportFile } from '../import/jsonParser.ts';
import { sanitizeSettings } from '../sync/collections.ts';
import { buildQuestion, type LocalStore } from './localStore.ts';
import type {
  AnswerEvent,
  Deck,
  DraftQuestion,
  GameSessionRecord,
  Question,
  SettingsContent,
} from '../domain/types.ts';

/** Vollständige Datensicherung als JSON-Datei (Lernpakete, Fragen, Einstellungen, Lernfortschritt). */
export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: 1;
  app: 'Meteor Defense';
  exportedAt: string;
  decks: Array<Pick<Deck, 'id' | 'name' | 'description' | 'createdAt' | 'updatedAt'>>;
  questions: Array<
    Pick<
      Question,
      | 'id'
      | 'deckId'
      | 'question'
      | 'answers'
      | 'correctIndex'
      | 'explanation'
      | 'difficulty'
      | 'category'
      | 'acceptedAnswers'
      | 'createdAt'
      | 'updatedAt'
    >
  >;
  settings: SettingsContent;
  sessions: GameSessionRecord[];
  answers: AnswerEvent[];
}

export async function createBackup(store: LocalStore): Promise<BackupFile> {
  const [decks, questions, settings, sessions, answers] = await Promise.all([
    store.listDecks(),
    store.listAllQuestions(),
    store.getSettings(),
    store.listSessions(),
    store.listAnswers(),
  ]);
  const deckIds = new Set(decks.map((d) => d.id));
  return {
    format: BACKUP_FORMAT,
    version: 1,
    app: 'Meteor Defense',
    exportedAt: new Date().toISOString(),
    decks: decks.map(({ id, name, description, createdAt, updatedAt }) => ({ id, name, description, createdAt, updatedAt })),
    questions: questions
      .filter((q) => deckIds.has(q.deckId))
      .map(({ id, deckId, question, answers, correctIndex, explanation, difficulty, category, acceptedAnswers, createdAt, updatedAt }) => ({
        id,
        deckId,
        question,
        answers,
        correctIndex,
        explanation,
        difficulty,
        category,
        ...(acceptedAnswers?.length ? { acceptedAnswers } : {}),
        createdAt,
        updatedAt,
      })),
    settings: sanitizeSettings(settings),
    sessions,
    answers,
  };
}

export function createDeckExport(deck: Deck, questions: readonly Question[]): DeckExportFile {
  return {
    format: DECK_EXPORT_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    deck: { name: deck.name, description: deck.description },
    questions: questions
      .filter((q) => !q.deleted)
      .map((q) => ({
        id: q.id,
        question: q.question,
        answers: q.answers,
        correctIndex: q.correctIndex,
        explanation: q.explanation,
        difficulty: q.difficulty,
        category: q.category,
        ...(q.acceptedAnswers?.length ? { acceptedAnswers: q.acceptedAnswers } : {}),
      })),
  };
}

export function parseBackup(raw: unknown): { backup: BackupFile | null; errors: string[] } {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object') return { backup: null, errors: ['Die Datei enthält keine Sicherung.'] };
  const b = raw as Record<string, unknown>;
  if (b.format !== BACKUP_FORMAT) return { backup: null, errors: ['Die Datei ist keine Meteor-Defense-Sicherung.'] };
  if (b.version !== 1) errors.push(`Unbekannte Version der Sicherung (${String(b.version)}).`);
  const list = (key: string) => (Array.isArray(b[key]) ? (b[key] as Record<string, unknown>[]) : []);
  for (const key of ['decks', 'questions']) if (!Array.isArray(b[key])) errors.push(`Feld «${key}» fehlt.`);
  if (errors.length) return { backup: null, errors };

  const decks = list('decks').filter((d) => isUuid(d.id) && typeof d.name === 'string' && d.name.trim());
  const questions = list('questions').filter((q) => {
    if (!isUuid(q.id) || !isUuid(q.deckId)) return false;
    return validateDraft(q as Partial<DraftQuestion>).errors.length === 0;
  });
  const skipped = list('questions').length - questions.length;
  if (skipped > 0) errors.push(`${skipped} fehlerhafte Fragen in der Sicherung werden übersprungen.`);
  const sessions = list('sessions').filter((s) => isUuid(s.id) && typeof s.score === 'number');
  const answers = list('answers').filter((a) => isUuid(a.id) && isUuid(a.questionId) && typeof a.outcome === 'string');
  return {
    backup: {
      format: BACKUP_FORMAT,
      version: 1,
      app: 'Meteor Defense',
      exportedAt: typeof b.exportedAt === 'string' ? b.exportedAt : '',
      decks: decks as unknown as BackupFile['decks'],
      questions: questions as unknown as BackupFile['questions'],
      settings: sanitizeSettings(b.settings),
      sessions: sessions as unknown as GameSessionRecord[],
      answers: answers as unknown as AnswerEvent[],
    },
    errors,
  };
}

export interface RestoreDeckPreview {
  id: string;
  name: string;
  status: 'new' | 'existing' | 'deleted';
  newQuestions: number;
  deletedQuestions: number;
  unchangedQuestions: number;
}

export interface RestorePreview {
  decks: RestoreDeckPreview[];
  newSessions: number;
  newAnswers: number;
}

export interface RestoreOptions {
  deckIds: readonly string[];
  includeProgress: boolean;
  /** gelöschte Lernpakete/Fragen aus der Sicherung wiederherstellen */
  restoreDeleted: boolean;
}

export interface RestoreReport {
  decksAdded: number;
  decksRestored: number;
  questionsAdded: number;
  questionsRestored: number;
  questionsSkipped: number;
  sessionsAdded: number;
  answersAdded: number;
}

async function loadLocal(store: LocalStore) {
  const [decks, questions, sessions, answers] = await Promise.all([
    store.listDecks({ includeDeleted: true }),
    store.listAllQuestions({ includeDeleted: true }),
    store.listSessions(),
    store.listAnswers(),
  ]);
  return {
    decks: new Map(decks.map((d) => [d.id, d])),
    questions: new Map(questions.map((q) => [q.id, q])),
    sessionIds: new Set(sessions.map((s) => s.id)),
    answerIds: new Set(answers.map((a) => a.id)),
  };
}

export async function previewRestore(store: LocalStore, backup: BackupFile): Promise<RestorePreview> {
  const local = await loadLocal(store);
  const decks = backup.decks.map((d): RestoreDeckPreview => {
    const existing = local.decks.get(d.id);
    const qs = backup.questions.filter((q) => q.deckId === d.id);
    let newQuestions = 0;
    let deletedQuestions = 0;
    let unchangedQuestions = 0;
    for (const q of qs) {
      const lq = local.questions.get(q.id);
      if (!lq) newQuestions += 1;
      else if (lq.deleted) deletedQuestions += 1;
      else unchangedQuestions += 1;
    }
    return {
      id: d.id,
      name: d.name,
      status: !existing ? 'new' : existing.deleted ? 'deleted' : 'existing',
      newQuestions,
      deletedQuestions,
      unchangedQuestions,
    };
  });
  return {
    decks,
    newSessions: backup.sessions.filter((s) => !local.sessionIds.has(s.id)).length,
    newAnswers: backup.answers.filter((a) => !local.answerIds.has(a.id)).length,
  };
}

/**
 * Stellt Daten aus einer Sicherung wieder her. Vorhandene Datensätze werden nie
 * überschrieben – es wird nur ergänzt (und auf Wunsch Gelöschtes zurückgeholt).
 */
export async function restoreBackup(store: LocalStore, backup: BackupFile, options: RestoreOptions): Promise<RestoreReport> {
  const local = await loadLocal(store);
  const report: RestoreReport = {
    decksAdded: 0,
    decksRestored: 0,
    questionsAdded: 0,
    questionsRestored: 0,
    questionsSkipped: 0,
    sessionsAdded: 0,
    answersAdded: 0,
  };
  const plan = {
    decks: [] as Deck[],
    questions: [] as Question[],
    undelete: [] as { collection: 'decks' | 'questions'; id: string; data: Record<string, unknown> }[],
    sessions: [] as GameSessionRecord[],
    answers: [] as AnswerEvent[],
  };
  const selected = new Set(options.deckIds);
  const now = new Date().toISOString();

  for (const d of backup.decks) {
    if (!selected.has(d.id)) continue;
    const existing = local.decks.get(d.id);
    if (existing?.deleted && !options.restoreDeleted) {
      report.questionsSkipped += backup.questions.filter((q) => q.deckId === d.id).length;
      continue;
    }
    if (!existing) {
      plan.decks.push({
        id: d.id,
        name: d.name.trim().slice(0, 200),
        description: (d.description ?? '').slice(0, 2000),
        deleted: false,
        version: 0,
        createdAt: d.createdAt || now,
        updatedAt: now,
        deviceId: null,
      });
      report.decksAdded += 1;
    } else if (existing.deleted) {
      plan.undelete.push({ collection: 'decks', id: d.id, data: { name: d.name, description: d.description ?? '' } });
      report.decksRestored += 1;
    }

    const activeKeys = new Set(
      [...local.questions.values()].filter((q) => q.deckId === d.id && !q.deleted).map((q) => contentKey(q)),
    );
    for (const q of backup.questions.filter((x) => x.deckId === d.id)) {
      const lq = local.questions.get(q.id);
      const key = contentKey(q);
      if (lq && !lq.deleted) {
        report.questionsSkipped += 1;
        continue;
      }
      if (activeKeys.has(key)) {
        report.questionsSkipped += 1;
        continue;
      }
      if (lq?.deleted) {
        if (!options.restoreDeleted) {
          report.questionsSkipped += 1;
          continue;
        }
        plan.undelete.push({
          collection: 'questions',
          id: q.id,
          data: {
            deckId: d.id,
            question: q.question,
            answers: q.answers,
            correctIndex: q.correctIndex,
            explanation: q.explanation ?? '',
            difficulty: q.difficulty ?? 2,
            category: q.category ?? '',
            acceptedAnswers: q.acceptedAnswers ?? [],
          },
        });
        report.questionsRestored += 1;
      } else {
        const built = buildQuestion(d.id, q as unknown as DraftQuestion, q.id);
        plan.questions.push({ ...built, createdAt: q.createdAt || built.createdAt });
        report.questionsAdded += 1;
      }
      activeKeys.add(key);
    }
  }

  if (options.includeProgress) {
    for (const s of backup.sessions) {
      if (local.sessionIds.has(s.id)) continue;
      plan.sessions.push({ ...s, deckId: s.deckId ?? null, deviceId: s.deviceId ?? null });
      report.sessionsAdded += 1;
    }
    for (const a of backup.answers) {
      if (local.answerIds.has(a.id)) continue;
      plan.answers.push({ ...a, deviceId: a.deviceId ?? null });
      report.answersAdded += 1;
    }
  }

  await store.importRecords(plan);
  return report;
}
