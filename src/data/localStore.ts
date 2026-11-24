import { runTransaction, openDatabase, STORE_NAMES, type StoreName, type Tx } from './idb.ts';
import { DEMO_DECK_ID } from './demoDeck.ts';
import { isOriginalDemoConflict, isOriginalDemoQuestion, planDemoCleanup, type DemoCleanupPreview } from './demoCleanup.ts';
import { uuid } from '../lib/uuid.ts';
import { cleanDraft, validateDraft } from '../import/validate.ts';
import { ALL_COLLECTIONS, COLLECTIONS, outboxKey, pickFields, type AnyRecord } from '../sync/collections.ts';
import { decideConflict } from '../sync/merge.ts';
import { isPermanentErrorCode, type PulledChange, type PushResult } from '../sync/types.ts';
import {
  DEFAULT_SETTINGS,
  LIMITS,
  SETTINGS_ID,
  type AnswerEvent,
  type Collection,
  type ConflictRecord,
  type ConflictResolution,
  type Deck,
  type DraftQuestion,
  type GameSessionRecord,
  type Question,
  type Settings,
  type SettingsContent,
} from '../domain/types.ts';

/**
 * Lokaler Speicher (IndexedDB) – die App arbeitet immer zuerst lokal («local first»).
 *
 * Jede lokale Änderung wird in derselben Transaktion in die Synchronisierungs-
 * warteschlange (Outbox) eingetragen. Dadurch geht keine Änderung verloren, auch
 * wenn die App offline ist oder während der Übertragung geschlossen wird.
 */

export interface OutboxEntry {
  key: string;
  collection: Collection;
  id: string;
  /** Reihenfolge der ersten Änderung (ältere zuerst) */
  seq: number;
  /** wird bei jeder weiteren lokalen Änderung erhöht */
  rev: number;
  /** Inhalt der Server-Version, auf der die Änderung basiert (für den 3-Wege-Merge) */
  base: Record<string, unknown> | null;
  attempts: number;
  lastError: string | null;
  failed: boolean;
  enqueuedAt: string;
  updatedAt: string;
}

export interface PushItem {
  entry: OutboxEntry;
  record: AnyRecord;
}

export interface PushOutcome {
  applied: number;
  conflicts: number;
  merged: number;
  errors: number;
}

export interface ChangeEvent {
  stores: StoreName[];
  source: 'local' | 'sync' | 'tab';
}

export interface DeckSummary {
  deck: Deck;
  questionCount: number;
  pending: boolean;
}

interface MetaRecord {
  key: string;
  value: unknown;
}

type Listener = (event: ChangeEvent) => void;

const nowIso = () => new Date().toISOString();
const CONTENT_STORES: StoreName[] = [...ALL_COLLECTIONS];
const ALL_STORES: StoreName[] = [...STORE_NAMES];

