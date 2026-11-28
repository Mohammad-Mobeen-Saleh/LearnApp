import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useServices } from '../app/ServicesContext.tsx';
import type { GameQuestion } from '../domain/game.ts';
import type { AnswerOutcome, GameMode, GameType } from '../domain/types.ts';
import { splitBidiSegments } from '../lib/bidi.ts';
import { uuid } from '../lib/uuid.ts';

/**
 * Bausteine, die alle Spiele der LernArcade gemeinsam nutzen:
 * Speichern von Spielrunden und Antworten (gemeinsame Fortschritts- und Statistikbasis),
 * automatische Pause und die Darstellung gemischter arabisch/lateinischer Texte.
 */

/**
 * Text mit gemischten Schriften (z. B. «حَدِيقَة (ḥadīqa)»): jeder arabische und lateinische
 * Abschnitt bekommt eine eigene, isolierte Schreibrichtung. Reine lateinische Texte bleiben unverändert.
 */
export function BidiText({ text }: { text: string }) {
  const segments = splitBidiSegments(text);
  if (!segments.some((seg) => seg.dir === 'rtl')) return <>{text}</>;
  // Normaler Fliesstext mit isolierten Abschnitten (kein Flex-Layout: das hat Wörter in
  // schmalen Containern Buchstabe für Buchstabe umbrochen)
  return (
    <span className="bidi-text">
      {segments.map((seg, i) => (
        <span key={i}>
          {i > 0 ? ' ' : null}
          <span dir={seg.dir} lang={seg.dir === 'rtl' ? 'ar' : undefined} className={seg.dir === 'rtl' ? 'seg seg-rtl' : 'seg seg-ltr'}>
            {seg.text}
          </span>
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

