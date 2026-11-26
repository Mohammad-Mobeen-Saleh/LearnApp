import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameQuestion } from '../domain/game.ts';
import { TypingController, type TypingSummary } from '../domain/typing.ts';
import { isTypedAnswerCorrect } from '../domain/answerCheck.ts';
import { DIFFICULTY_LABELS, type GameMode, type GameType, type Settings } from '../domain/types.ts';
import { formatNumber, formatPercent } from '../lib/text.ts';
import { Icon } from '../ui/Icon.tsx';
import { GameCanvas } from './GameCanvas.tsx';
import { BidiText, PausePanel, ReadyPanel, ResultsPanel, ScorePop, useAutoPause, useGameRecorder } from './GameUi.tsx';
import { GameBridge, type SceneRound } from './MeteorScene.ts';
import { SoundFx } from './sfx.ts';

/**
 * Tippmodus: Ein Meteorit fällt, der Spieler tippt die Antwort ein und schickt sie mit Enter
 * (Windows) bzw. der Bestätigungstaste der Bildschirmtastatur (iPhone) ab. Eine vollständig
 * richtig eingetippte Antwort wird schon beim Tippen als Treffer erkannt.
 * Richtig → Abschuss, Punkte, nächster Meteorit sofort. Falsch → −10 Punkte, Meteorit fällt weiter.
 * Einschlag im Schutzschild → Game Over.
 */

export interface TypingGameViewProps {
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
type Feedback = { id: number; tone: 'wrong' | 'correct'; text: string } | null;

function toSceneRound(round: NonNullable<TypingController['current']>): SceneRound {
  return { answers: [], durationMs: round.durationMs, roundNumber: round.number, kind: 'typing' };
}

/**
 * iPhone: Die Bildschirmtastatur verkleinert nur den sichtbaren Bereich (visualViewport).
 * Das Spiel wird auf diesen Bereich begrenzt, damit Eingabefeld und Meteorit sichtbar bleiben.
 */
function useVisualViewportBox(ref: { current: HTMLElement | null }) {
  useEffect(() => {
    const vv = window.visualViewport;
    const el = ref.current;
    if (!vv || !el) return;
    let frame = 0;
    const apply = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const keyboardOpen = window.innerHeight - vv.height > 80;
        if (keyboardOpen) {
          el.style.top = `${vv.offsetTop}px`;
          el.style.height = `${vv.height}px`;
          el.style.bottom = 'auto';
          el.classList.add('keyboard-open');
        } else {
          el.style.top = '';
          el.style.height = '';
          el.style.bottom = '';
          el.classList.remove('keyboard-open');
        }
      });
    };
    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
    };
  }, [ref]);
}