export function detectDeviceLabel(userAgent: string = globalThis.navigator?.userAgent ?? '', touchPoints = globalThis.navigator?.maxTouchPoints ?? 0): string {
  let device = 'Gerät';
  if (/iPhone/.test(userAgent)) device = 'iPhone';
  else if (/iPad/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1)) device = 'iPad';
  else if (/Android/.test(userAgent)) device = 'Android';
  else if (/Windows/.test(userAgent)) device = 'Windows-PC';
  else if (/Macintosh/.test(userAgent)) device = 'Mac';
  else if (/Linux/.test(userAgent)) device = 'Linux-PC';
  let browser = '';
  if (/Edg\//.test(userAgent)) browser = 'Edge';
  else if (/Firefox\//.test(userAgent)) browser = 'Firefox';
  else if (/Chrome\//.test(userAgent) || /CriOS\//.test(userAgent)) browser = 'Chrome';
  else if (/Safari\//.test(userAgent)) browser = 'Safari';
  return browser ? `${device} (${browser})` : device;
}

export class LocalStore {
  readonly db: IDBDatabase;
  readonly name: string;
  private listeners = new Set<Listener>();
  private channel: BroadcastChannel | null = null;
  private deviceIdCache: string | null = null;
  private deviceLabelOverride: string | null;

  private constructor(db: IDBDatabase, name: string, deviceLabel: string | null) {
    this.db = db;
    this.name = name;
    this.deviceLabelOverride = deviceLabel;
    if (typeof BroadcastChannel !== 'undefined') {
      // Andere Tabs derselben App über Änderungen informieren
      this.channel = new BroadcastChannel(`meteor-defense:${name}`);
      this.channel.onmessage = (event: MessageEvent) => {
        const stores = Array.isArray(event.data?.stores) ? (event.data.stores as StoreName[]) : ALL_STORES;
        this.emit(stores, 'tab');
      };
    }
  }

  static async open(name = 'meteor-defense', options: { factory?: IDBFactory; deviceLabel?: string } = {}): Promise<LocalStore> {
    const factory = options.factory ?? globalThis.indexedDB;
    if (!factory) throw new Error('IndexedDB ist in diesem Browser nicht verfügbar.');
    const db = await openDatabase(name, factory);
    return new LocalStore(db, name, options.deviceLabel ?? null);
  }

  close(): void {
    this.channel?.close();
    this.channel = null;
    this.listeners.clear();
    this.db.close();
  }

  // ------------------------------------------------------------------ Ereignisse

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(stores: StoreName[], source: ChangeEvent['source']): void {
    const event: ChangeEvent = { stores, source };
    for (const l of [...this.listeners]) {
      try {
        l(event);
      } catch (err) {
        console.error(err);
      }
    }
    if (source !== 'tab' && this.channel) {
      try {
        this.channel.postMessage({ stores });
      } catch {
        /* ignorieren */
      }
    }
  }

  private run<T>(stores: readonly StoreName[], mode: IDBTransactionMode, fn: (t: Tx) => Promise<T>): Promise<T> {
    return runTransaction(this.db, stores, mode, fn);
  }

  // ------------------------------------------------------------------ Metadaten

  async getMeta<T>(key: string): Promise<T | undefined> {
    const r = await this.run(['meta'], 'readonly', (t) => t.get<MetaRecord>('meta', key));
    return r?.value as T | undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await this.run(['meta'], 'readwrite', (t) => t.put('meta', { key, value }));
  }

  async getDeviceId(): Promise<string> {
    if (this.deviceIdCache) return this.deviceIdCache;
    const id = await this.run(['meta'], 'readwrite', async (t) => {
      const existing = await t.get<MetaRecord>('meta', 'deviceId');
      if (existing && typeof existing.value === 'string') return existing.value;
      const created = uuid();
      await t.put('meta', { key: 'deviceId', value: created });
      return created;
    });
    this.deviceIdCache = id;
    return id;
  }

  async getDeviceLabel(): Promise<string> {
    if (this.deviceLabelOverride) return this.deviceLabelOverride;
    return (await this.getMeta<string>('deviceLabel')) || detectDeviceLabel();
  }

  async setDeviceLabel(label: string): Promise<void> {
    await this.setMeta('deviceLabel', label.trim().slice(0, 60));
    this.emit(['meta'], 'local');
  }

  async getOwner(): Promise<string | null> {
    return (await this.getMeta<string>('ownerUserId')) ?? null;
  }

  async setOwner(userId: string): Promise<void> {
    await this.setMeta('ownerUserId', userId);
    this.emit(['meta'], 'local');
  }

  async getPullCursor(): Promise<number> {
    return (await this.getMeta<number>('pullCursor')) ?? 0;
  }

  async getLastSyncAt(): Promise<string | null> {
    return (await this.getMeta<string>('lastSyncAt')) ?? null;
  }

  async setLastSyncAt(iso: string): Promise<void> {
    await this.setMeta('lastSyncAt', iso);
  }

  // ------------------------------------------------------------------ Abfragen

  async listDecks(options: { includeDeleted?: boolean } = {}): Promise<Deck[]> {
    const all = await this.run(['decks'], 'readonly', (t) => t.getAll<Deck>('decks'));
    return all
      .filter((d) => options.includeDeleted || !d.deleted)
      .sort((a, b) => a.name.localeCompare(b.name, 'de') || a.id.localeCompare(b.id));
  }

  async getDeck(id: string): Promise<Deck | undefined> {
    return this.run(['decks'], 'readonly', (t) => t.get<Deck>('decks', id));
  }

  async listQuestions(deckId: string, options: { includeDeleted?: boolean } = {}): Promise<Question[]> {
    const all = await this.run(['questions'], 'readonly', (t) => t.getAllByIndex<Question>('questions', 'deckId', deckId));
    return all.filter((q) => options.includeDeleted || !q.deleted).sort(byCreated);
  }

  async listAllQuestions(options: { includeDeleted?: boolean } = {}): Promise<Question[]> {
    const all = await this.run(['questions'], 'readonly', (t) => t.getAll<Question>('questions'));
    return all.filter((q) => options.includeDeleted || !q.deleted).sort(byCreated);
  }

  /** Aktive Fragen in aktiven Lernpaketen. */
  async listPlayableQuestions(): Promise<Question[]> {
    const [decks, questions] = await Promise.all([this.listDecks(), this.listAllQuestions()]);
    const ids = new Set(decks.map((d) => d.id));
    return questions.filter((q) => ids.has(q.deckId));
  }

  async getQuestion(id: string): Promise<Question | undefined> {
    return this.run(['questions'], 'readonly', (t) => t.get<Question>('questions', id));
  }

  async getSettings(): Promise<Settings> {
    const stored = await this.run(['user_settings'], 'readonly', (t) => t.get<Settings>('user_settings', SETTINGS_ID));
    return stored ?? makeSettings(DEFAULT_SETTINGS);
  }

  async listSessions(): Promise<GameSessionRecord[]> {
    return this.run(['game_sessions'], 'readonly', (t) => t.getAll<GameSessionRecord>('game_sessions'));
  }

  async listAnswers(): Promise<AnswerEvent[]> {
    return this.run(['answer_events'], 'readonly', (t) => t.getAll<AnswerEvent>('answer_events'));
  }

  async listConflicts(options: { includeResolved?: boolean } = {}): Promise<ConflictRecord[]> {
    const all = await this.run(['sync_conflicts'], 'readonly', (t) => t.getAll<ConflictRecord>('sync_conflicts'));
    return all
      .filter((c) => !c.deleted && (options.includeResolved || !c.resolved))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  async listOutbox(): Promise<OutboxEntry[]> {
    const all = await this.run(['outbox'], 'readonly', (t) => t.getAll<OutboxEntry>('outbox'));
    return all.sort((a, b) => a.seq - b.seq);
  }

  /** Zähler für die Statusanzeige. */
  async syncCounters(): Promise<{ pending: number; failed: number; conflicts: number }> {
    return this.run(['outbox', 'sync_conflicts'], 'readonly', async (t) => {
      const entries = await t.getAll<OutboxEntry>('outbox');
      const conflicts = await t.getAll<ConflictRecord>('sync_conflicts');
      return {
        pending: entries.filter((e) => !e.failed).length,
        failed: entries.filter((e) => e.failed).length,
        conflicts: conflicts.filter((c) => !c.resolved && !c.deleted).length,
      };
    });
  }

  /** Lernpakete mit Fragenanzahl und Kennzeichnung «noch nicht synchronisiert». */
  async deckSummaries(): Promise<DeckSummary[]> {
    return this.run(['decks', 'questions', 'outbox'], 'readonly', async (t) => {
      const decks = (await t.getAll<Deck>('decks')).filter((d) => !d.deleted);
      const questions = await t.getAll<Question>('questions');
      const outbox = await t.getAll<OutboxEntry>('outbox');
      const questionDeck = new Map(questions.map((q) => [q.id, q.deckId]));
      const pendingDecks = new Set<string>();
      for (const e of outbox) {
        if (e.collection === 'decks') pendingDecks.add(e.id);
        if (e.collection === 'questions') {
          const deckId = questionDeck.get(e.id);
          if (deckId) pendingDecks.add(deckId);
        }
      }
      const counts = new Map<string, number>();
      for (const q of questions) if (!q.deleted) counts.set(q.deckId, (counts.get(q.deckId) ?? 0) + 1);
      return decks
        .sort((a, b) => a.name.localeCompare(b.name, 'de'))
        .map((deck) => ({ deck, questionCount: counts.get(deck.id) ?? 0, pending: pendingDecks.has(deck.id) }));
    });
  }

  // ------------------------------------------------------------------ Warteschlange

  /**
   * Trägt eine Änderung in die Outbox ein (innerhalb der laufenden Transaktion).
   * Mehrere Änderungen am selben Datensatz werden zu einem Eintrag zusammengefasst;
   * die Basis (letzter bekannter Server-Stand) bleibt dabei erhalten.
   */
  private async enqueue(t: Tx, collection: Collection, id: string, previous: AnyRecord | null, base?: Record<string, unknown> | null) {
    const key = outboxKey(collection, id);
    const now = nowIso();
    const existing = await t.get<OutboxEntry>('outbox', key);
    if (existing) {
      existing.rev += 1;
      existing.updatedAt = now;
      existing.failed = false;
      existing.attempts = 0;
      existing.lastError = null;
      await t.put('outbox', existing);
      return;
    }
    const spec = COLLECTIONS[collection];
    let entryBase: Record<string, unknown> | null = null;
    if (base !== undefined) entryBase = base;
    else if (spec.kind === 'mutable' && previous && Number(previous.version) > 0) entryBase = pickFields(spec, previous);
    const seqMeta = await t.get<MetaRecord>('meta', 'outboxSeq');
    const seq = (typeof seqMeta?.value === 'number' ? seqMeta.value : 0) + 1;
    await t.put('meta', { key: 'outboxSeq', value: seq });
    const entry: OutboxEntry = {
      key,
      collection,
      id,
      seq,
      rev: 1,
      base: entryBase,
      attempts: 0,
      lastError: null,
      failed: false,
      enqueuedAt: now,
      updatedAt: now,
    };
    await t.put('outbox', entry);
  }

  /** Generische lokale Änderung (auch für die Konfliktauflösung). */
  private async writeLocal(t: Tx, collection: Collection, id: string, patch: Record<string, unknown>): Promise<AnyRecord> {
    const existing = await t.get<AnyRecord>(collection, id);
    const now = nowIso();
    const next: AnyRecord = existing
      ? { ...existing, ...patch, id, updatedAt: now }
      : ({ deleted: false, ...patch, id, version: 0, createdAt: now, updatedAt: now, deviceId: null } as AnyRecord);
    await t.put(collection, next);
    await this.enqueue(t, collection, id, existing ?? null);
    return next;
  }

  // ------------------------------------------------------------------ Lernpakete

  async createDeck(input: { name: string; description?: string }): Promise<Deck> {
    const deck = buildDeck(input);
    await this.run(['decks', 'outbox', 'meta'], 'readwrite', async (t) => {
      await t.put('decks', deck);
      await this.enqueue(t, 'decks', deck.id, null);
    });
    this.emit(['decks', 'outbox'], 'local');
    return deck;
  }

  async updateDeck(id: string, patch: { name?: string; description?: string }): Promise<Deck> {
    const clean: Record<string, unknown> = {};
    if (patch.name !== undefined) clean.name = checkDeckName(patch.name);
    if (patch.description !== undefined) clean.description = checkDescription(patch.description);
    const deck = await this.run(['decks', 'outbox', 'meta'], 'readwrite', async (t) => {
      const existing = await t.get<Deck>('decks', id);
      if (!existing || existing.deleted) throw new Error('Lernpaket nicht gefunden.');
      return (await this.writeLocal(t, 'decks', id, clean)) as unknown as Deck;
    });
    this.emit(['decks', 'outbox'], 'local');
    return deck;
  }

  /** Löscht ein Lernpaket (Tombstone). Die Fragen werden mit ausgeblendet und bleiben wiederherstellbar. */
  async deleteDeck(id: string): Promise<void> {
    await this.run(['decks', 'outbox', 'meta'], 'readwrite', async (t) => {
      const existing = await t.get<Deck>('decks', id);
      if (!existing || existing.deleted) return;
      await this.writeLocal(t, 'decks', id, { deleted: true });
    });
    this.emit(['decks', 'outbox'], 'local');
  }

  // ------------------------------------------------------------------ Fragen

  async addQuestions(deckId: string, drafts: readonly DraftQuestion[]): Promise<Question[]> {
    const prepared = drafts.map((d) => buildQuestion(deckId, d));
    await this.run(['decks', 'questions', 'outbox', 'meta'], 'readwrite', async (t) => {
      const deck = await t.get<Deck>('decks', deckId);
      if (!deck || deck.deleted) throw new Error('Lernpaket nicht gefunden.');
      for (const q of prepared) {
        await t.put('questions', q);
        await this.enqueue(t, 'questions', q.id, null);
      }
    });
    this.emit(['questions', 'outbox'], 'local');
    return prepared;
  }

  async updateQuestion(id: string, patch: Partial<DraftQuestion>): Promise<Question> {
    const question = await this.run(['questions', 'outbox', 'meta'], 'readwrite', async (t) => {
      const existing = await t.get<Question>('questions', id);
      if (!existing || existing.deleted) throw new Error('Frage nicht gefunden.');
      const merged: DraftQuestion = {
        question: patch.question ?? existing.question,
        answers: patch.answers ?? existing.answers,
        correctIndex: patch.correctIndex ?? existing.correctIndex,
        explanation: patch.explanation ?? existing.explanation,
        difficulty: patch.difficulty ?? existing.difficulty,
        category: patch.category ?? existing.category,
        acceptedAnswers: patch.acceptedAnswers ?? existing.acceptedAnswers ?? [],
      };
      const { errors } = validateDraft(merged);
      if (errors.length) throw new Error(errors.join(' '));
      const clean = cleanDraft(merged);
      return (await this.writeLocal(t, 'questions', id, {
        question: clean.question,
        answers: clean.answers,
        correctIndex: clean.correctIndex,
        explanation: clean.explanation,
        difficulty: clean.difficulty,
        category: clean.category,
        acceptedAnswers: clean.acceptedAnswers ?? [],
      })) as unknown as Question;
    });
    this.emit(['questions', 'outbox'], 'local');
    return question;
  }

  async deleteQuestions(ids: readonly string[]): Promise<void> {
    await this.run(['questions', 'outbox', 'meta'], 'readwrite', async (t) => {
      for (const id of ids) {
        const existing = await t.get<Question>('questions', id);
        if (existing && !existing.deleted) await this.writeLocal(t, 'questions', id, { deleted: true });
      }
    });
    this.emit(['questions', 'outbox'], 'local');
  }

  /** Ausdrücklich gewählte Import-Option «Ersetzen»: alte Fragen löschen, neue hinzufügen. */
  async replaceQuestions(deckId: string, drafts: readonly DraftQuestion[]): Promise<Question[]> {
    const prepared = drafts.map((d) => buildQuestion(deckId, d));
    await this.run(['decks', 'questions', 'outbox', 'meta'], 'readwrite', async (t) => {
      const deck = await t.get<Deck>('decks', deckId);
      if (!deck || deck.deleted) throw new Error('Lernpaket nicht gefunden.');
      const existing = await t.getAllByIndex<Question>('questions', 'deckId', deckId);
      for (const q of existing) if (!q.deleted) await this.writeLocal(t, 'questions', q.id, { deleted: true });
      for (const q of prepared) {
        await t.put('questions', q);
        await this.enqueue(t, 'questions', q.id, null);
      }
    });
    this.emit(['questions', 'outbox'], 'local');
    return prepared;
  }

  // ------------------------------------------------------------------ Einstellungen

  async updateSettings(patch: Partial<SettingsContent>): Promise<Settings> {
    const settings = await this.run(['user_settings', 'outbox', 'meta'], 'readwrite', async (t) => {
      const existing = await t.get<Settings>('user_settings', SETTINGS_ID);
      if (!existing) {
        const created = makeSettings({ ...DEFAULT_SETTINGS, ...patch });
        await t.put('user_settings', created);
        await this.enqueue(t, 'user_settings', SETTINGS_ID, null, pickFields(COLLECTIONS.user_settings, makeSettings(DEFAULT_SETTINGS) as unknown as AnyRecord));
        return created;
      }
      return (await this.writeLocal(t, 'user_settings', SETTINGS_ID, { ...patch })) as unknown as Settings;
    });
    this.emit(['user_settings', 'outbox'], 'local');
    return settings;
  }

  // ------------------------------------------------------------------ Spielereignisse (nur anfügen)

  async recordAnswer(event: Omit<AnswerEvent, 'id' | 'deviceId'> & { id?: string }): Promise<AnswerEvent> {
    const deviceId = await this.getDeviceId();
    const record: AnswerEvent = { ...event, id: event.id ?? uuid(), deviceId };
    await this.run(['answer_events', 'outbox', 'meta'], 'readwrite', async (t) => {
      await t.put('answer_events', record);
      await this.enqueue(t, 'answer_events', record.id, null, null);
    });
    this.emit(['answer_events', 'outbox'], 'local');
    return record;
  }

  async recordSession(session: Omit<GameSessionRecord, 'id' | 'deviceId'> & { id?: string }): Promise<GameSessionRecord> {
    const deviceId = await this.getDeviceId();
    const record: GameSessionRecord = { ...session, id: session.id ?? uuid(), deviceId };
    await this.run(['game_sessions', 'outbox', 'meta'], 'readwrite', async (t) => {
      await t.put('game_sessions', record);
      await this.enqueue(t, 'game_sessions', record.id, null, null);
    });
    this.emit(['game_sessions', 'outbox'], 'local');
    return record;
  }

  // ------------------------------------------------------------------ Konflikte

  /** Führt die vom Benutzer gewählte Lösung aus. Jede Lösung ist eine normale lokale Änderung. */
  async resolveConflict(conflictId: string, resolution: ConflictResolution): Promise<void> {
    await this.run(CONTENT_STORES.concat(['outbox', 'meta']), 'readwrite', async (t) => {
      const conflict = await t.get<ConflictRecord>('sync_conflicts', conflictId);
      if (!conflict || conflict.resolved) return;
      const local = { ...(conflict.localData ?? {}) };
      const contentOnly = (data: Record<string, unknown>) => {
        const copy = { ...data };
        delete copy.deleted;
        return copy;
      };
      switch (resolution) {
        case 'use_local':
          await this.writeLocal(t, conflict.collection, conflict.recordId, { ...contentOnly(local), deleted: false });
          break;
        case 'keep_both':
          if (conflict.collection === 'questions') {
            const deckId = String(local.deckId ?? '');
            await this.restoreDeckIfDeleted(t, deckId);
            const copy = buildQuestion(deckId, local as unknown as DraftQuestion);
            await t.put('questions', copy);
            await this.enqueue(t, 'questions', copy.id, null);
          }
          break;
        case 'restore':
          if (conflict.collection === 'questions') await this.restoreDeckIfDeleted(t, String(local.deckId ?? ''));
          await this.writeLocal(t, conflict.collection, conflict.recordId, { ...contentOnly(local), deleted: false });
          break;
        case 'delete_anyway':
          await this.writeLocal(t, conflict.collection, conflict.recordId, { deleted: true });
          break;
        case 'keep_remote':
          break;
      }
      const previous = { ...conflict } as unknown as AnyRecord;
      conflict.resolved = true;
      conflict.resolution = resolution;
      conflict.updatedAt = nowIso();
      await t.put('sync_conflicts', conflict);
      await this.enqueue(t, 'sync_conflicts', conflict.id, previous);
    });
    this.emit(CONTENT_STORES.concat(['outbox']), 'local');
  }

  private async restoreDeckIfDeleted(t: Tx, deckId: string): Promise<void> {
    if (!deckId) return;
    const deck = await t.get<Deck>('decks', deckId);
    if (deck && deck.deleted) await this.writeLocal(t, 'decks', deckId, { deleted: false });
  }

  // ------------------------------------------------------------------ Schnittstelle für die Synchronisierung

  /** Nächste Änderungen in sicherer Reihenfolge: Pakete → Fragen → Rest → Paket-Löschungen. */
  async getPushBatch(limit: number): Promise<PushItem[]> {
    return this.run(CONTENT_STORES.concat(['outbox']), 'readwrite', async (t) => {
      const entries = (await t.getAll<OutboxEntry>('outbox')).filter((e) => !e.failed);
      const decksDeleted = new Map<string, boolean>();
      for (const e of entries) {
        if (e.collection === 'decks') decksDeleted.set(e.id, !!(await t.get<Deck>('decks', e.id))?.deleted);
      }
      const priority = (e: OutboxEntry) =>
        e.collection === 'decks' ? (decksDeleted.get(e.id) ? 90 : 0) : COLLECTIONS[e.collection].priority(undefined);
      entries.sort((a, b) => priority(a) - priority(b) || a.seq - b.seq);
      const items: PushItem[] = [];
      for (const entry of entries) {
        if (items.length >= limit) break;
        const record = await t.get<AnyRecord>(entry.collection, entry.id);
        if (!record) {
          // Datensatz existiert lokal nicht mehr – nichts zu senden
          await t.delete('outbox', entry.key);
          continue;
        }
        items.push({ entry, record });
      }
      return items;
    });
  }

  /** Verarbeitet die Antworten des Servers auf einen Push (eine Transaktion). */
  async applyPushResults(items: readonly PushItem[], results: readonly PushResult[], deviceId: string): Promise<PushOutcome> {
    const deviceLabel = await this.getDeviceLabel();
    const byKey = new Map(items.map((i) => [i.entry.key, i]));
    const outcome: PushOutcome = { applied: 0, conflicts: 0, merged: 0, errors: 0 };
    await this.run(CONTENT_STORES.concat(['outbox', 'meta']), 'readwrite', async (t) => {
      for (const result of results) {
        const key = outboxKey(result.collection, result.id);
        const item = byKey.get(key);
        if (!item) continue;
        const spec = COLLECTIONS[result.collection];
        const entry = await t.get<OutboxEntry>('outbox', key);
        const record = await t.get<AnyRecord>(result.collection, result.id);

        if (result.status === 'applied') {
          outcome.applied += 1;
          if (spec.kind === 'append') {
            if (entry) await t.delete('outbox', key);
            continue;
          }
          if (record) await t.put(result.collection, { ...record, version: result.version, deviceId });
          if (entry) {
            if (entry.rev === item.entry.rev) await t.delete('outbox', key);
            else await t.put('outbox', { ...entry, base: pickFields(spec, item.record) });
          }
          continue;
        }

        if (result.status === 'error') {
          outcome.errors += 1;
          if (entry) {
            const attempts = entry.attempts + 1;
            await t.put('outbox', {
              ...entry,
              attempts,
              lastError: result.error,
              failed: isPermanentErrorCode(result.code) && attempts >= 3,
            });
          }
          continue;
        }

        // Konflikt
        if (!entry || entry.rev !== item.entry.rev || !record) {
          // Inzwischen lokal erneut geändert – beim nächsten Push neu bewerten
          continue;
        }
        const remote = result.record ? spec.fromServer(result.record) : null;
        const decision = decideConflict({ spec, local: record, base: entry.base, remote, deviceId, serverReason: result.reason });
        switch (decision.type) {
          case 'adopt_remote':
            if (remote) await t.put(result.collection, remote);
            await t.delete('outbox', key);
            outcome.merged += 1;
            break;
          case 'fast_forward':
            await t.put(result.collection, { ...record, version: remote!.version });
            await t.put('outbox', { ...entry, base: pickFields(spec, remote!), attempts: 0 });
            outcome.merged += 1;
            break;
          case 'merged':
            await t.put(result.collection, { ...record, ...decision.data, version: remote!.version, updatedAt: nowIso() });
            await t.put('outbox', { ...entry, base: pickFields(spec, remote!), attempts: 0 });
            outcome.merged += 1;
            break;
          case 'conflict': {
            outcome.conflicts += 1;
            const conflict = buildConflict({
              collection: result.collection as ConflictRecord['collection'],
              recordId: result.id,
              reason: decision.reason,
              localData: pickFields(spec, record),
              remoteData: remote ? pickFields(spec, remote) : null,
              deviceLabel,
            });
            await t.put('sync_conflicts', conflict);
            await this.enqueue(t, 'sync_conflicts', conflict.id, null);
            // Lokal gilt ab jetzt der Server-Stand; die eigene Version liegt sicher im Konflikt.
            if (remote) await t.put(result.collection, remote);
            else await t.delete(result.collection, result.id);
            await t.delete('outbox', key);
            break;
          }
        }
      }
    });
    this.emit(CONTENT_STORES.concat(['outbox']), 'sync');
    return outcome;
  }

  /** Übernimmt Änderungen aus der Cloud. Lokale, noch nicht gesendete Änderungen haben Vorrang. */
  async applyPulledChanges(changes: readonly PulledChange[], cursor: number): Promise<number> {
    let applied = 0;
    const touched = new Set<StoreName>();
    await this.run(CONTENT_STORES.concat(['outbox', 'meta']), 'readwrite', async (t) => {
      for (const change of changes) {
        const spec = COLLECTIONS[change.collection];
        if (!spec) continue;
        const incoming = spec.fromServer(change.record);
        if (spec.kind === 'append') {
          if (!(await t.get(change.collection, incoming.id))) {
            await t.put(change.collection, incoming);
            applied += 1;
            touched.add(change.collection);
          }
          continue;
        }
        const pending = await t.get<OutboxEntry>('outbox', outboxKey(change.collection, incoming.id));
        if (pending) continue;
        const local = await t.get<AnyRecord>(change.collection, incoming.id);
        if (!local || Number(incoming.version) > Number(local.version)) {
          await t.put(change.collection, incoming);
          applied += 1;
          touched.add(change.collection);
        }
      }
      const current = await t.get<MetaRecord>('meta', 'pullCursor');
      const previous = typeof current?.value === 'number' ? current.value : 0;
      await t.put('meta', { key: 'pullCursor', value: Math.max(previous, cursor) });
    });
    if (touched.size) this.emit([...touched], 'sync');
    return applied;
  }

  async listFailed(): Promise<OutboxEntry[]> {
    return (await this.listOutbox()).filter((e) => e.failed);
  }

  async retryFailed(key?: string): Promise<void> {
    await this.run(['outbox'], 'readwrite', async (t) => {
      const entries = await t.getAll<OutboxEntry>('outbox');
      for (const e of entries) {
        if (e.failed && (!key || e.key === key)) await t.put('outbox', { ...e, failed: false, attempts: 0, lastError: null });
      }
    });
    this.emit(['outbox'], 'local');
  }

  /**
   * Verwirft eine dauerhaft fehlgeschlagene lokale Änderung. Danach wird alles neu aus der
   * Cloud geladen, damit der Server-Stand wieder lokal vorliegt.
   */
  async discardFailed(key: string): Promise<void> {
    await this.run(CONTENT_STORES.concat(['outbox', 'meta']), 'readwrite', async (t) => {
      const entry = await t.get<OutboxEntry>('outbox', key);
      if (!entry) return;
      await t.delete('outbox', key);
      const record = await t.get<AnyRecord>(entry.collection, entry.id);
      if (record && Number(record.version ?? 0) === 0) await t.delete(entry.collection, entry.id);
      else if (record) await t.put(entry.collection, { ...record, version: 0 });
      await t.put('meta', { key: 'pullCursor', value: 0 });
    });
    this.emit(ALL_STORES, 'local');
  }

  // ------------------------------------------------------------------ Kontowechsel / Erststart

  /** Erstellt beim ersten Start ausschliesslich Standardeinstellungen. Keine Demodaten. */
  async seedIfNeeded(): Promise<boolean> {
    const initialized = await this.run(['user_settings', 'outbox', 'meta'], 'readwrite', async (t) => {
      const flag = await t.get<MetaRecord>('meta', 'seeded');
      if (flag?.value === true) return false;
      if (!(await t.get('user_settings', SETTINGS_ID))) {
        const settings = makeSettings(DEFAULT_SETTINGS, nowIso());
        await t.put('user_settings', settings);
        await this.enqueue(t, 'user_settings', SETTINGS_ID, null,
          pickFields(COLLECTIONS.user_settings, settings as unknown as AnyRecord));
      }
      await t.put('meta', { key: 'seeded', value: true });
      return true;
    });
    if (initialized) this.emit(['user_settings', 'outbox'], 'local');
    return initialized;
  }

  /** Zeigt ausschliesslich eindeutig zuordenbare alte Demodaten an. */
  async previewDemoCleanup(): Promise<DemoCleanupPreview> {
    return this.run(['decks', 'questions', 'sync_conflicts'], 'readonly', async (t) => {
      const deck = await t.get<Deck>('decks', DEMO_DECK_ID);
      const questions = await t.getAllByIndex<Question>('questions', 'deckId', DEMO_DECK_ID);
      const conflicts = await t.getAll<ConflictRecord>('sync_conflicts');
      return planDemoCleanup(deck, questions, conflicts);
    });
  }

  /**
   * Einmalige, wiederholbar sichere Bereinigung der alten Demodaten.
   * Ursprüngliche Fragen werden mit Löschmarkern synchronisiert; persönliche
   * Bearbeitungen bleiben unangetastet. Nur eindeutig zugeordnete Konflikte
   * werden als erledigt (Server-Stand behalten) gekennzeichnet.
   */
  async cleanupDemoData(): Promise<DemoCleanupPreview> {
    const report = await this.run(CONTENT_STORES.concat(['outbox', 'meta']), 'readwrite', async (t) => {
      const deck = await t.get<Deck>('decks', DEMO_DECK_ID);
      const questions = await t.getAllByIndex<Question>('questions', 'deckId', DEMO_DECK_ID);
      const conflicts = await t.getAll<ConflictRecord>('sync_conflicts');
      const plan = planDemoCleanup(deck, questions, conflicts);
      if (!plan.contentBlocked) {
        for (const question of questions) {
          if (!question.deleted && isOriginalDemoQuestion(question.id, question)) {
            await this.writeLocal(t, 'questions', question.id, { deleted: true });
          }
        }
        if (plan.deckToRemove) await this.writeLocal(t, 'decks', DEMO_DECK_ID, { deleted: true });
      }
      for (const conflict of conflicts) {
        if (!isOriginalDemoConflict(conflict)) continue;
        const previous = { ...conflict } as unknown as AnyRecord;
        await t.put('sync_conflicts', {
          ...conflict,
          resolved: true,
          resolution: 'keep_remote',
          updatedAt: nowIso(),
        });
        await this.enqueue(t, 'sync_conflicts', conflict.id, previous);
      }
      return plan;
    });
    if (report.deckToRemove || report.questionsToRemove || report.conflictsToResolve) {
      this.emit(['decks', 'questions', 'sync_conflicts', 'outbox'], 'local');
    }
    return report;
  }

  /** Entfernt alle Kontodaten von diesem Gerät (Abmelden). Die Geräte-ID bleibt erhalten. */
  async clearAccountData(options: { reseed?: boolean } = {}): Promise<void> {
    await this.run(ALL_STORES, 'readwrite', async (t) => {
      for (const store of CONTENT_STORES) await t.clear(store);
      await t.clear('outbox');
      for (const key of ['ownerUserId', 'pullCursor', 'lastSyncAt', 'seeded', 'outboxSeq']) await t.delete('meta', key);
      if (options.reseed === false) await t.put('meta', { key: 'seeded', value: true });
    });
    this.emit(ALL_STORES, 'local');
    if (options.reseed !== false) await this.seedIfNeeded();
  }

  // ------------------------------------------------------------------ Wiederherstellung aus Sicherung

  /** Schreibt Datensätze aus einer Sicherung als normale lokale Änderungen (werden synchronisiert). */
  async importRecords(plan: {
    decks: Deck[];
    questions: Question[];
    undelete: { collection: 'decks' | 'questions'; id: string; data: Record<string, unknown> }[];
    sessions: GameSessionRecord[];
    answers: AnswerEvent[];
  }): Promise<void> {
    await this.run(CONTENT_STORES.concat(['outbox', 'meta']), 'readwrite', async (t) => {
      for (const d of plan.decks) {
        if (await t.get('decks', d.id)) continue;
        await t.put('decks', d);
        await this.enqueue(t, 'decks', d.id, null);
      }
      for (const u of plan.undelete) await this.writeLocal(t, u.collection, u.id, { ...u.data, deleted: false });
      for (const q of plan.questions) {
        if (await t.get('questions', q.id)) continue;
        await t.put('questions', q);
        await this.enqueue(t, 'questions', q.id, null);
      }
      for (const s of plan.sessions) {
        if (await t.get('game_sessions', s.id)) continue;
        await t.put('game_sessions', s);
        await this.enqueue(t, 'game_sessions', s.id, null, null);
      }
      for (const a of plan.answers) {
        if (await t.get('answer_events', a.id)) continue;
        await t.put('answer_events', a);
        await this.enqueue(t, 'answer_events', a.id, null, null);
      }
    });
    this.emit(ALL_STORES, 'local');
  }
}

// ------------------------------------------------------------------ Hilfsfunktionen

function byCreated(a: { createdAt: string; id: string }, b: { createdAt: string; id: string }): number {
  if (a.createdAt === b.createdAt) return a.id.localeCompare(b.id);
  return a.createdAt < b.createdAt ? -1 : 1;
}

function checkDeckName(name: string): string {
  const clean = name.replace(/\s+/g, ' ').trim();
  if (!clean) throw new Error('Bitte einen Namen für das Lernpaket eingeben.');
  if (clean.length > LIMITS.deckName) throw new Error(`Der Name ist zu lang (max. ${LIMITS.deckName} Zeichen).`);
  return clean;
}

function checkDescription(description: string): string {
  const clean = description.trim();
  if (clean.length > LIMITS.deckDescription) throw new Error(`Die Beschreibung ist zu lang (max. ${LIMITS.deckDescription} Zeichen).`);
  return clean;
}

export function buildDeck(input: { name: string; description?: string; id?: string }): Deck {
  const now = nowIso();
  return {
    id: input.id ?? uuid(),
    name: checkDeckName(input.name),
    description: checkDescription(input.description ?? ''),
    deleted: false,
    version: 0,
    createdAt: now,
    updatedAt: now,
    deviceId: null,
  };
}

export function buildQuestion(deckId: string, draft: DraftQuestion, id: string = uuid()): Question {
  const { errors } = validateDraft(draft);
  if (errors.length) throw new Error(errors.join(' '));
  const clean = cleanDraft(draft);
  const now = nowIso();
  return {
    id,
    deckId,
    question: clean.question,
    answers: clean.answers,
    correctIndex: clean.correctIndex,
    explanation: clean.explanation,
    difficulty: clean.difficulty,
    category: clean.category,
    acceptedAnswers: clean.acceptedAnswers ?? [],
    deleted: false,
    version: 0,
    createdAt: now,
    updatedAt: now,
    deviceId: null,
  };
}

export function makeSettings(content: SettingsContent, now: string = nowIso()): Settings {
  return { ...content, id: SETTINGS_ID, deleted: false, version: 0, createdAt: now, updatedAt: now, deviceId: null };
}

function buildConflict(input: {
  collection: ConflictRecord['collection'];
  recordId: string;
  reason: ConflictRecord['reason'];
  localData: Record<string, unknown>;
  remoteData: Record<string, unknown> | null;
  deviceLabel: string;
}): ConflictRecord {
  const now = nowIso();
  return {
    id: uuid(),
    ...input,
    resolved: false,
    resolution: null,
    deleted: false,
    version: 0,
    createdAt: now,
    updatedAt: now,
    deviceId: null,
  };
}
