import type { LocalStore } from '../data/localStore.ts';
import { COLLECTIONS } from './collections.ts';
import { RemoteError, type PushChange, type SyncRemote } from './types.ts';

/**
 * Synchronisierungs-Engine.
 *
 * Ablauf eines Abgleichs: 1) ausstehende lokale Änderungen einzeln hochladen (Push),
 * 2) neue Änderungen anderer Geräte abrufen (Pull, ab dem zuletzt gesehenen Server-Zähler),
 * 3) bei Bedarf erneut pushen (z. B. automatisch zusammengeführte Datensätze).
 *
 * Auslöser: App-Start, Anmeldung, lokale Änderung (verzögert), Wiederherstellung der
 * Verbindung, Rückkehr in die App und ein regelmässiger Abgleich alle 60 Sekunden.
 */

export type SyncPhase = 'local_only' | 'signed_out' | 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncStatus {
  phase: SyncPhase;
  pending: number;
  failed: number;
  conflicts: number;
  lastSyncAt: string | null;
  lastError: string | null;
  online: boolean;
}

export interface SyncReport {
  pushed: number;
  pulled: number;
  merged: number;
  conflicts: number;
  errors: number;
  ok: boolean;
}

export interface SyncEngineOptions {
  cloudConfigured?: boolean;
  batchSize?: number;
  pageSize?: number;
  debounceMs?: number;
  pollMs?: number;
  isOnline?: () => boolean;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function isNetworkError(err: unknown): boolean {
  if (err instanceof RemoteError) return err.transient;
  const msg = errorMessage(err);
  return err instanceof TypeError || /failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(msg);
}

export class SyncEngine {
  private readonly store: LocalStore;
  private readonly cloudConfigured: boolean;
  private readonly batchSize: number;
  private readonly pageSize: number;
  private readonly debounceMs: number;
  private readonly pollMs: number;
  private readonly isOnlineFn: () => boolean;
  private remote: SyncRemote | null = null;
  private running: Promise<SyncReport> | null = null;
  private rerunRequested = false;
  private failures = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private cleanup: (() => void)[] = [];
  private listeners = new Set<(s: SyncStatus) => void>();
  private status: SyncStatus;

  constructor(store: LocalStore, options: SyncEngineOptions = {}) {
    this.store = store;
    this.cloudConfigured = options.cloudConfigured ?? true;
    this.batchSize = options.batchSize ?? 200;
    this.pageSize = options.pageSize ?? 500;
    this.debounceMs = options.debounceMs ?? 1500;
    this.pollMs = options.pollMs ?? 60_000;
    this.isOnlineFn = options.isOnline ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
    this.status = {
      phase: this.cloudConfigured ? 'signed_out' : 'local_only',
      pending: 0,
      failed: 0,
      conflicts: 0,
      lastSyncAt: null,
      lastError: null,
      online: this.isOnlineFn(),
    };
  }

