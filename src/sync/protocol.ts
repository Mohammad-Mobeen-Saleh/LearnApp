import { isCollection } from './collections.ts';
import type { PullPage, PulledChange, PushChange, PushResult } from './types.ts';

/** Übersetzt zwischen Client-Objekten und dem JSON der SQL-Funktionen push_changes / pull_changes. */

export function toRpcChanges(changes: readonly PushChange[]): Record<string, unknown>[] {
  return changes.map((c) => ({ collection: c.collection, id: c.id, base_version: c.baseVersion, data: c.data }));
}

export function parsePushResults(data: unknown): PushResult[] {
  if (!Array.isArray(data)) throw new Error('Ungültige Antwort des Servers (push_changes)');
  const results: PushResult[] = [];
  for (const raw of data) {
    const r = raw as Record<string, unknown>;
    if (!isCollection(r.collection) || typeof r.id !== 'string') continue;
    const id = r.id.toLowerCase();
    if (r.status === 'applied') {
      results.push({ collection: r.collection, id, status: 'applied', version: Number(r.version), serverSeq: Number(r.server_seq) });
    } else if (r.status === 'conflict') {
      results.push({
        collection: r.collection,
        id,
        status: 'conflict',
        reason: String(r.reason ?? 'version_mismatch'),
        record: (r.record as Record<string, unknown> | null) ?? null,
      });
    } else {
      results.push({
        collection: r.collection,
        id,
        status: 'error',
        error: String(r.error ?? 'Unbekannter Fehler'),
        code: typeof r.code === 'string' ? r.code : null,
      });
    }
  }
  return results;
}

export function parsePullPage(data: unknown): PullPage {
  const d = (data ?? {}) as Record<string, unknown>;
  const list = Array.isArray(d.changes) ? d.changes : [];
  const changes: PulledChange[] = [];
  for (const raw of list) {
    const c = raw as Record<string, unknown>;
    if (!isCollection(c.collection) || !c.record || typeof c.record !== 'object') continue;
    changes.push({ collection: c.collection, serverSeq: Number(c.server_seq), record: c.record as Record<string, unknown> });
  }
  return { changes, hasMore: d.has_more === true };
}
