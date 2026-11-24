import type { ConflictReason } from '../domain/types.ts';
import type { AnyRecord, CollectionSpec } from './collections.ts';

/**
 * Entscheidungslogik bei Synchronisierungskonflikten (rein funktional, testbar).
 *
 * Der Server meldet einen Konflikt, wenn die mitgeschickte Basisversion nicht der
 * aktuellen Server-Version entspricht (jemand anderes hat inzwischen geändert),
 * wenn eine Frage in ein gelöschtes Lernpaket geschrieben werden soll oder wenn ein
 * Lernpaket gelöscht werden soll, das ein anderes Gerät inzwischen verändert hat.
 *
 * Grundsatz: Es geht nie etwas still verloren. Lässt sich eine Änderung nicht sicher
 * automatisch zusammenführen, entsteht ein Konfliktdatensatz mit beiden Versionen.
 */

export function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a === null || b === null) return false;
  if (typeof a === 'object' || typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return false;
}

export function sameContent(spec: CollectionSpec, a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return spec.fields.every((f) => valuesEqual(a[f], b[f]));
}

export type MergeResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; conflictingFields: string[]; reason: ConflictReason };

/** Drei-Wege-Merge auf Feldebene (Basis = gemeinsamer Ausgangsstand). */
export function threeWayMerge(
  spec: CollectionSpec,
  base: Record<string, unknown>,
  local: Record<string, unknown>,
  remote: Record<string, unknown>,
): MergeResult {
  const value: Record<string, unknown> = {};
  const conflictingFields: string[] = [];
  for (const f of spec.fields) {
    const b = base[f];
    const l = local[f];
    const r = remote[f];
    if (valuesEqual(l, r)) value[f] = l;
    else if (valuesEqual(l, b)) value[f] = r;
    else if (valuesEqual(r, b)) value[f] = l;
    else conflictingFields.push(f);
  }
  const contentFields = spec.fields.filter((f) => f !== 'deleted');
  const changed = (side: Record<string, unknown>) => contentFields.some((f) => !valuesEqual(side[f], base[f]));
  // Löschung auf der einen Seite, inhaltliche Änderung auf der anderen: nie automatisch entscheiden
  if (remote.deleted === true && local.deleted !== true && changed(local)) {
    return { ok: false, conflictingFields: ['deleted'], reason: 'remote_deleted' };
  }
  if (local.deleted === true && remote.deleted !== true && changed(remote)) {
    return { ok: false, conflictingFields: ['deleted'], reason: 'local_deleted' };
  }
  if (conflictingFields.length > 0) {
    const reason: ConflictReason =
      remote.deleted === true && local.deleted !== true
        ? 'remote_deleted'
        : local.deleted === true && remote.deleted !== true
          ? 'local_deleted'
          : 'edit_edit';
    return { ok: false, conflictingFields, reason };
  }
  return { ok: true, value };
}

export type ConflictDecision =
  /** Server-Stand übernehmen, lokale Änderung ist bereits enthalten oder überflüssig */
  | { type: 'adopt_remote' }
  /** Server-Stand stammt von diesem Gerät (Antwort ging verloren): lokale Änderung erneut senden */
  | { type: 'fast_forward' }
  /** automatisch zusammengeführt – Ergebnis erneut senden */
  | { type: 'merged'; data: Record<string, unknown> }
  /** echter Konflikt: Server-Stand übernehmen und lokale Version im Konfliktdatensatz sichern */
  | { type: 'conflict'; reason: ConflictReason };

export function decideConflict(input: {
  spec: CollectionSpec;
  local: AnyRecord;
  base: Record<string, unknown> | null;
  remote: AnyRecord | null;
  deviceId: string;
  serverReason: string;
}): ConflictDecision {
  const { spec, local, base, remote, deviceId, serverReason } = input;

  if (serverReason === 'deck_deleted') return { type: 'conflict', reason: 'deck_deleted' };
  if (serverReason === 'deck_changed') return { type: 'conflict', reason: 'deck_changed' };
  if (!remote) return { type: 'conflict', reason: 'edit_edit' };

  // Konfliktdatensätze selbst: «erledigt» gewinnt immer, nie ein neuer Konflikt
  if (spec.name === 'sync_conflicts') {
    const merged = {
      resolved: local.resolved === true || remote.resolved === true,
      resolution: (remote.resolution as string | null) ?? (local.resolution as string | null) ?? null,
      deleted: local.deleted === true || remote.deleted === true,
    };
    return sameContent(spec, merged, remote) ? { type: 'adopt_remote' } : { type: 'merged', data: merged };
  }

  if (sameContent(spec, local, remote)) return { type: 'adopt_remote' };
  if (local.deleted === true && remote.deleted === true) return { type: 'adopt_remote' };
  if (remote.deviceId === deviceId) return { type: 'fast_forward' };

  if (base) {
    const merged = threeWayMerge(spec, base, local, remote);
    if (merged.ok) {
      return sameContent(spec, merged.value, remote) ? { type: 'adopt_remote' } : { type: 'merged', data: merged.value };
    }
    return { type: 'conflict', reason: merged.reason };
  }

  if (remote.deleted === true && local.deleted !== true) return { type: 'conflict', reason: 'remote_deleted' };
  if (local.deleted === true && remote.deleted !== true) return { type: 'conflict', reason: 'local_deleted' };
  return { type: 'conflict', reason: 'edit_edit' };
}
