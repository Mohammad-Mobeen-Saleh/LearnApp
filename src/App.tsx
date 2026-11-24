import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from 'react';
import { ServicesProvider, useAccountPrompt, useAuthState, useServices, useSyncStatus } from './app/ServicesContext.tsx';
import type { Services } from './app/services.ts';
import { useRoute } from './app/router.ts';
import { applyUpdate, getPwaState, subscribePwa } from './app/pwa.ts';
import { Button, ConflictBanner, FeedbackProvider, Logo, Modal, SyncBadge, useFeedback } from './ui/components.tsx';
import { Icon, type IconName } from './ui/Icon.tsx';
import { DashboardPage } from './pages/DashboardPage.tsx';
import { DecksPage } from './pages/DecksPage.tsx';
import { DeckDetailPage } from './pages/DeckDetailPage.tsx';
import { ImportPage } from './pages/ImportPage.tsx';
import { StatsPage } from './pages/StatsPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { AccountPage } from './pages/AccountPage.tsx';
import { ConflictsPage } from './pages/ConflictsPage.tsx';

// Das Spiel (Phaser) wird erst beim Spielen geladen
const PlayPage = lazy(() => import('./pages/PlayPage.tsx'));

const NAV: { to: string; label: string; icon: IconName; match: (path: string) => boolean }[] = [
  { to: '/', label: 'Start', icon: 'home', match: (p) => p === '/' },
  { to: '/decks', label: 'Lernpakete', icon: 'decks', match: (p) => p.startsWith('/decks') || p === '/import' },
  { to: '/play', label: 'Spielen', icon: 'play', match: (p) => p === '/play' },
  { to: '/stats', label: 'Statistik', icon: 'stats', match: (p) => p === '/stats' },
  { to: '/settings', label: 'Einstellungen', icon: 'settings', match: (p) => ['/settings', '/account', '/conflicts'].includes(p) },
];

export function App({ services }: { services: Services }) {
  return (
    <ServicesProvider services={services}>
      <FeedbackProvider>
        <Shell />
      </FeedbackProvider>
    </ServicesProvider>
  );
}

function Shell() {
  const route = useRoute();
  const status = useSyncStatus();
  const inGame = route.path === '/play' && (route.params.has('deck') || route.params.has('mode'));

  useEffect(() => {
    document.body.classList.toggle('in-game', inGame);
  }, [inGame]);

  useEffect(() => {
    if (!inGame) window.scrollTo(0, 0);
  }, [route.path, inGame]);

  return (
    <div className={inGame ? 'app app-game' : 'app'}>
      {inGame ? null : (
        <header className="app-header">
          <a className="brand" href="#/" aria-label="Meteor Defense – Startseite">
            <Logo size={36} />
            <span className="brand-name">
              Meteor <strong>Defense</strong>
            </span>
          </a>
          <nav className="top-nav" aria-label="Hauptnavigation">
            {NAV.map((item) => (
              <a key={item.to} href={`#${item.to}`} className={item.match(route.path) ? 'active' : undefined}>
                <Icon name={item.icon} size={18} />
                <span>{item.label}</span>
              </a>
            ))}
          </nav>
          <SyncBadge status={status} />
        </header>
      )}
      <main className={inGame ? 'app-main app-main-game' : 'app-main'} id="main">
        {inGame ? null : <ConflictBanner count={status.conflicts} />}
        <Suspense fallback={<div className="loading">Spiel wird geladen …</div>}>
          <Page path={route.path} segments={route.segments} params={route.params} />
        </Suspense>
      </main>
      {inGame ? null : (
        <nav className="tab-bar" aria-label="Navigation">
          {NAV.map((item) => (
            <a key={item.to} href={`#${item.to}`} className={item.match(route.path) ? 'active' : undefined}>
              <Icon name={item.icon} size={22} />
              <span>{item.label === 'Einstellungen' ? 'Mehr' : item.label}</span>
            </a>
          ))}
        </nav>
      )}
      <GlobalOverlays />
    </div>
  );
}

function Page({ path, segments, params }: { path: string; segments: string[]; params: URLSearchParams }) {
  if (path === '/') return <DashboardPage />;
  if (path === '/decks') return <DecksPage />;
  if (segments[0] === 'decks' && segments[1]) return <DeckDetailPage deckId={segments[1]} />;
  if (path === '/import') return <ImportPage targetDeckId={params.get('deck')} />;
  if (path === '/play') return <PlayPage deckId={params.get('deck')} mode={params.get('mode')} />;
  if (path === '/stats') return <StatsPage />;
  if (path === '/settings') return <SettingsPage />;
  if (path === '/account') return <AccountPage />;
  if (path === '/conflicts') return <ConflictsPage />;
  return (
    <div className="card empty">
      <h2>Seite nicht gefunden</h2>
      <a className="btn btn-primary" href="#/">
        Zur Startseite
      </a>
    </div>
  );
}

function GlobalOverlays() {
  const { account, auth } = useServices();
  const prompt = useAccountPrompt();
  const authState = useAuthState();
  const { toast } = useFeedback();
  const pwa = useSyncExternalStore(subscribePwa, () => getPwaState().needRefresh);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    account.onFirstLogin = ({ localDecks }) =>
      toast(
        localDecks > 0
          ? `Angemeldet. ${localDecks} lokale Lernpakete werden mit deinem Konto zusammengeführt.`
          : 'Angemeldet. Deine Daten werden synchronisiert.',
        'success',
      );
    return () => {
      account.onFirstLogin = null;
    };
  }, [account, toast]);

  return (
    <>
      {pwa ? (
        <div className="update-banner" role="status">
          <Icon name="sync" />
          <span>Eine neue Version von Meteor Defense ist verfügbar.</span>
          <Button variant="primary" size="sm" onClick={() => void applyUpdate()}>
            Aktualisieren
          </Button>
        </div>
      ) : null}

      {prompt?.kind === 'owner_mismatch' ? (
        <Modal
          title="Anderes Benutzerkonto"
          actions={
            <>
              <Button onClick={() => void account.cancelAccountSwitch()}>Abbrechen</Button>
              <Button variant="danger" onClick={() => void account.confirmAccountSwitch()}>
                Lokale Daten entfernen und fortfahren
              </Button>
            </>
          }
        >
          <p>
            Auf diesem Gerät sind Daten eines anderen Kontos gespeichert. Damit sich Konten nicht vermischen, werden diese lokalen
            Daten entfernt. In der Cloud des anderen Kontos bleiben sie erhalten.
          </p>
          {prompt.pending > 0 ? (
            <p className="warning-text">
              Achtung: {prompt.pending} Änderung(en) des anderen Kontos wurden noch nicht synchronisiert. Brich ab, melde dich mit dem
              anderen Konto an und synchronisiere zuerst – oder exportiere eine Sicherung in den Einstellungen.
            </p>
          ) : null}
        </Modal>
      ) : null}

      {authState.recovery ? (
        <Modal title="Neues Passwort festlegen">
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await auth.updatePassword(password);
                setPassword('');
                toast('Passwort geändert.', 'success');
              } catch (err) {
                toast((err as Error).message, 'error');
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="field">
              <span>Neues Passwort</span>
              <input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <Button type="submit" variant="primary" disabled={busy || password.length < 8}>
              Passwort speichern
            </Button>
          </form>
        </Modal>
      ) : null}
    </>
  );
}
