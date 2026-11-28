import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useServices } from '../app/ServicesContext.tsx';
import type { GameQuestion } from '../domain/game.ts';
import { acceptedSolutions } from '../domain/answerCheck.ts';
import { ANSWER_LETTERS, GAME_TYPE_LABELS, type AnswerOutcome, type GameMode, type GameType } from '../domain/types.ts';
import { uuid } from '../lib/uuid.ts';
import { formatNumber, plural } from '../lib/text.ts';
import { splitBidiSegments } from '../lib/bidi.ts';
import { Button } from '../ui/components.tsx';
import { Icon } from '../ui/Icon.tsx';

/** Gemeinsame Bausteine von Abwehr- und Tippmodus. */

/**
 * Text mit gemischten Schriften (z. B. «حَدِيقَة (ḥadīqa)»): jeder arabische und lateinische
 * Abschnitt bekommt eine eigene, isolierte Schreibrichtung. Reine lateinische Texte bleiben unverändert.
 */
export function BidiText({ text }: { text: string }) {
  const segments = splitBidiSegments(text);
  if (!segments.some((seg) => seg.dir === 'rtl')) return <>{text}</>;
  return (
    <span className="bidi-text" dir={segments.length === 1 ? 'rtl' : 'ltr'}>
      {segments.map((seg, i) => (
        <span key={i} dir={seg.dir} lang={seg.dir === 'rtl' ? 'ar' : undefined} className={seg.dir === 'rtl' ? 'seg seg-rtl' : 'seg seg-ltr'}>
          {seg.text}
        </span>
      ))}
    </span>
  );
}

export interface SessionSummaryInput {
  gameType: GameType;
  mode: GameMode;
  deckId: string | null;
  score: number;
  rounds: number;
  correctCount: number;
  wrongCount: number;
  maxStreak: number;
  startedAt: string;
  endedAt: string;
}

/** Speichert Antworten und Spiele als unveränderliche Ereignisse (synchronisierbar). */
export function useGameRecorder() {
  const { store } = useServices();
  const sessionRef = useRef({ id: uuid(), saved: false });

  const recordAnswer = useCallback(
    (q: GameQuestion, outcome: AnswerOutcome, points: number, responseMs: number) => {
      void store
        .recordAnswer({
          sessionId: sessionRef.current.id,
          deckId: q.deckId,
          questionId: q.id,
          outcome,
          points,
          responseMs,
          answeredAt: new Date().toISOString(),
        })
        .catch((err) => console.error('Antwort konnte nicht gespeichert werden', err));
    },
    [store],
  );

  const recordSession = useCallback(
    (s: SessionSummaryInput) => {
      if (sessionRef.current.saved || s.rounds === 0) return;
      sessionRef.current.saved = true;
      void store
        .recordSession({ id: sessionRef.current.id, ...s })
        .catch((err) => console.error('Spiel konnte nicht gespeichert werden', err));
    },
    [store],
  );

  const reset = useCallback(() => {
    sessionRef.current = { id: uuid(), saved: false };
  }, []);

  const isSaved = useCallback(() => sessionRef.current.saved, []);

  // stabile Objektidentität, damit Effekte mit dieser Abhängigkeit nicht bei jedem Rendern neu laufen
  return useMemo(() => ({ recordAnswer, recordSession, reset, isSaved }), [recordAnswer, recordSession, reset, isSaved]);
}

/** Pausiert automatisch, wenn die App in den Hintergrund geht (Tab-Wechsel, iPhone-Home-Bildschirm). */
export function useAutoPause(pause: () => void) {
  const ref = useRef(pause);
  ref.current = pause;
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') ref.current();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onVisibility);
    };
  }, []);
}

const MODE_TEXT: Record<GameType, { title: string; text: ReactNode; keys: string }> = {
  defense: {
    title: 'Abwehrmodus',
    text: (
      <>
        Drei Meteoriten tragen je eine Antwort. <strong>Schiesse den Meteoriten mit der richtigen Antwort ab</strong>. Die nächste Frage
        folgt sofort. Eine falsche Antwort oder ein Einschlag beendet das Spiel.
      </>
    ),
    keys: 'Tastatur: 1, 2, 3 zum Schiessen, Esc für Pause',
  },
  typing: {
    title: 'Tippmodus',
    text: (
      <>
        Ein Meteorit fällt Richtung Erde. <strong>Tippe die richtige Antwort ein</strong> und schicke sie mit Enter bzw. der
        Senden-Taste der Bildschirmtastatur ab. Eine vollständig richtige Antwort wird sofort erkannt. Falsche Eingabe: −10
        Punkte, der Meteorit fällt weiter. Erreicht er den Schutzschild, ist das Spiel vorbei.
      </>
    ),
    keys: 'Enter zum Abschicken, Esc für Pause',
  },
};