export function TypingGameView({ questions, deckId, mode, title, settings, previousHighscore, onExit, onChangeType, onChangeMode, onScore }: TypingGameViewProps) {
  const sfx = useMemo(() => new SoundFx(), []);
  const recorder = useGameRecorder();
  const makeController = useCallback(
    (qs: GameQuestion[], m: GameMode) =>
      new TypingController({ questions: qs, mode: m, deckId: m === 'repeat' ? null : deckId, speed: settings.speed, endless: m !== 'repeat' }),
    [deckId, settings.speed],
  );
  const controllerRef = useRef<TypingController>(null as unknown as TypingController);
  if (!controllerRef.current) controllerRef.current = makeController(questions, mode);
  const [, setTick] = useState(0);
  const [overlay, setOverlay] = useState<Overlay>('ready');
  const [summary, setSummary] = useState<TypingSummary | null>(null);
  const [highscore, setHighscore] = useState(previousHighscore);
  const [newRecord, setNewRecord] = useState(false);
  const [pop, setPop] = useState<{ id: number; value: number } | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const overlayRef = useRef<Overlay>('ready');
  overlayRef.current = overlay;
  const highscoreRef = useRef(highscore);
  highscoreRef.current = highscore;
  const inputRef = useRef<HTMLInputElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const game = controllerRef.current;
  const rerender = useCallback(() => setTick((t) => t + 1), []);
  useVisualViewportBox(screenRef);

  useEffect(() => {
    sfx.configure(settings.soundEnabled, settings.volume);
  }, [sfx, settings.soundEnabled, settings.volume]);

  useEffect(() => controllerRef.current.subscribe(rerender), [rerender, overlay]);

  const toSession = (s: TypingSummary) => ({
    gameType: 'typing' as const,
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

  const focusInput = useCallback(() => {
    const el = inputRef.current;
    if (el && document.activeElement !== el) el.focus({ preventScroll: true });
  }, []);

  const showFeedback = useCallback((tone: 'wrong' | 'correct', text: string) => {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    setFeedback({ id: Date.now(), tone, text });
    feedbackTimer.current = setTimeout(() => setFeedback(null), tone === 'wrong' ? 1400 : 900);
  }, []);

  const finishGameRef = useRef<() => void>(() => undefined);

  const bridge = useMemo(
    () =>
      new GameBridge(
        {
          onShoot: () => ({ correct: false, correctSlot: 1 }),
          onTimeout: () => {
            const q = controllerRef.current.impact();
            if (q) recorder.recordAnswer(q, 'timeout', 0, controllerRef.current.current?.durationMs ?? 0);
            return { correctSlot: 1 };
          },
          onResolved: () => {
            const round = controllerRef.current.next();
            if (round) bridge.startRound(toSceneRound(round));
            else finishGameRef.current();
          },
        },
        sfx,
        {
          pixelRatio: Math.min(window.devicePixelRatio || 1, 3),
          reduceMotion: settings.reduceMotion || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
          showKeyHints: false,
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
    onScore?.('typing', s.score);
    setOverlay('results');
    setFeedback(null);
    bridge.clear();
    inputRef.current?.blur();
    sfx.play(s.reason === 'completed' || s.reason === 'quit' ? 'win' : 'gameover');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, recorder, sfx, onScore]);
  finishGameRef.current = finishGame;

  /**
   * Eingabe prüfen. Wird durch ausdrückliches Abschicken (Enter / Bestätigungstaste) ausgelöst –
   * oder automatisch, sobald die Eingabe eine richtige Lösung ist (dann nie mit Punktabzug).
   * Gelesen und geleert wird direkt im Eingabefeld, damit eine Eingabe nie doppelt verarbeitet wird.
   */
  const submit = useCallback(
    (raw?: string) => {
      const el = inputRef.current;
      const value = raw ?? el?.value ?? '';
      if (overlayRef.current !== 'none') return;
      const c = controllerRef.current;
      const result = c.submit(value, bridge.elapsed());
      if (result.kind === 'ignored') return;
      if (el) el.value = '';
      if (result.kind === 'wrong') {
        bridge.typingMiss();
        // Schüttel-Animation neu starten, ohne das Eingabefeld neu zu erzeugen (Fokus bleibt erhalten)
        if (el) {
          el.classList.remove('shake');
          void el.offsetWidth;
          el.classList.add('shake');
        }
        if (result.penalty > 0) setPop({ id: Date.now(), value: -result.penalty });
        showFeedback('wrong', result.penalty > 0 ? `Falsch – −${result.penalty} Punkte. Versuch es nochmal!` : 'Falsch – versuch es nochmal!');
      } else {
        const q = c.current!.question;
        recorder.recordAnswer(q, result.firstTry ? 'correct' : 'wrong', result.points, result.responseMs);
        setPop({ id: Date.now(), value: result.points });
        showFeedback('correct', `Treffer! +${result.points}`);
        bridge.typingHit();
      }
      focusInput();
    },
    [bridge, focusInput, recorder, showFeedback],
  );

  /**
   * Automatische Treffererkennung beim Tippen: nur wenn die Eingabe exakt einer gültigen Lösung
   * entspricht. Falsche Zwischenstände werden nie gewertet – Punkte werden ausschliesslich beim
   * ausdrücklichen Abschicken abgezogen.
   */
  const checkWhileTyping = useCallback(
    (value: string, composing: boolean) => {
      if (composing || overlayRef.current !== 'none') return;
      const c = controllerRef.current;
      if (c.phase !== 'playing' || !c.current) return;
      if (isTypedAnswerCorrect(value, c.current.question)) submit(value);
    },
    [submit],
  );

  // Nur im Entwicklungsmodus: Zugriff für automatisierte Tests (wird im Produktionsbuild entfernt)
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __meteorDefense?: unknown };
    w.__meteorDefense = { bridge, controller: () => controllerRef.current, submit };
    return () => {
      delete w.__meteorDefense;
    };
  }, [bridge, submit]);

  const start = useCallback(() => {
    if (controllerRef.current.phase !== 'ready') return;
    sfx.unlock();
    // Fokus noch innerhalb des Klicks setzen, damit iOS die Tastatur öffnet
    focusInput();
    const round = controllerRef.current.start();
    bridge.startRound(toSceneRound(round));
    setOverlay('none');
  }, [bridge, focusInput, sfx]);

  const restart = useCallback(
    (qs: GameQuestion[], m: GameMode) => {
      bridge.resume();
      sfx.resume();
      bridge.clear();
      controllerRef.current = makeController(qs, m);
      recorder.reset();
      setSummary(null);
      setPop(null);
      setFeedback(null);
      if (inputRef.current) inputRef.current.value = '';
      sfx.unlock();
      focusInput();
      const round = controllerRef.current.start();
      bridge.startRound(toSceneRound(round));
      setOverlay('none');
    },
    [bridge, focusInput, makeController, recorder, sfx],
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
    focusInput();
  }, [bridge, focusInput, sfx]);

  const quit = useCallback(() => {
    const c = controllerRef.current;
    if (c.phase !== 'over' && c.answeredRounds > 0) {
      c.quit();
      if (settings.speed === 'still') {
        // Stillstand hat kein Zeitlimit: Beenden zeigt das Ergebnis statt direkt zum Dashboard zu wechseln
        sfx.resume();
        bridge.resume();
        finishGameRef.current();
        return;
      }
      recorder.recordSession(toSession(c.summary()));
    }
    onExit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onExit, recorder, settings.speed, bridge, sfx]);

  // Tastatur: Esc pausiert/setzt fort (auch während im Eingabefeld getippt wird), Enter startet
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const current = overlayRef.current;
      if (e.key === 'Escape') {
        if (current === 'none') {
          e.preventDefault();
          pause();
        } else if (current === 'paused') {
          e.preventDefault();
          resume();
        }
      } else if (e.key === 'Enter' && current === 'ready' && !e.repeat) {
        e.preventDefault();
        start();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pause, resume, start]);

  useAutoPause(pause);

  useEffect(
    () => () => {
      const c = controllerRef.current;
      if (c.phase !== 'over' && c.answeredRounds > 0 && !recorder.isSaved()) {
        c.quit();
        recorder.recordSession(toSession(c.summary()));
      }
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
      sfx.close();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recorder, sfx],
  );

  const round = game.current;
  const question = round?.question ?? summary?.missedQuestion ?? null;
  const questionLength = question ? question.question.length : 0;
  const playing = overlay === 'none';

  return (
    <div className="game-screen game-typing" ref={screenRef}>
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
          <strong>{game.isEndless ? Math.max(1, game.roundNumber) : `${game.roundNumber}/${questions.length}`}</strong>
        </div>
        {game.streak >= 2 ? <div className="hud-streak">Serie ×{game.streak}</div> : null}
        <div className="hud-mode">Tippmodus</div>
      </header>

      <section className="game-question" aria-live="polite">
        {question ? (
          <>
            <div className="game-question-meta">
              <span>{title}</span>
              {question.category ? <span>· {question.category}</span> : null}
              <span>· {DIFFICULTY_LABELS[question.difficulty]}</span>
            </div>
            <h1 className={questionLength > 160 ? 'q-long' : questionLength > 80 ? 'q-medium' : undefined}>
              <BidiText text={question.question} />
            </h1>
          </>
        ) : (
          <h1>{title}</h1>
        )}
      </section>

      <div
        className="game-stage"
        // Antippen des Spielfelds darf dem Eingabefeld den Fokus nicht nehmen (iPhone-Tastatur bleibt offen)
        onMouseDown={(e) => {
          if (playing) e.preventDefault();
        }}
        onClick={() => playing && focusInput()}
      >
        <GameCanvas bridge={bridge} />

        {overlay === 'ready' ? (
          <ReadyPanel gameType="typing" onChangeType={onChangeType} onStart={start} onExit={onExit} questionCount={questions.length} repeat={mode === 'repeat'} unlimited={settings.speed === 'still'} />
        ) : null}

        {overlay === 'paused' ? (
          <PausePanel score={game.score} round={game.roundNumber} onResume={resume} onRestart={() => restart(questions, mode)} onQuit={quit} />
        ) : null}

        {overlay === 'results' && summary ? (
          <ResultsPanel
            heading={summary.reason === 'completed' ? 'Geschafft – die Erde ist sicher!' : summary.reason === 'quit' ? 'Runde beendet' : 'Game Over'}
            reasonText={summary.reason === 'impact' ? 'Der Meteorit hat den Schutzschild erreicht.' : summary.reason === 'completed' ? 'Alle Fragen der Wiederholung gelöst.' : null}
            decisive={summary.missedQuestion}
            score={summary.score}
            isNewHighscore={newRecord}
            highscore={highscore}
            gameType="typing"
            facts={[
              { label: 'Zerstört', value: summary.correctCount },
              { label: 'Fehleingaben', value: summary.wrongCount },
              { label: 'Trefferquote', value: formatPercent(summary.accuracy) },
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

      <form
        className={overlay === 'results' ? 'typing-bar hidden' : 'typing-bar'}
        // Rückfall, falls ein Browser das Abschicken nicht als Enter-Taste meldet
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        autoComplete="off"
      >
        <div className="typing-row">
          <input
            ref={inputRef}
            className="typing-input"
            type="text"
            name="answer"
            dir="auto"
            aria-label="Deine Antwort"
            placeholder={playing ? 'Antwort eintippen …' : 'Antwort'}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="send"
            maxLength={500}
            disabled={overlay === 'results'}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              // Formular nicht zusätzlich abschicken (keine Doppelverarbeitung, iPhone-Tastatur bleibt offen)
              e.preventDefault();
              // gedrückt gehaltene Taste oder Wortbildung (IME) nicht als Antwort werten
              if (e.repeat || e.nativeEvent.isComposing) return;
              submit();
            }}
            onChange={(e) => checkWhileTyping(e.target.value, (e.nativeEvent as InputEvent).isComposing === true)}
            onCompositionEnd={() => checkWhileTyping(inputRef.current?.value ?? '', false)}
          />
        </div>
        <p className={feedback ? `typing-feedback ${feedback.tone}` : 'typing-feedback'} role="status" aria-live="polite">
          {feedback?.text ?? '\u00a0'}
        </p>
      </form>
    </div>
  );
}
