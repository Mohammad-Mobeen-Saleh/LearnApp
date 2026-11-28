import type { ReactNode } from 'react';
import type { GameQuestion } from '../domain/game.ts';
import { acceptedSolutions } from '../domain/answerCheck.ts';
import { ANSWER_LETTERS, GAME_TYPE_LABELS, type MeteorMode } from '../domain/types.ts';
import { formatNumber, plural } from '../lib/text.ts';
import { Button } from '../ui/components.tsx';
import { Icon } from '../ui/Icon.tsx';
import { BidiText } from '../games/shared.tsx';

/** Bausteine von Meteor Defense (Abwehr- und Tippmodus). Gemeinsames aller Spiele: src/games/shared.tsx */
export { BidiText, useAutoPause, useGameRecorder, type SessionSummaryInput } from '../games/shared.tsx';

const MODE_TEXT: Record<MeteorMode, { title: string; text: ReactNode; keys: string }> = {
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
  gameType: MeteorMode;
  onChangeType: (t: MeteorMode) => void;
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
          {(['defense', 'typing'] as MeteorMode[]).map((t) => (
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
  gameType: MeteorMode;
  facts: ResultFact[];
  wrongQuestions: GameQuestion[];
  onRestart: () => void;
  onRepeatWrong: (() => void) | null;
  onChangeMode: () => void;
  onExit: () => void;
}) {
  const others = wrongQuestions.filter((q) => q.id !== decisive?.id);
  /** Richtige Lösung: Antwortbuchstabe getrennt vom (evtl. arabischen) Antworttext. */
  const solution = (q: GameQuestion) =>
    gameType === 'typing' ? (
      <BidiText text={acceptedSolutions(q).join(' / ')} />
    ) : (
      <>
        <span className="solution-letter">{ANSWER_LETTERS[q.correctIndex]}</span>
        <BidiText text={q.answers[q.correctIndex]} />
      </>
    );
  const explanationOf = (q: GameQuestion) => (q.explanation ?? '').trim();
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
            <p className="decisive-solution">
              <span className="muted">Richtige Antwort</span>
              <strong>{solution(decisive)}</strong>
            </p>
            {/* Erklärung nur, wenn beim Erstellen der Frage eine erfasst wurde */}
            {explanationOf(decisive) ? (
              <p className="decisive-explanation">
                <BidiText text={explanationOf(decisive)} />
              </p>
            ) : null}
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
                    Richtig: {solution(q)}
                  </span>
                  {explanationOf(q) ? (
                    <span className="muted small">
                      <BidiText text={explanationOf(q)} />
                    </span>
                  ) : null}
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
