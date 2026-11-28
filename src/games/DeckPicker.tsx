import { useLiveQuery } from '../app/ServicesContext.tsx';
import { navigate } from '../app/router.ts';
import { computeStats } from '../domain/stats.ts';
import type { GameId } from '../domain/types.ts';
import { plural } from '../lib/text.ts';
import { EmptyState, LinkButton, PageHeader } from '../ui/components.tsx';
import { Icon } from '../ui/Icon.tsx';
import { GAMES, gameRoute, getGame } from './registry.ts';
import { useSelectedDeck } from './selection.ts';

/**
 * Gemeinsame Lernpaket-Auswahl vor dem Spielstart (für alle Spiele gleich).
 * Das zuletzt gewählte Paket ist markiert und bleibt beim Spielwechsel erhalten.
 */
export function DeckPicker({ game }: { game: GameId }) {
  const def = getGame(game)!;
  const [selected, setSelected] = useSelectedDeck();
  const decks = useLiveQuery((s) => s.deckSummaries(), []);
  const repeat = useLiveQuery(async (s) => {
    const [d, q, se, a] = await Promise.all([s.listDecks(), s.listAllQuestions(), s.listSessions(), s.listAnswers()]);
    return computeStats({ decks: d, questions: q, sessions: se, answers: a }).repeatQuestionIds.length;
  }, []);
  const playable = (decks ?? []).filter((d) => d.questionCount > 0);
  const others = GAMES.filter((g) => g.id !== game);

  const start = (deckId: string) => {
    setSelected(deckId);
    navigate(gameRoute(game, { deckId }));
  };

  return (
    <div className="page">
      <PageHeader
        back="/games"
        title={def.name}
        subtitle={`Wähle ein Lernpaket. ${def.description}`}
        actions={others.map((g) => (
          <LinkButton key={g.id} to={gameRoute(g.id, { deckId: selected })} variant="ghost" icon="play">
            Zu {g.name}
          </LinkButton>
        ))}
      />
      {decks && playable.length === 0 ? (
        <EmptyState icon="decks" title="Keine spielbaren Lernpakete">
          <p className="muted">Importiere zuerst Fragen.</p>
          <LinkButton to="/import" variant="primary" icon="import">
            Fragen importieren
          </LinkButton>
        </EmptyState>
      ) : null}
      <div className="pick-grid">
        {repeat ? (
          <button type="button" className="card pick-card pick-repeat" onClick={() => navigate(gameRoute(game, { repeat: true }))}>
            <Icon name="repeat" size={28} />
            <strong>Fehlerhafte Fragen wiederholen</strong>
            <span className="muted">{plural(repeat, 'Frage', 'Fragen')} aus allen Paketen</span>
          </button>
        ) : null}
        {playable.map(({ deck, questionCount }) => (
          <button
            key={deck.id}
            type="button"
            className={deck.id === selected ? 'card pick-card selected' : 'card pick-card'}
            aria-current={deck.id === selected ? 'true' : undefined}
            onClick={() => start(deck.id)}
          >
            <Icon name="play" size={28} />
            <strong>{deck.name}</strong>
            <span className="muted">
              {plural(questionCount, 'Frage', 'Fragen')}
              {deck.id === selected ? ' · zuletzt gewählt' : ''}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
