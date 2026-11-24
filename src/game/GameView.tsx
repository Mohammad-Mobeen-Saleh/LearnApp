import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GameController, type GameQuestion, type GameSummary } from '../domain/game.ts';
import { DIFFICULTY_LABELS, type GameMode, type GameType, type Settings } from '../domain/types.ts';
import { formatNumber, formatPercent } from '../lib/text.ts';
import { Icon } from '../ui/Icon.tsx';
import { GameCanvas } from './GameCanvas.tsx';
import { PausePanel, ReadyPanel, ResultsPanel, ScorePop, useAutoPause, useGameRecorder } from './GameUi.tsx';
import { GameBridge, type SceneRound } from './MeteorScene.ts';
import { SoundFx } from './sfx.ts';

/**
 * Abwehrmodus (Multiple Choice) – kontinuierlich:
 * richtige Antwort → Meteorit explodiert → nächste Frage sofort, ohne Zwischenbildschirm.
 * Eine falsche Antwort (oder ein Einschlag) beendet das Spiel. Ist das Paket durchgespielt,
 * wird neu gemischt. Im Wiederholungsmodus wird jede Frage genau einmal gestellt.
 */

export interface GameViewProps {
  questions: GameQuestion[];
  deckId: string | null;
  mode: GameMode;
  title: string;
  settings: Settings;
  previousHighscore: number;
  onExit: () => void;
  onChangeType: (t: GameType) => void;
  onChangeMode: () => void;
  /** meldet den Endpunktestand (für den Highscore beim Moduswechsel) */
  onScore?: (t: GameType, score: number) => void;
}

type Overlay = 'ready' | 'none' | 'paused' | 'results';

function toSceneRound(round: NonNullable<GameController['current']>): SceneRound {
  return { answers: round.answers, durationMs: round.durationMs, roundNumber: round.number, kind: 'choice', fastAdvance: true };
}

