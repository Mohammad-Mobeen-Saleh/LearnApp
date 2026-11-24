import type { Collection } from '../../src/domain/types.ts';
import { parsePullPage, parsePushResults, toRpcChanges } from '../../src/sync/protocol.ts';
import { RemoteError, type SyncRemote } from '../../src/sync/types.ts';

/**
 * In-Memory-Nachbildung der SQL-Funktionen push_changes/pull_changes
 * (gleiche Regeln wie supabase/migrations/*.sql). Damit lassen sich mehrere Geräte
 * ohne Datenbank simulieren. Zusätzlich gibt es einen PGlite-Test mit der echten Migration.
 */

type Row = Record<string, unknown>;

const MUTABLE = new Set<Collection>(['decks', 'questions', 'user_settings', 'sync_conflicts']);
const ORDER: Collection[] = ['decks', 'questions', 'user_settings', 'sync_conflicts', 'game_sessions', 'answer_events'];

export class MemoryServer {
  private seq = 0;
  private clock = Date.parse('2026-01-01T00:00:00Z');
  readonly tables = new Map<Collection, Map<string, Row>>(ORDER.map((c) => [c, new Map()]));
  /** false = Netzwerk weg */
  online = true;
  /** true = nächster Push wird angewendet, die Antwort geht aber verloren */
  loseNextPushResponse = false;
  pushCalls = 0;

  private now(): string {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }

  remote(): SyncRemote {
    return {
      push: async ({ deviceId, knownSeq, changes }) => {
        this.pushCalls += 1;
        if (!this.online) throw new RemoteError('TypeError: Failed to fetch', { transient: true });
        const raw = toRpcChanges(changes).map((c) => this.applyChange(deviceId, knownSeq, c));
        if (this.loseNextPushResponse) {
          this.loseNextPushResponse = false;
          throw new RemoteError('Verbindung während der Übertragung abgebrochen', { transient: true });
        }
        return parsePushResults(JSON.parse(JSON.stringify(raw)));
      },
      pull: async ({ since, limit }) => {
        if (!this.online) throw new RemoteError('TypeError: Failed to fetch', { transient: true });
        const all: { collection: Collection; server_seq: number; record: Row }[] = [];
        for (const [collection, table] of this.tables) {
          for (const row of table.values()) {
            if ((row.server_seq as number) > since) all.push({ collection, server_seq: row.server_seq as number, record: row });
          }
        }
        all.sort((a, b) => a.server_seq - b.server_seq);
        const page = all.slice(0, limit);
        return parsePullPage(JSON.parse(JSON.stringify({ changes: page, has_more: all.length > limit })));
      },
    };
  }

  rows(collection: Collection): Row[] {
    return [...this.tables.get(collection)!.values()];
  }

  activeRows(collection: Collection): Row[] {
    return this.rows(collection).filter((r) => !r.deleted);
  }

  private write(collection: Collection, id: string, row: Row, existing: Row | undefined): Row {
    this.seq += 1;
    const now = this.now();
    const next: Row = existing
      ? { ...existing, ...row, id, version: (existing.version as number) + 1, server_seq: this.seq, updated_at: now }
      : { ...row, id, version: 1, server_seq: this.seq, created_at: row.created_at ?? now, updated_at: now };
    this.tables.get(collection)!.set(id, next);
    return next;
  }

  private applyChange(deviceId: string, knownSeq: number, change: Record<string, unknown>): Row {
    const collection = change.collection as Collection;
    const id = String(change.id);
    const base = Number(change.base_version ?? 0);
    const data = (change.data ?? {}) as Row;
    const deleted = data.deleted === true;
    const table = this.tables.get(collection);
    if (!table) return { collection, id, status: 'error', code: '22023', error: 'Unbekannte Sammlung' };
    const current = table.get(id);
    const conflict = (reason: string) => ({ collection, id, status: 'conflict', reason, record: current ?? null });

    if (!MUTABLE.has(collection)) {
      const row = current ?? this.write(collection, id, { ...data, device_id: deviceId, deleted: false }, undefined);
      return { collection, id, status: 'applied', version: row.version, server_seq: row.server_seq };
    }

    if (collection === 'questions') {
      const deck = this.tables.get('decks')!.get(String(data.deck_id));
      if (!deleted && deck?.deleted === true) return conflict('deck_deleted');
      if (!deck) return { collection, id, status: 'error', code: '23503', error: 'Fremdschlüssel: Lernpaket fehlt' };
      const answers = data.answers as unknown[];
      if (!Array.isArray(answers) || answers.length !== 3) {
        return { collection, id, status: 'error', code: '23514', error: 'check constraint answers' };
      }
    }

    if (current && (current.version as number) !== base) return conflict('version_mismatch');

    if (collection === 'decks' && current && deleted && current.deleted !== true) {
      const changedByOthers = this.rows('questions').some(
        (q) => q.deck_id === id && (q.server_seq as number) > knownSeq && q.device_id !== deviceId,
      );
      if (changedByOthers) return conflict('deck_changed');
    }

    const row = this.write(collection, id, { ...data, deleted, device_id: deviceId }, current);
    return { collection, id, status: 'applied', version: row.version, server_seq: row.server_seq };
  }
}
