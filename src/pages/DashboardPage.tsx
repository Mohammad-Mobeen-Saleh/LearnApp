import { useServices, useLiveQuery, useSettings, useSyncStatus, useAuthState } from '../app/ServicesContext.tsx';
import { computeStats, filterByGame } from '../domain/stats.ts';
import { GAMES, gameRoute } from '../games/registry.ts';
import { useSelectedDeck } from '../games/selection.ts';
import { SPEED_LABELS, type SpeedSetting } from '../domain/types.ts';
import { formatNumber, formatPercent, plural } from '../lib/text.ts';
import { Button, describeSync, LinkButton, Logo, ProgressBar, Stat } from '../ui/components.tsx';
import { Icon } from '../ui/Icon.tsx';

function greeting(name: string): string {
  const h = new Date().getHours();
  const base = h < 11 ? 'Guten Morgen' : h < 18 ? 'Hallo' : 'Guten Abend';
  return name ? `${base}, ${name}` : `${base}!`;
}

export function DashboardPage() {
  const { store, sync, cloudConfigured } = useServices();
  const settings = useSettings();
  const status = useSyncStatus();
  const auth = useAuthState();
  const stats = useLiveQuery(async (s) => {
    const [decks, questions, sessions, answers] = await Promise.all([s.listDecks(), s.listAllQuestions(), s.listSessions(), s.listAnswers()]);
    const best = Object.fromEntries(GAMES.map((g) => [g.id, filterByGame(sessions, answers, g.id).sessions.reduce((m, x) => Math.max(m, x.score), 0)]));
    return { ...computeStats({ decks, questions, sessions, answers }), best };
  }, []);
  const decks = useLiveQuery((s) => s.deckSummaries(), []);
  const view = describeSync(status);
  const [selectedDeck] = useSelectedDeck();

  return (
    <div className="page dashboard">
      <section className="hero card">
        <Logo size={104} className="hero-logo" />
        <div className="hero-text">
          <p className="eyebrow">{greeting(settings?.playerName ?? '')}</p>
          <h1>Willkommen in der LernArcade</h1>
          <p className="muted">Lerne mit deinen eigenen Lernpaketen und spiele sie in verschiedenen Minispielen.</p>
          <div className="hero-actions">
            <LinkButton to="/games" variant="primary" size="lg" icon="play">
              Spiele
            </LinkButton>
            <LinkButton to="/decks" icon="decks">
              Lernpakete
            </LinkButton>
            <LinkButton to="/import" icon="import">
              Fragen importieren
            </LinkButton>
          </div>
        </div>
      </section>

      <section className="game-strip" aria-label="Spiele">
        {GAMES.map((g) => (
          <a key={g.id} className={`card game-mini ${g.theme}`} href={`#${gameRoute(g.id, { deckId: selectedDeck })}`}>
            <img src={g.logo} alt="" width={52} height={52} />
            <span>
              <strong>{g.name}</strong>
              <span className="small">{g.tagline}</span>
            </span>
            <Icon name="chevron" />
          </a>
        ))}
      </section>

      {stats && stats.repeatQuestionIds.length > 0 ? (
        <a className="card repeat-card" href="#/games">
          <Icon name="repeat" size={26} />
          <div>
            <strong>{plural(stats.repeatQuestionIds.length, 'Frage', 'Fragen')} zum Wiederholen</strong>
            <span className="muted">Zuletzt falsch beantwortet. Jetzt gezielt üben</span>
          </div>
          <Icon name="chevron" />
        </a>
      ) : null}

      <section className="stats-grid" aria-label="Lernstatistik">
        <Stat icon="trophy" label="Highscore" value={formatNumber(stats?.highscore ?? 0)} hint={stats?.games ? GAMES.map((g) => `${g.name} ${formatNumber(stats.best[g.id] ?? 0)}`).join(' · ') : 'noch kein Spiel'} />
        <Stat icon="check" label="Erfolgsquote" value={formatPercent(stats?.successRate ?? null)} hint={`${stats?.correct ?? 0} richtig · ${stats?.wrong ?? 0} falsch`} />
        <Stat icon="play" label="Spielrunden" value={formatNumber(stats?.games ?? 0)} hint={`${stats?.rounds ?? 0} Fragen beantwortet`} />
        <Stat icon="decks" label="Lernpakete" value={decks?.length ?? 0} hint={`${decks?.reduce((n, d) => n + d.questionCount, 0) ?? 0} Fragen`} />
      </section>

      <section className="grid-2">
        <div className={`card sync-card sync-card-${view.tone}`}>
          <div className="card-title">
            <Icon name={view.icon} className={view.spinning ? 'spin' : undefined} />
            <h2>Synchronisierung</h2>
            <span className={`pill pill-${view.tone}`}>{view.label}</span>
          </div>
          <p className="muted">{view.detail}</p>
          <div className="row">
            {!cloudConfigured ? (
              <a className="btn btn-ghost btn-sm" href="#/settings">
                Wie richte ich die Cloud ein?
              </a>
            ) : auth.status === 'signed_in' ? (
              <Button size="sm" icon="sync" onClick={() => void sync.sync()} disabled={status.phase === 'syncing'}>
                Jetzt synchronisieren
              </Button>
            ) : (
              <LinkButton to="/account" size="sm" icon="user" variant="primary">
                Anmelden
              </LinkButton>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            <Icon name="settings" />
            <h2>Einstellungen</h2>
          </div>
          <div className="quick-settings">
            <label className="switch">
              <input
                type="checkbox"
                checked={settings?.soundEnabled ?? true}
                onChange={(e) => void store.updateSettings({ soundEnabled: e.target.checked })}
              />
              <span>Soundeffekte</span>
            </label>
            <label className="field field-inline">
              <span>Tempo</span>
              <select value={settings?.speed ?? 'normal'} onChange={(e) => void store.updateSettings({ speed: e.target.value as SpeedSetting })}>
                {(Object.keys(SPEED_LABELS) as SpeedSetting[]).map((s) => (
                  <option key={s} value={s}>
                    {SPEED_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <a className="btn btn-ghost btn-sm" href="#/settings">
            Alle Einstellungen
          </a>
        </div>
      </section>

      <section className="card">
        <div className="card-title">
          <Icon name="decks" />
          <h2>Deine Lernpakete</h2>
          <a className="link-more" href="#/decks">
            Alle anzeigen
          </a>
        </div>
        {decks && decks.length > 0 ? (
          <ul className="deck-mini-list">
            {decks.slice(0, 5).map(({ deck, questionCount, pending }) => {
              const progress = stats?.decks.find((d) => d.deckId === deck.id);
              const mastered = progress && progress.total > 0 ? progress.mastered / progress.total : 0;
              return (
                <li key={deck.id}>
                  <a href={`#/decks/${deck.id}`} className="deck-mini">
                    <span className="deck-mini-name">{deck.name}</span>
                    <span className="muted small">
                      {plural(questionCount, 'Frage', 'Fragen')}
                      {pending ? ' · lokal gespeichert' : ''}
                    </span>
                    <ProgressBar value={mastered} label={`Gelernt: ${formatPercent(mastered)}`} tone="success" />
                  </a>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted">Noch keine Lernpakete. Importiere Fragen, um loszulegen.</p>
        )}
      </section>
    </div>
  );
}
