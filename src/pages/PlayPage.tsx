import { useEffect, useState } from 'react';
import { useQueryOnce } from '../app/ServicesContext.tsx';
import { navigate } from '../app/router.ts';
import { sessionGameType } from '../domain/stats.ts';
import type { GameMode, MeteorMode, Settings } from '../domain/types.ts';
import type { GameQuestion } from '../domain/game.ts';
import { GameView } from '../game/GameView.tsx';
import { TypingGameView } from '../game/TypingGameView.tsx';
import { DeckPicker } from '../games/DeckPicker.tsx';
import { loadGameQuestions } from '../games/questions.ts';
import { gameRoute } from '../games/registry.ts';
import { setSelectedDeck } from '../games/selection.ts';
import { EmptyState, LinkButton } from '../ui/components.tsx';

/**
 * Meteor Defense (Route /games/meteor-defense): zuerst Lernpaket wählen (gemeinsame Auswahl),
 * danach startet das Spiel im Vollbild. Spielansichten und Mechanik sind unverändert.
 */
export default function PlayPage({ deckId, mode }: { deckId: string | null; mode: string | null }) {
  if (!deckId && mode !== 'repeat') return <DeckPicker game="meteor-defense" />;
  return <GameLoader deckId={deckId} repeat={mode === 'repeat'} />;
}

function GameLoader({ deckId, repeat }: { deckId: string | null; repeat: boolean }) {
  const data = useQueryOnce(
    async (s) => {
      const [loaded, settings, sessions] = await Promise.all([loadGameQuestions(s, { deckId, repeat }), s.getSettings(), s.listSessions()]);
      // Highscores getrennt nach Spielmodus
      const highscores: Record<MeteorMode, number> = { defense: 0, typing: 0 };
      for (const x of sessions) {
        const t = sessionGameType(x);
        if (t === 'defense' || t === 'typing') highscores[t] = Math.max(highscores[t], x.score);
      }
      return { questions: loaded.questions, title: loaded.title, settings, highscores };
    },
    // Daten nur einmal pro Spielstart laden (Änderungen während des Spiels nicht nachladen)
    [deckId, repeat],
  );
  useEffect(() => {
    if (deckId && !repeat) setSelectedDeck(deckId);
  }, [deckId, repeat]);
  if (!data) return <div className="loading">Spiel wird vorbereitet …</div>;
  if (data.questions.length === 0) {
    return (
      <div className="page">
        <EmptyState icon="play" title={repeat ? 'Nichts zu wiederholen' : 'Keine Fragen in diesem Lernpaket'}>
          <LinkButton to={gameRoute('meteor-defense')} variant="primary">
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

function loadGameType(): MeteorMode {
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
  highscores: Record<MeteorMode, number>;
}) {
  const [gameType, setGameType] = useState<MeteorMode>(loadGameType);
  const [instance, setInstance] = useState(0);
  const [highscores, setHighscores] = useState(props.highscores);
  const changeType = (t: MeteorMode) => {
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
    onScore: (t: MeteorMode, score: number) => setHighscores((h) => ({ ...h, [t]: Math.max(h[t], score) })),
  };
  return gameType === 'typing' ? (
    <TypingGameView key={`t-${instance}`} {...common} previousHighscore={highscores.typing} />
  ) : (
    <GameView key={`d-${instance}`} {...common} previousHighscore={highscores.defense} />
  );
}
