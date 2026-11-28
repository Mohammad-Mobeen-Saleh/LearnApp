import { useEffect } from 'react';
import { useQueryOnce } from '../../app/ServicesContext.tsx';
import { sessionGameType } from '../../domain/stats.ts';
import { EmptyState, LinkButton } from '../../ui/components.tsx';
import { DeckPicker } from '../DeckPicker.tsx';
import { loadGameQuestions } from '../questions.ts';
import { gameRoute } from '../registry.ts';
import { setSelectedDeck } from '../selection.ts';
import { SnakeGame } from './SnakeGame.tsx';

/**
 * Snake (Route /games/snake): gemeinsame Lernpaket-Auswahl, danach Konfigurationsbildschirm
 * und Spiel. Fragen ohne drei gültige Antworten werden übersprungen, nie ergänzt.
 */
export default function SnakePage({ deckId, mode }: { deckId: string | null; mode: string | null }) {
  const repeat = mode === 'repeat';
  if (!deckId && !repeat) return <DeckPicker game="snake" />;
  return <SnakeLoader deckId={deckId} repeat={repeat} />;
}

function SnakeLoader({ deckId, repeat }: { deckId: string | null; repeat: boolean }) {
  const data = useQueryOnce(
    async (s) => {
      const [loaded, settings, sessions] = await Promise.all([
        loadGameQuestions(s, { deckId, repeat }, { requireThreeAnswers: true }),
        s.getSettings(),
        s.listSessions(),
      ]);
      const highscore = sessions.filter((x) => sessionGameType(x) === 'snake').reduce((m, x) => Math.max(m, x.score), 0);
      return { ...loaded, settings, highscore };
    },
    [deckId, repeat],
  );
  useEffect(() => {
    if (deckId && !repeat) setSelectedDeck(deckId);
  }, [deckId, repeat]);

  if (!data) return <div className="loading snake-loading">Snake wird vorbereitet …</div>;
  if (data.questions.length === 0) {
    return (
      <div className="snake-screen snake-empty">
        <EmptyState icon="play" title={repeat ? 'Nichts zu wiederholen' : 'Keine passenden Fragen'}>
          <p className="muted">
            {data.skipped > 0
              ? `${data.skipped} Fragen haben keine drei unterschiedlichen Antworten und können in Snake nicht gespielt werden.`
              : 'Dieses Lernpaket enthält keine Fragen.'}
          </p>
          <LinkButton to={gameRoute('snake')} variant="primary">
            Anderes Lernpaket wählen
          </LinkButton>
          <LinkButton to="/games">Zur Spieleübersicht</LinkButton>
        </EmptyState>
      </div>
    );
  }
  return (
    <SnakeGame
      key={`${deckId ?? 'repeat'}`}
      questions={data.questions}
      skipped={data.skipped}
      deckId={repeat ? null : deckId}
      mode={repeat ? 'repeat' : 'normal'}
      title={data.title}
      settings={data.settings}
      previousHighscore={data.highscore}
    />
  );
}