export function ReadyPanel({
  gameType,
  onChangeType,
  onStart,
  onExit,
  questionCount,
  repeat,
  unlimited = false,
}: {
  gameType: GameType;
  onChangeType: (t: GameType) => void;
  onStart: () => void;
  onExit: () => void;
  questionCount: number;
  repeat: boolean;
  /** Geschwindigkeit «Stillstand» */
  unlimited?: boolean;
}) {
  const info = MODE_TEXT[gameType];
  return (
    <div className="game-overlay">
      <div className="overlay-card card ready-card">
        <h2>Spielmodus wählen</h2>
        <div className="segmented mode-switch" role="radiogroup" aria-label="Spielmodus">
          {(['defense', 'typing'] as GameType[]).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={gameType === t}
              className={gameType === t ? 'active' : undefined}
              onClick={() => gameType !== t && onChangeType(t)}
            >
              <Icon name={t === 'defense' ? 'play' : 'edit'} size={18} />
              <span>{GAME_TYPE_LABELS[t]}</span>
            </button>
          ))}
        </div>
        <p className="mode-text">{info.text}</p>
        {unlimited ? (
          <p className="info-text small still-hint">
            <strong>Stillstand:</strong> Die Meteoriten bleiben stehen, du hast unbegrenzt Zeit. Es gibt keinen Tempobonus. Beenden über
            Pause → «Spiel beenden» zeigt dein Ergebnis.
          </p>
        ) : null}
        <p className="muted small">
          {repeat ? `Wiederholung: ${plural(questionCount, 'Frage', 'Fragen')}` : `${plural(questionCount, 'Frage', 'Fragen')}, endlos, wird automatisch neu gemischt`} ·{' '}
          {info.keys}
        </p>
        <div className="row center">
          <Button variant="primary" size="lg" icon="play" onClick={onStart}>
            Start
          </Button>
          <Button variant="ghost" onClick={onExit}>
            Zurück
          </Button>
        </div>
      </div>
    </div>
  );
}

export function PausePanel({ score, round, onResume, onRestart, onQuit }: {
  score: number;
  round: number;
  onResume: () => void;
  onRestart: () => void;
  onQuit: () => void;
}) {
  return (
    <div className="game-overlay">
      <div className="overlay-card card">
        <h2>Pause</h2>
        <p className="muted">
          {formatNumber(score)} Punkte · Frage {round}
        </p>
        <div className="stack">
          <Button variant="primary" size="lg" icon="play" onClick={onResume}>
            Weiterspielen
          </Button>
          <Button icon="repeat" onClick={onRestart}>
            Neu starten
          </Button>
          <Button variant="ghost" icon="logout" onClick={onQuit}>
            Spiel beenden
          </Button>
        </div>
      </div>
    </div>
  );
}

export interface ResultFact {
  label: string;
  value: ReactNode;
}

export function ResultsPanel({
  heading,
  reasonText,
  decisive,
  score,
  isNewHighscore,
  highscore,
  gameType,
  facts,
  wrongQuestions,
  onRestart,
  onRepeatWrong,
  onChangeMode,
  onExit,
}: {
  heading: string;
  reasonText: string | null;
  /** Frage, an der das Spiel endete – mit richtiger Lösung */
  decisive: GameQuestion | null;
  score: number;
  isNewHighscore: boolean;
  highscore: number;
  gameType: GameType;
  facts: ResultFact[];
  wrongQuestions: GameQuestion[];
  onRestart: () => void;
  onRepeatWrong: (() => void) | null;
  onChangeMode: () => void;
  onExit: () => void;
}) {
  const others = wrongQuestions.filter((q) => q.id !== decisive?.id);
  const solutionText = (q: GameQuestion) =>
    gameType === 'typing'
      ? acceptedSolutions(q).join(' / ')
      : `${ANSWER_LETTERS[q.correctIndex]}) ${q.answers[q.correctIndex]}`;
  return (
    <div className="game-overlay">
      <div className="overlay-card card results">
        <h2>{heading}</h2>
        {reasonText ? <p className="muted small result-reason">{reasonText}</p> : null}
        <div className="result-score">{formatNumber(score)}</div>
        <p className={isNewHighscore ? 'highscore new' : 'highscore'}>
          {isNewHighscore ? `Neuer Highscore im ${GAME_TYPE_LABELS[gameType]}!` : `Highscore ${GAME_TYPE_LABELS[gameType]}: ${formatNumber(Math.max(highscore, score))}`}
        </p>
        <dl className="result-facts">
          {facts.map((f) => (
            <div key={f.label}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
        {decisive ? (
          <div className="decisive">
            <strong>
              <BidiText text={decisive.question} />
            </strong>
            <span>
              Richtig wäre:{' '}
              <strong>
                <BidiText text={solutionText(decisive)} />
              </strong>
            </span>
            {decisive.explanation ? <span className="muted small">{decisive.explanation}</span> : null}
          </div>
        ) : null}
        <div className="stack">
          <Button variant="primary" size="lg" icon="play" onClick={onRestart}>
            Nochmal spielen
          </Button>
          {onRepeatWrong ? (
            <Button icon="repeat" onClick={onRepeatWrong}>
              Fehlerhafte Fragen wiederholen
            </Button>
          ) : null}
          <Button icon="settings" onClick={onChangeMode}>
            Spielmodus wechseln
          </Button>
          <Button variant="ghost" icon="home" onClick={onExit}>
            Zum Dashboard
          </Button>
        </div>
        {others.length > 0 ? (
          <details className="wrong-list" open={others.length <= 3}>
            <summary>{plural(others.length, 'weitere Frage', 'weitere Fragen')} zum Wiederholen</summary>
            <ul>
              {others.map((q) => (
                <li key={q.id}>
                  <strong>
                    <BidiText text={q.question} />
                  </strong>
                  <span>
                    Richtig: <BidiText text={solutionText(q)} />
                  </span>
                  {q.explanation ? <span className="muted small">{q.explanation}</span> : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </div>
  );
}

/** Kurz eingeblendete Punkteänderung neben dem Punktestand. */
export function ScorePop({ pop }: { pop: { id: number; value: number } | null }) {
  if (!pop) return null;
  return (
    <span key={pop.id} className={pop.value >= 0 ? 'score-pop plus' : 'score-pop minus'} aria-hidden="true">
      {pop.value >= 0 ? `+${pop.value}` : `−${Math.abs(pop.value)}`}
    </span>
  );
}