export function GameView({ questions, deckId, mode, title, settings, previousHighscore, onExit, onChangeType, onChangeMode, onScore }: GameViewProps) {
  const sfx = useMemo(() => new SoundFx(), []);
  const recorder = useGameRecorder();
  const makeController = useCallback(
    (qs: GameQuestion[], m: GameMode) =>
      new GameController({
        questions: qs,
        mode: m,
        deckId: m === 'repeat' ? null : deckId,
        speed: settings.speed,
        lives: 1,
        endless: m !== 'repeat',
        repeatWrongInGame: false,
      }),
    [deckId, settings.speed],
  );
  const controllerRef = useRef<GameController>(null as unknown as GameController);
  if (!controllerRef.current) controllerRef.current = makeController(questions, mode);
  const [, setTick] = useState(0);
  const [overlay, setOverlay] = useState<Overlay>('ready');
  const [summary, setSummary] = useState<GameSummary | null>(null);
  const [highscore, setHighscore] = useState(previousHighscore);
  const [newRecord, setNewRecord] = useState(false);
  const [pop, setPop] = useState<{ id: number; value: number } | null>(null);
  const overlayRef = useRef<Overlay>('ready');
  overlayRef.current = overlay;
  const highscoreRef = useRef(highscore);
  highscoreRef.current = highscore;

  const game = controllerRef.current;
  const rerender = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    sfx.configure(settings.soundEnabled, settings.volume);
  }, [sfx, settings.soundEnabled, settings.volume]);

  useEffect(() => controllerRef.current.subscribe(rerender), [rerender, overlay]);

  const toSession = (s: GameSummary) => ({
    gameType: 'defense' as const,
    mode: s.mode,
    deckId: s.deckId,
    score: s.score,
    rounds: s.rounds,
    correctCount: s.correctCount,
    wrongCount: s.wrongCount,
    maxStreak: s.maxStreak,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
  });

  const finishGameRef = useRef<() => void>(() => undefined);

  const bridge = useMemo(
    () =>
      new GameBridge(
        {
          onShoot: (slot, elapsed) => {
            const result = controllerRef.current.answer(slot, elapsed);
            recorder.recordAnswer(result.question, result.outcome, result.points, result.responseMs);
            if (result.outcome === 'correct') setPop({ id: Date.now(), value: result.points });
            return { correct: result.outcome === 'correct', correctSlot: result.correctSlot };
          },
          onTimeout: (elapsed) => {
            const result = controllerRef.current.timeout(elapsed);
            recorder.recordAnswer(result.question, result.outcome, result.points, result.responseMs);
            return { correctSlot: result.correctSlot };
          },
          onResolved: () => {
            // Kein Zwischenbildschirm: richtige Antwort → sofort nächste Frage, sonst Ergebnis
            const round = controllerRef.current.next();
            if (round) bridge.startRound(toSceneRound(round));
            else finishGameRef.current();
          },
        },
        sfx,
        {
          pixelRatio: Math.min(window.devicePixelRatio || 1, 3),
          reduceMotion: settings.reduceMotion || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
          showKeyHints: window.matchMedia?.('(pointer: fine)').matches === true,
        },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const finishGame = useCallback(() => {
    const s = controllerRef.current.summary();
    recorder.recordSession(toSession(s));
    setSummary(s);
    setNewRecord(s.score > 0 && s.score > highscoreRef.current);
    if (s.score > highscoreRef.current) setHighscore(s.score);
    onScore?.('defense', s.score);
    setOverlay('results');
    bridge.clear();
    sfx.play(s.reason === 'completed' ? 'win' : 'gameover');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, recorder, sfx, onScore]);
  finishGameRef.current = finishGame;

  // Nur im Entwicklungsmodus: Zugriff für automatisierte Tests (wird im Produktionsbuild entfernt)
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __meteorDefense?: unknown };
    w.__meteorDefense = { bridge, controller: () => controllerRef.current };
    return () => {
      delete w.__meteorDefense;
    };
  }, [bridge]);

  const start = useCallback(() => {
    if (controllerRef.current.phase !== 'ready') return;
    sfx.unlock();
    const round = controllerRef.current.start();
    bridge.startRound(toSceneRound(round));
    setOverlay('none');
  }, [bridge, sfx]);

  const restart = useCallback(
    (qs: GameQuestion[], m: GameMode) => {
      bridge.resume();
      sfx.resume();
      bridge.clear();
      controllerRef.current = makeController(qs, m);
      recorder.reset();
      setSummary(null);
      setPop(null);
      sfx.unlock();
      const round = controllerRef.current.start();
      bridge.startRound(toSceneRound(round));
      setOverlay('none');
    },
    [bridge, makeController, recorder, sfx],
  );

  const pause = useCallback(() => {
    if (overlayRef.current !== 'none') return;
    bridge.pause();
    sfx.suspend();
    setOverlay('paused');
  }, [bridge, sfx]);

  const resume = useCallback(() => {
    sfx.resume();
    bridge.resume();
    setOverlay('none');
  }, [bridge, sfx]);

  const quit = useCallback(() => {
    const c = controllerRef.current;
    if (c.phase !== 'over' && c.answeredRounds > 0) {
      c.quit();
      recorder.recordSession(toSession(c.summary()));
    }
    onExit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onExit, recorder]);

  // Tastatur: 1/2/3 bzw. A/B/C schiessen, Esc/P Pause, Enter startet
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      const current = overlayRef.current;
      if (current === 'none') {
        const slot = ['1', '2', '3'].indexOf(key) >= 0 ? ['1', '2', '3'].indexOf(key) : ['a', 'b', 'c'].indexOf(key);
        if (slot >= 0) {
          e.preventDefault();
          sfx.unlock();
          bridge.shoot(slot);
        } else if (key === 'escape' || key === 'p') {
          e.preventDefault();
          pause();
        }
      } else if (current === 'paused' && (key === 'escape' || key === 'p' || key === ' ')) {
        e.preventDefault();
        resume();
      } else if (current === 'ready' && key === 'enter') {
        e.preventDefault();
        start();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bridge, pause, resume, sfx, start]);

  useAutoPause(pause);

  // Beim Verlassen der Seite ein begonnenes Spiel speichern
  useEffect(
    () => () => {
      const c = controllerRef.current;
      if (c.phase !== 'over' && c.answeredRounds > 0 && !recorder.isSaved()) {
        c.quit();
        recorder.recordSession(toSession(c.summary()));
      }
      sfx.close();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recorder, sfx],
  );

  const round = game.current;
  const last = game.lastResult;
  const question = round?.question ?? last?.question ?? null;
  const questionLength = question ? question.question.length : 0;
  const endReason =
    summary?.reason === 'completed'
      ? 'Alle Fragen der Wiederholung richtig beantwortet.'
      : last?.outcome === 'timeout'
        ? 'Die Meteoriten haben den Schutzschild erreicht.'
        : last?.outcome === 'wrong'
          ? 'Falscher Meteorit abgeschossen.'
          : null;

  return (
    <div className="game-screen">
      <header className="game-hud">
        <button type="button" className="hud-btn" onClick={pause} aria-label="Pause" disabled={overlay !== 'none'}>
          <Icon name="pause" />
        </button>
        <div className="hud-score" aria-live="polite">
          <span className="hud-label">Punkte</span>
          <strong>
            {formatNumber(game.score)}
            <ScorePop pop={pop} />
          </strong>
        </div>
        <div className="hud-round">
          <span className="hud-label">Frage</span>
          <strong>{game.isEndless ? Math.max(1, game.roundNumber) : `${game.roundNumber}/${game.totalRounds}`}</strong>
        </div>
        {game.streak >= 2 ? <div className="hud-streak">Serie ×{game.streak}</div> : null}
        <div className="hud-mode">Abwehrmodus</div>
      </header>

      <section className="game-question" aria-live="polite">
        {question ? (
          <>
            <div className="game-question-meta">
              <span>{title}</span>
              {question.category ? <span>· {question.category}</span> : null}
              <span>· {DIFFICULTY_LABELS[question.difficulty]}</span>
            </div>
            <h1 className={questionLength > 160 ? 'q-long' : questionLength > 80 ? 'q-medium' : undefined}>{question.question}</h1>
          </>
        ) : (
          <h1>{title}</h1>
        )}
      </section>

      <div className="game-stage">
        <GameCanvas bridge={bridge} />

        {overlay === 'ready' ? (
          <ReadyPanel gameType="defense" onChangeType={onChangeType} onStart={start} onExit={onExit} questionCount={questions.length} repeat={mode === 'repeat'} />
        ) : null}

        {overlay === 'paused' ? (
          <PausePanel score={game.score} round={game.roundNumber} onResume={resume} onRestart={() => restart(questions, mode)} onQuit={quit} />
        ) : null}

        {overlay === 'results' && summary ? (
          <ResultsPanel
            heading={summary.reason === 'completed' ? 'Geschafft – die Erde ist sicher!' : 'Game Over'}
            reasonText={endReason}
            decisive={summary.reason === 'completed' ? null : (last?.question ?? null)}
            score={summary.score}
            isNewHighscore={newRecord}
            highscore={highscore}
            gameType="defense"
            facts={[
              { label: 'Richtig', value: summary.correctCount },
              { label: 'Falsch', value: summary.wrongCount },
              { label: 'Quote', value: formatPercent(summary.accuracy) },
              { label: 'Beste Serie', value: summary.maxStreak },
            ]}
            wrongQuestions={summary.wrongQuestions}
            onRestart={() => restart(questions, mode)}
            onRepeatWrong={summary.wrongQuestions.length > 0 ? () => restart(summary.wrongQuestions, 'repeat') : null}
            onChangeMode={onChangeMode}
            onExit={onExit}
          />
        ) : null}
      </div>
    </div>
  );
}
