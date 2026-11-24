import type { Collection } from '../domain/types.ts';

/** Eine lokale Änderung, die an den Server gesendet wird. */
export interface PushChange {
  collection: Collection;
  id: string;
  /** Server-Version, auf der die Änderung basiert (0 = neuer Datensatz) */
  baseVersion: number;
  /** Inhalt im Server-Format (snake_case) */
  data: Record<string, unknown>;
}

export type PushResult =
  | { collection: Collection; id: string; status: 'applied'; version: number; serverSeq: number }
  | { collection: Collection; id: string; status: 'conflict'; reason: string; record: Record<string, unknown> | null }
  | { collection: Collection; id: string; status: 'error'; error: string; code: string | null };

export interface PulledChange {
  collection: Collection;
  serverSeq: number;
  /** vollständige Server-Zeile */
  record: Record<string, unknown>;
}

export interface PullPage {
  changes: PulledChange[];
  hasMore: boolean;
}

/** Schnittstelle zur Cloud (Supabase-RPC oder Test-Server). */
export interface SyncRemote {
  push(input: { deviceId: string; knownSeq: number; changes: PushChange[] }): Promise<PushResult[]>;
  pull(input: { since: number; limit: number }): Promise<PullPage>;
}

/** Fehler bei der Kommunikation mit der Cloud. `transient` = später erneut versuchen. */
export class RemoteError extends Error {
  readonly code: string | null;
  readonly transient: boolean;

  constructor(message: string, options: { code?: string | null; transient?: boolean } = {}) {
    super(message);
    this.name = 'RemoteError';
    this.code = options.code ?? null;
    this.transient = options.transient ?? true;
  }
}

/** Postgres-Fehlercodes, bei denen ein erneuter Versuch nichts ändert. */
export function isPermanentErrorCode(code: string | null | undefined): boolean {
  if (!code) return false;
  // 22xxx Datenfehler, 23xxx Integritätsverletzung (ausser 23503 Fremdschlüssel: Paket kommt evtl. noch),
  // 42xxx Syntax/Rechte, P0001 raise_exception
  if (code === '23503') return false;
  return code.startsWith('22') || code.startsWith('23') || code.startsWith('42') || code === 'P0001';
}
