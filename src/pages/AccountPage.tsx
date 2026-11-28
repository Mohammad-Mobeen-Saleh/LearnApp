import { useState } from 'react';
import { useAuthState, useServices, useSyncStatus } from '../app/ServicesContext.tsx';
import { navigate } from '../app/router.ts';
import { Button, describeSync, PageHeader, useFeedback } from '../ui/components.tsx';
import { Icon } from '../ui/Icon.tsx';

type Mode = 'signin' | 'signup' | 'reset';

export function AccountPage() {
  const { auth, account, cloudConfigured } = useServices();
  const state = useAuthState();
  const status = useSyncStatus();
  const { toast, confirm } = useFeedback();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!cloudConfigured) {
    return (
      <div className="page narrow">
        <PageHeader back="/settings" title="Benutzerkonto" />
        <div className="card">
          <div className="card-title">
            <Icon name="cloudOff" />
            <h2>Lokaler Modus</h2>
          </div>
          <p>
            Supabase ist noch nicht konfiguriert. Meteor Defense funktioniert vollständig auf diesem Gerät, die geräteübergreifende
            Synchronisierung ist aber <strong>noch nicht aktiv</strong>.
          </p>
          <p className="muted">
            Zum Aktivieren die Werte <code>VITE_SUPABASE_URL</code> und <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> setzen (siehe
            README, Abschnitt «Supabase einrichten») und die App neu bauen.
          </p>
        </div>
      </div>
    );
  }

  const submit = async () => {
    setBusy(true);
    setMessage(null);
    try {
      if (mode === 'signin') {
        await auth.signIn(email, password);
        toast('Angemeldet.', 'success');
        navigate('/');
      } else if (mode === 'signup') {
        const needsConfirmation = await auth.signUp(email, password);
        if (needsConfirmation) {
          setMessage('Fast geschafft: Bitte bestätige deine E-Mail-Adresse über den Link in der E-Mail und melde dich danach hier an.');
          setMode('signin');
        } else {
          toast('Konto erstellt und angemeldet.', 'success');
          navigate('/');
        }
      } else {
        await auth.sendPasswordReset(email);
        setMessage('Wir haben dir eine E-Mail zum Zurücksetzen des Passworts geschickt.');
      }
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    setBusy(true);
    try {
      let result = await account.logout();
      if (!result.ok) {
        const ok = await confirm({
          title: 'Nicht synchronisierte Änderungen',
          message: (
            <p>
              {result.pending} Änderung(en) konnten noch nicht in die Cloud übertragen werden (z. B. offline). Beim Abmelden werden die
              lokalen Daten von diesem Gerät entfernt, und diese Änderungen gingen verloren. Exportiere vorher eine Sicherung unter
              Einstellungen → Datensicherung oder warte, bis wieder eine Verbindung besteht.
            </p>
          ),
          confirmLabel: 'Trotzdem abmelden',
          danger: true,
        });
        if (!ok) return;
        result = await account.logout({ force: true });
      }
      if (result.ok) toast('Abgemeldet. Die Daten bleiben in deinem Konto gespeichert.', 'success');
    } finally {
      setBusy(false);
    }
  };

  if (state.status === 'signed_in' && state.user) {
    const view = describeSync(status);
    return (
      <div className="page narrow">
        <PageHeader back="/settings" title="Benutzerkonto" />
        <div className="card">
          <div className="card-title">
            <Icon name="user" />
            <h2>Angemeldet</h2>
          </div>
          <p>
            <strong>{state.user.email}</strong>
          </p>
          <p className="muted">
            Melde dich auf deinem iPhone und deinem Laptop mit demselben Konto an. Lernpakete, Fragen, Einstellungen und Lernfortschritt
            werden automatisch zusammengeführt.
          </p>
          <p className={`pill pill-${view.tone}`}>{view.label}</p>
          <div className="row">
            <Button icon="logout" onClick={() => void logout()} disabled={busy}>
              Abmelden
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page narrow">
      <PageHeader back="/settings" title={mode === 'signup' ? 'Konto erstellen' : mode === 'reset' ? 'Passwort zurücksetzen' : 'Anmelden'} />
      <div className="card">
        <p className="muted">
          Mit einem Konto stehen deine Lernpakete und dein Fortschritt auf allen Geräten zur Verfügung. Bereits lokal gespeicherte
          Lernpakete werden beim ersten Anmelden mit dem Konto zusammengeführt. Nichts wird überschrieben.
        </p>
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="field">
            <span>E-Mail-Adresse</span>
            <input type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          {mode !== 'reset' ? (
            <label className="field">
              <span>Passwort{mode === 'signup' ? ' (mindestens 8 Zeichen)' : ''}</span>
              <input
                type="password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                required
                minLength={mode === 'signup' ? 8 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          ) : null}
          {message ? <p className="info-text">{message}</p> : null}
          <Button type="submit" variant="primary" size="lg" disabled={busy || state.status === 'loading'}>
            {mode === 'signup' ? 'Konto erstellen' : mode === 'reset' ? 'Link senden' : 'Anmelden'}
          </Button>
        </form>
        <div className="row auth-switch">
          {mode !== 'signin' ? (
            <Button variant="ghost" size="sm" onClick={() => setMode('signin')}>
              Zur Anmeldung
            </Button>
          ) : null}
          {mode !== 'signup' ? (
            <Button variant="ghost" size="sm" onClick={() => setMode('signup')}>
              Neues Konto erstellen
            </Button>
          ) : null}
          {mode !== 'reset' ? (
            <Button variant="ghost" size="sm" onClick={() => setMode('reset')}>
              Passwort vergessen?
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
