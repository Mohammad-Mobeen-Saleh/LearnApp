import { LocalStore } from '../data/localStore.ts';
import { AuthService, readSupabaseConfig, type AuthState } from '../auth/authService.ts';
import { SyncEngine } from '../sync/engine.ts';
import { createSupabaseRemote } from '../sync/supabaseRemote.ts';

/**
 * Verbindet lokalen Speicher, Benutzerkonto und Synchronisierung.
 *
 * Kontobindung: Beim ersten Login wird das Gerät dem Konto zugeordnet und alle bereits
 * lokal vorhandenen Daten werden mit dem Konto zusammengeführt (nichts wird ersetzt).
 * Meldet sich später ein anderes Konto an, werden die lokalen Daten des alten Kontos
 * erst nach ausdrücklicher Bestätigung von diesem Gerät entfernt.
 */

export type AccountPrompt =
  | { kind: 'owner_mismatch'; pending: number; email: string | null; userId: string }
  | null;

export class AccountManager {
  private readonly store: LocalStore;
  private readonly sync: SyncEngine;
  private readonly auth: AuthService;
  private prompt: AccountPrompt = null;
  private listeners = new Set<(p: AccountPrompt) => void>();
  private boundUser: string | null = null;
  /** Meldung für die Oberfläche nach dem ersten Login */
  onFirstLogin: ((info: { localDecks: number }) => void) | null = null;

  constructor(store: LocalStore, sync: SyncEngine, auth: AuthService) {
    this.store = store;
    this.sync = sync;
    this.auth = auth;
  }

  start(): void {
    this.auth.subscribe((state) => void this.handleAuth(state));
    void this.handleAuth(this.auth.getState());
  }

  getPrompt(): AccountPrompt {
    return this.prompt;
  }

  subscribe(listener: (p: AccountPrompt) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setPrompt(p: AccountPrompt) {
    this.prompt = p;
    for (const l of [...this.listeners]) l(p);
  }

  private async handleAuth(state: AuthState): Promise<void> {
    if (state.status !== 'signed_in' || !state.user || !this.auth.client) {
      this.boundUser = null;
      if (state.status !== 'loading') this.sync.setRemote(null);
      return;
    }
    if (this.boundUser === state.user.id) return;
    const owner = await this.store.getOwner();
    if (owner && owner !== state.user.id) {
      const { pending } = await this.store.syncCounters();
      this.sync.setRemote(null);
      this.setPrompt({ kind: 'owner_mismatch', pending, email: state.user.email, userId: state.user.id });
      return;
    }
    if (!owner) {
      // Erstes Login auf diesem Gerät: vorhandene lokale Daten werden mit dem Konto zusammengeführt
      await this.store.setOwner(state.user.id);
      const localDecks = (await this.store.listDecks()).length;
      this.onFirstLogin?.({ localDecks });
    }
    this.bind(state.user.id);
  }

  private bind(userId: string) {
    this.boundUser = userId;
    this.sync.setRemote(createSupabaseRemote(this.auth.client!));
    void this.sync.sync();
  }

  /** Anderes Konto: lokale Daten des vorherigen Kontos von diesem Gerät entfernen. */
  async confirmAccountSwitch(): Promise<void> {
    const p = this.prompt;
    if (!p) return;
    await this.store.clearAccountData({ reseed: false });
    await this.store.setOwner(p.userId);
    this.setPrompt(null);
    this.bind(p.userId);
  }

  async cancelAccountSwitch(): Promise<void> {
    this.setPrompt(null);
    await this.auth.signOut();
  }

  /**
   * Abmelden: Zuerst wird versucht, alles zu übertragen. Sind danach noch Änderungen
   * offen, wird nur mit `force` abgemeldet (die App fragt vorher nach).
   */
  async logout(options: { force?: boolean } = {}): Promise<{ ok: boolean; pending: number }> {
    if (this.sync.hasRemote) await this.sync.sync();
    const { pending } = await this.store.syncCounters();
    if (pending > 0 && !options.force) return { ok: false, pending };
    await this.auth.signOut();
    this.boundUser = null;
    this.sync.setRemote(null);
    await this.store.clearAccountData({ reseed: false });
    return { ok: true, pending: 0 };
  }
}

export interface Services {
  store: LocalStore;
  sync: SyncEngine;
  auth: AuthService;
  account: AccountManager;
  cloudConfigured: boolean;
}

export async function createServices(): Promise<Services> {
  const store = await LocalStore.open('meteor-defense');
  await store.seedIfNeeded();
  const config = readSupabaseConfig();
  const auth = new AuthService(config);
  const sync = new SyncEngine(store, { cloudConfigured: config !== null });
  const account = new AccountManager(store, sync, auth);
  sync.start();
  account.start();
  // Browser bitten, die lokalen Daten nicht automatisch zu löschen
  void globalThis.navigator?.storage?.persist?.().catch(() => false);
  return { store, sync, auth, account, cloudConfigured: config !== null };
}
