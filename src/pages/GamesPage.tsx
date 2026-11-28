import { useEffect } from 'react';
import { useLiveQuery } from '../app/ServicesContext.tsx';
import { navigate } from '../app/router.ts';
import { computeGameBreakdown } from '../domain/stats.ts';
import { GAMES, GAME_IDS, gameRoute } from '../games/registry.ts';
import { useSelectedDeck } from '../games/selection.ts';
import { formatNumber, plural } from '../lib/text.ts';
import { Button, EmptyState, LinkButton, PageHeader } from '../ui/components.tsx';
import { Icon } from '../ui/Icon.tsx';

/**
 * Spieleübersicht: gemeinsame Lernpaket-Auswahl und je eine Karte pro Spiel.
 * Das gewählte Lernpaket gilt für alle Spiele und bleibt beim Wechsel erhalten.
 */
export function GamesPage({ deckParam }: { deckParam: string | null }) {
  const [selected, setSelected] = useSelectedDeck();
  const decks = useLiveQuery((s) => s.deckSummaries(), []);
  const breakdown = useLiveQuery(async (s) => {
    const [sessions, answers] = await Promise.all([s.listSessions(), s.listAnswers()]);
    return new Map(computeGameBreakdown(sessions, answers, GAME_IDS).map((b) => [b.game, b]));
  }, []);

  // Aufruf über «Spielen» in einem Lernpaket: dieses Paket übernehmen
  useEffect(() => {
    if (deckParam) setSelected(deckParam);
  }, [deckParam, setSelected]);

  const playable = (decks ?? []).filter((d) => d.questionCount > 0);
  const current = playable.find((d) => d.deck.id === (deckParam ?? selected)) ?? null;

  return (
    <div className="page">
      <PageHeader title="Spiele" subtitle="Alle Spiele nutzen deine Lernpakete. Wähle ein Paket und danach ein Spiel." />

      {decks && playable.length === 0 ? (
        <EmptyState icon="decks" title="Noch keine spielbaren Lernpakete">
          <p className="muted">Importiere zuerst Fragen, dann kannst du sie in jedem Spiel üben.</p>
          <LinkButton to="/import" variant="primary" icon="import">
            Fragen importieren
          </LinkButton>
        </EmptyState>
      ) : (
        <section className="card deck-select">
          <label className="field">
            <span>Lernpaket für alle Spiele</span>
            <select
              value={current?.deck.id ?? ''}
              onChange={(e) => {
                setSelected(e.target.value || null);
                if (deckParam) navigate('/games', { replace: true });
              }}
              aria-label="Lernpaket für alle Spiele"
            >
              <option value="">Beim Spielstart wählen</option>
              {playable.map(({ deck, questionCount }) => (
                <option key={deck.id} value={deck.id}>
                  {deck.name} ({plural(questionCount, 'Frage', 'Fragen')})
                </option>
              ))}
            </select>
          </label>
        </section>
      )}

      <div className="game-grid">
        {GAMES.map((g) => {
          const b = breakdown?.get(g.id);
          return (
            <article key={g.id} className={`card game-card ${g.theme}`}>
              <div className="game-card-head">
                <img src={g.logo} alt={`${g.name} Logo`} width={72} height={72} />
                <div>
                  <h2>{g.name}</h2>
                  <p className="game-tagline">{g.tagline}</p>
                </div>
              </div>
              <p className="game-description">{g.description}</p>
              <dl className="game-facts">
                <div>
                  <dt>Highscore</dt>
                  <dd>{formatNumber(b?.highscore ?? 0)}</dd>
                </div>
                <div>
                  <dt>Runden</dt>
                  <dd>{formatNumber(b?.games ?? 0)}</dd>
                </div>
                <div>
                  <dt>Steuerung</dt>
                  <dd className="small">{g.controls}</dd>
                </div>
              </dl>
              <p className="game-deck-line">{current ? `Lernpaket: ${current.deck.name}` : 'Lernpaket wählst du beim Start.'}</p>
              <Button
                variant="primary"
                size="lg"
                icon="play"
                className="game-play"
                ariaLabel={current ? `${g.name} mit ${current.deck.name} spielen` : `${g.name} spielen`}
                onClick={() => navigate(gameRoute(g.id, { deckId: current?.deck.id ?? null }))}
              >
                {g.name} spielen
              </Button>
            </article>
          );
        })}
      </div>
      <p className="muted small games-note">
        <Icon name="info" size={14} /> Fortschritt, Highscores und Wiederholungsfragen sind für alle Spiele gemeinsam und werden mit deinem Konto
        synchronisiert.
      </p>
    </div>
  );
}
