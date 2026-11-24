import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Benutzerkonto über Supabase Auth (E-Mail + Passwort).
 * Im Frontend wird ausschliesslich der öffentliche Schlüssel verwendet; der Schutz der
 * Daten erfolgt über Row Level Security in der Datenbank.
 */

export type AuthStatus = 'disabled' | 'loading' | 'signed_out' | 'signed_in';

export interface AuthUser {
  id: string;
  email: string | null;
}

export interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  /** true, wenn die App über einen Link «Passwort zurücksetzen» geöffnet wurde */
  recovery: boolean;
}

export interface SupabaseConfig {
  url: string;
  key: string;
}

export function readSupabaseConfig(env: Record<string, string | undefined> = import.meta.env): SupabaseConfig | null {
  const url = (env.VITE_SUPABASE_URL ?? '').trim();
  // Neuer «Publishable key» (sb_publishable_…) bevorzugt, älterer «anon»-Key als Rückfall
  const key = (env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY || '').trim();
  if (!url || !key) return null;
  if (url.includes('DEIN-PROJEKT') || key.startsWith('DEIN-')) return null;
  // Sicherheitsnetz: geheime Schlüssel dürfen nie im Frontend landen
  if (key.startsWith('sb_secret_') || /service_role/.test(atobSafe(key.split('.')[1] ?? ''))) {
    console.error('Supabase: Es wurde ein GEHEIMER Schlüssel konfiguriert. Bitte den öffentlichen Publishable/anon-Key verwenden.');
    return null;
  }
  if (!/^https?:\/\//.test(url)) return null;
  return { url, key };
}

function atobSafe(value: string): string {
  try {
    return atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  } catch {
    return '';
  }
}

const AUTH_MESSAGES: [RegExp, string][] = [
  [/invalid login credentials/i, 'E-Mail-Adresse oder Passwort ist falsch.'],
  [/email not confirmed/i, 'Bitte bestätige zuerst deine E-Mail-Adresse über den Link in der Bestätigungs-E-Mail.'],
  [/user already registered|already been registered/i, 'Für diese E-Mail-Adresse besteht bereits ein Konto. Bitte melde dich an.'],
  [/password should be at least|weak password/i, 'Das Passwort ist zu schwach (mindestens 8 Zeichen empfohlen).'],
  [/rate limit|too many requests|security purposes/i, 'Zu viele Versuche. Bitte warte einen Moment und versuche es erneut.'],
  [/invalid email|unable to validate email/i, 'Bitte gib eine gültige E-Mail-Adresse ein.'],
  [/failed to fetch|network|load failed/i, 'Keine Verbindung zum Server. Bitte prüfe deine Internetverbindung.'],
  [/signups not allowed|signup is disabled/i, 'Neue Registrierungen sind in diesem Supabase-Projekt deaktiviert.'],
];

export function translateAuthError(message: string): string {
  for (const [re, text] of AUTH_MESSAGES) if (re.test(message)) return text;
  return message;
}

export class AuthService {
  readonly client: SupabaseClient | null;
  private state: AuthState;
  private listeners = new Set<(s: AuthState) => void>();

  constructor(config: SupabaseConfig | null) {
    if (!config) {
      this.client = null;
      this.state = { status: 'disabled', user: null, recovery: false };
      return;
    }
    this.client = createClient(config.url, config.key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'meteor-defense-auth',
      },
    });
    this.state = { status: 'loading', user: null, recovery: false };
    this.client.auth.onAuthStateChange((event, session) => {
      // Laut Supabase-Dokumentation keine weiteren Supabase-Aufrufe direkt im Callback
      setTimeout(() => this.handleAuthEvent(event, session), 0);
    });
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  getState(): AuthState {
    return this.state;
  }

  subscribe(listener: (s: AuthState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setState(next: AuthState) {
    this.state = next;
    for (const l of [...this.listeners]) l(next);
  }

  private handleAuthEvent(event: string, session: Session | null) {
    const user = session?.user ? { id: session.user.id, email: session.user.email ?? null } : null;
    const recovery = event === 'PASSWORD_RECOVERY' ? true : event === 'SIGNED_OUT' ? false : this.state.recovery;
    const same = this.state.user?.id === user?.id && this.state.status === (user ? 'signed_in' : 'signed_out');
    if (same && recovery === this.state.recovery) return;
    this.setState({ status: user ? 'signed_in' : 'signed_out', user, recovery });
  }

  private requireClient(): SupabaseClient {
    if (!this.client) throw new Error('Supabase ist nicht konfiguriert (lokaler Modus).');
    return this.client;
  }

  async signIn(email: string, password: string): Promise<void> {
    const { error } = await this.requireClient().auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error(translateAuthError(error.message));
  }

  /** Registrierung. Liefert true, wenn zuerst die E-Mail-Adresse bestätigt werden muss. */
  async signUp(email: string, password: string): Promise<boolean> {
    const { data, error } = await this.requireClient().auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: `${window.location.origin}/` },
    });
    if (error) throw new Error(translateAuthError(error.message));
    return !data.session;
  }

  async sendPasswordReset(email: string): Promise<void> {
    const { error } = await this.requireClient().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/`,
    });
    if (error) throw new Error(translateAuthError(error.message));
  }

  async updatePassword(password: string): Promise<void> {
    const { error } = await this.requireClient().auth.updateUser({ password });
    if (error) throw new Error(translateAuthError(error.message));
    this.setState({ ...this.state, recovery: false });
  }

  /** Meldet nur dieses Gerät ab (andere Geräte bleiben angemeldet). */
  async signOut(): Promise<void> {
    if (!this.client) return;
    const { error } = await this.client.auth.signOut({ scope: 'local' });
    if (error) console.warn('Abmelden:', error.message);
    this.setState({ status: 'signed_out', user: null, recovery: false });
  }
}
