import { useState } from 'react';
import { useLiveQuery, useQueryOnce } from '../app/ServicesContext.tsx';
import { navigate } from '../app/router.ts';
import { computeStats, sessionGameType } from '../domain/stats.ts';
import type { GameMode, GameType, Settings } from '../domain/types.ts';
import { TypingGameView } from '../game/TypingGameView.tsx';
import type { GameQuestion } from '../domain/game.ts';
import { GameView } from '../game/GameView.tsx';
import { plural } from '../lib/text.ts';
import { EmptyState, LinkButton, PageHeader } from '../ui/components.tsx';
import { Icon } from '../ui/Icon.tsx';

/** Spielen: zuerst Lernpaket wählen, danach startet das Spiel im Vollbild. */
export default function PlayPage({ deckId, mode }: { deckId: string | null; mode: string | null }) {
  if (!deckId && mode !== 'repeat') return <DeckPicker />;
  return <GameLoader deckId={deckId} repeat={mode === 'repeat'} />;
}

function DeckPicker() {
  const decks = useLiveQuery((s) => s.deckSummaries(), []);
  const repeat = useLiveQuery(async (s) => {
    const [d, q, se, a] = await Promise.all([s.listDecks(), s.listAllQuestions(), s.listSessions(), s.listAnswers()]);
    return computeStats({ decks: d, questions: q, sessions: se, answers: a }).repeatQuestionIds.length;
  }, []);
  const playable = (decks ?? []).filter((d) => d.questionCount > 0);

  return (
    <div className="page">
      <PageHeader title="Spielen" subtitle="Wähle ein Lernpaket. Danach wählst du Abwehrmodus (drei Antwort-Meteoriten) oder Tippmodus (Antwort eintippen)." />
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
          <button type="button" className="card pick-card pick-repeat" onClick={() => navigate('/play?mode=repeat')}>
            <Icon name="repeat" size={28} />
            <strong>Fehlerhafte Fragen wiederholen</strong>
            <span className="muted">{plural(repeat, 'Frage', 'Fragen')} aus allen Paketen</span>
          </button>
        ) : null}
        {playable.map(({ deck, questionCount }) => (
          <button key={deck.id} type="button" className="card pick-card" onClick={() => navigate(`/play?deck=${deck.id}`)}>
            <Icon name="play" size={28} />
            <strong>{deck.name}</strong>
            <span className="muted">{plural(questionCount, 'Frage', 'Fragen')}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function GameLoader({ deckId, repeat }: { deckId: string | null; repeat: boolean }) {
  const data = useQueryOnce(
    async (s) => {
      const [decks, settings, sessions] = await Promise.all([s.listDecks(), s.getSettings(), s.listSessions()]);
      let questions: GameQuestion[];
      let title: string;
      if (repeat) {
        const [all, answers] = await Promise.all([s.listAllQuestions(), s.listAnswers()]);
        const ids = new Set(computeStats({ decks, questions: all, sessions, answers }).repeatQuestionIds);
        questions = all.filter((q) => ids.has(q.id));
        title = 'Wiederholung';
      } else {
        const deck = decks.find((d) => d.id === deckId);
        questions = deck ? await s.listQuestions(deck.id) : [];
        title = deck?.name ?? 'Lernpaket';
      }
      // Highscores getrennt nach Spielmodus
      const highscores: Record<GameType, number> = { defense: 0, typing: 0 };
      for (const x of sessions) {
        const t = sessionGameType(x);
        highscores[t] = Math.max(highscores[t], x.score);
      }
      return { questions, title, settings, highscores };
    },
    // Daten nur einmal pro Spielstart laden (Änderungen während des Spiels nicht nachladen)
    [deckId, repeat],
  );
  if (!data) return <div className="loading">Spiel wird vorbereitet …</div>;
  if (data.questions.length === 0) {
    return (
      <div className="page">
        <EmptyState icon="play" title={repeat ? 'Nichts zu wiederholen' : 'Keine Fragen in diesem Lernpaket'}>
          <LinkButton to="/play" variant="primary">
            Anderes Lernpaket wählen
          </LinkButton>
        </EmptyState>
      </div>
    );
  }
  return (
    <GameSession
      key={`${deckId ?? 'repeat'}`}
      questions={data.questions}
      title={data.title}
      deckId={repeat ? null : deckId}
      repeat={repeat}
      settings={data.settings}
      highscores={data.highscores}
    />
  );
}

const GAME_TYPE_KEY = 'meteor-defense:gameType';

function loadGameType(): GameType {
  try {
    return localStorage.getItem(GAME_TYPE_KEY) === 'typing' ? 'typing' : 'defense';
  } catch {
    return 'defense';
  }
}

/**
 * Hält die beim Start geladenen Daten fest (Synchronisierungen starten das Spiel nicht neu)
 * und wechselt zwischen Abwehr- und Tippmodus. Der zuletzt gewählte Modus wird gemerkt.
 */
function GameSession(props: {
  questions: GameQuestion[];
  title: string;
  deckId: string | null;
  repeat: boolean;
  settings: Settings;
  highscores: Record<GameType, number>;
}) {
  const [gameType, setGameType] = useState<GameType>(loadGameType);
  const [instance, setInstance] = useState(0);
  const [highscores, setHighscores] = useState(props.highscores);
  const changeType = (t: GameType) => {
    setGameType(t);
    try {
      localStorage.setItem(GAME_TYPE_KEY, t);
    } catch {
      /* privater Modus – nicht schlimm */
    }
  };
  const common = {
    questions: props.questions,
    deckId: props.deckId,
    mode: (props.repeat ? 'repeat' : 'normal') as GameMode,
    title: props.title,
    settings: props.settings,
    onExit: () => navigate('/', { replace: true }),
    onChangeType: changeType,
    // zurück zur Modusauswahl (neue Instanz im Startzustand)
    onChangeMode: () => setInstance((i) => i + 1),
    onScore: (t: GameType, score: number) => setHighscores((h) => ({ ...h, [t]: Math.max(h[t], score) })),
  };
  return gameType === 'typing' ? (
    <TypingGameView key={`t-${instance}`} {...common} previousHighscore={highscores.typing} />
  ) : (
    <GameView key={`d-${instance}`} {...common} previousHighscore={highscores.defense} />
  );
}