  get hasRemote(): boolean {
    return this.remote !== null;
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  subscribe(listener: (s: SyncStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setRemote(remote: SyncRemote | null): void {
    this.remote = remote;
    this.failures = 0;
    void this.refreshStatus({ lastError: null }, remote ? 'idle' : undefined);
  }

  private setStatus(next: SyncStatus) {
    this.status = next;
    for (const l of [...this.listeners]) l(next);
  }

  private basePhase(): SyncPhase {
    if (!this.cloudConfigured) return 'local_only';
    if (!this.remote) return 'signed_out';
    if (!this.isOnlineFn()) return 'offline';
    return 'idle';
  }

  async refreshStatus(patch: Partial<SyncStatus> = {}, phase?: SyncPhase): Promise<SyncStatus> {
    const counters = await this.store.syncCounters();
    const lastSyncAt = await this.store.getLastSyncAt();
    const keepError = this.status.phase === 'error' && phase === undefined && this.remote !== null;
    const next: SyncStatus = {
      ...this.status,
      ...counters,
      lastSyncAt,
      online: this.isOnlineFn(),
      ...patch,
      phase: phase ?? (this.running ? 'syncing' : keepError ? 'error' : this.basePhase()),
    };
    this.setStatus(next);
    return next;
  }

  /** Startet einen Abgleich. Laufende Abgleiche werden nicht doppelt gestartet. */
  sync(): Promise<SyncReport> {
    if (this.running) {
      this.rerunRequested = true;
      return this.running;
    }
    const run = this.runExclusive().finally(() => {
      this.running = null;
      if (this.rerunRequested) {
        this.rerunRequested = false;
        this.schedule(250);
      }
    });
    this.running = run;
    return run;
  }

  private async runExclusive(): Promise<SyncReport> {
    const locks = (globalThis.navigator as Navigator | undefined)?.locks;
    if (locks && typeof locks.request === 'function') {
      // Nur ein Tab gleichzeitig synchronisiert
      return locks.request('meteor-defense-sync', () => this.cycle());
    }
    return this.cycle();
  }

  private async cycle(): Promise<SyncReport> {
    const report: SyncReport = { pushed: 0, pulled: 0, merged: 0, conflicts: 0, errors: 0, ok: false };
    const remote = this.remote;
    if (!remote) {
      await this.refreshStatus();
      return report;
    }
    if (!this.isOnlineFn()) {
      await this.refreshStatus({}, 'offline');
      return report;
    }
    await this.refreshStatus({}, 'syncing');
    try {
      for (let pass = 0; pass < 3; pass++) {
        await this.pushAll(remote, report);
        report.pulled += await this.pullAll(remote);
        const counters = await this.store.syncCounters();
        if (counters.pending === 0) break;
      }
      await this.store.setLastSyncAt(new Date().toISOString());
      this.failures = 0;
      report.ok = true;
      await this.refreshStatus(
        { lastError: report.errors > 0 ? `${report.errors} Änderung(en) konnten nicht übertragen werden.` : null },
        this.basePhase(),
      );
    } catch (err) {
      this.failures += 1;
      const offline = !this.isOnlineFn() || isNetworkError(err);
      await this.refreshStatus(
        { lastError: offline ? 'Keine Verbindung zur Cloud – Änderungen bleiben lokal gespeichert.' : errorMessage(err) },
        offline ? 'offline' : 'error',
      );
      this.scheduleRetry();
    }
    return report;
  }

  private async pushAll(remote: SyncRemote, report: SyncReport): Promise<void> {
    const deviceId = await this.store.getDeviceId();
    const erroredThisCycle = new Set<string>();
    for (let round = 0; round < 50; round++) {
      const items = (await this.store.getPushBatch(this.batchSize + erroredThisCycle.size)).filter(
        (i) => !erroredThisCycle.has(i.entry.key),
      ).slice(0, this.batchSize);
      if (items.length === 0) return;
      const knownSeq = await this.store.getPullCursor();
      const changes: PushChange[] = items.map(({ entry, record }) => {
        const spec = COLLECTIONS[entry.collection];
        return {
          collection: entry.collection,
          id: entry.id,
          baseVersion: spec.kind === 'append' ? 0 : Number(record.version ?? 0),
          data: spec.toServer(record),
        };
      });
      const results = await remote.push({ deviceId, knownSeq, changes });
      for (const r of results) if (r.status === 'error') erroredThisCycle.add(`${r.collection}:${r.id}`);
      const outcome = await this.store.applyPushResults(items, results, deviceId);
      report.pushed += outcome.applied;
      report.merged += outcome.merged;
      report.conflicts += outcome.conflicts;
      report.errors += outcome.errors;
      if (outcome.applied + outcome.merged + outcome.conflicts === 0) return;
    }
  }

  private async pullAll(remote: SyncRemote): Promise<number> {
    let cursor = await this.store.getPullCursor();
    let total = 0;
    for (let page = 0; page < 10_000; page++) {
      const result = await remote.pull({ since: cursor, limit: this.pageSize });
      const maxSeq = result.changes.reduce((m, c) => Math.max(m, c.serverSeq), cursor);
      total += await this.store.applyPulledChanges(result.changes, maxSeq);
      cursor = maxSeq;
      if (!result.hasMore || result.changes.length === 0) break;
    }
    return total;
  }

  // ------------------------------------------------------------------ automatische Auslöser

  schedule(delayMs = this.debounceMs): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.sync();
    }, delayMs);
  }

  private scheduleRetry(): void {
    const delay = Math.min(60_000, 2_000 * 2 ** Math.min(this.failures, 5));
    this.schedule(delay);
  }

  start(): void {
    if (this.cleanup.length) return;
    const unsubscribe = this.store.subscribe((event) => {
      if (event.source === 'sync') return;
      void this.refreshStatus();
      if (event.source === 'local' && this.remote) this.schedule(this.debounceMs);
    });
    this.cleanup.push(unsubscribe);
    if (typeof window !== 'undefined') {
      const onOnline = () => {
        void this.refreshStatus();
        if (this.remote) this.schedule(300);
      };
      const onOffline = () => void this.refreshStatus({}, this.remote ? 'offline' : undefined);
      window.addEventListener('online', onOnline);
      window.addEventListener('offline', onOffline);
      this.cleanup.push(() => window.removeEventListener('online', onOnline));
      this.cleanup.push(() => window.removeEventListener('offline', onOffline));
    }
    if (typeof document !== 'undefined') {
      const onVisible = () => {
        if (document.visibilityState === 'visible' && this.remote) this.schedule(200);
      };
      document.addEventListener('visibilitychange', onVisible);
      this.cleanup.push(() => document.removeEventListener('visibilitychange', onVisible));
    }
    this.interval = setInterval(() => {
      const visible = typeof document === 'undefined' || document.visibilityState === 'visible';
      if (visible && this.remote) void this.sync();
    }, this.pollMs);
    void this.refreshStatus();
  }

  stop(): void {
    for (const fn of this.cleanup.splice(0)) fn();
    if (this.timer) clearTimeout(this.timer);
    if (this.interval) clearInterval(this.interval);
    this.timer = null;
    this.interval = null;
  }
}
