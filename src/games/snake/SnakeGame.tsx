import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useServices } from '../../app/ServicesContext.tsx';
import { navigate } from '../../app/router.ts';
import type { GameQuestion } from '../../domain/game.ts';
import { SNAKE_STEP_MS, SnakeEngine, snakeGridSize, type Cell, type Direction, type SnakeSummary } from '../../domain/snake.ts';
import {
  ANSWER_LETTERS,
  DIFFICULTY_LABELS,
  SNAKE_MAP_LABELS,
  SNAKE_SPEED_LABELS,
  type GameMode,
  type Settings,
  type SnakeMapSize,
  type SnakeSpeed,
} from '../../domain/types.ts';
import { AnswerLabel } from '../../game/answerLabel.ts';
import { ScorePop } from '../../game/GameUi.tsx';
import { SoundFx } from '../../game/sfx.ts';
import { formatNumber, formatPercent, plural } from '../../lib/text.ts';
import { Icon } from '../../ui/Icon.tsx';
import { gameRoute } from '../registry.ts';
import { BidiText, useAutoPause, useGameRecorder } from '../shared.tsx';
import { FRUIT_STYLES, SnakeRenderer } from './renderer.ts';

/**
 * Snake: Steuere die Schlange zur Frucht mit der richtigen Antwort.
 * Eigenes Design (dunkelgrün, leuchtend grüne Schlange, türkise Akzente), eigene Steuerung:
 * Pfeiltasten/WASD, Wischen und ein Steuerkreuz auf Touch-Geräten.
 */

type Overlay = 'config' | 'none' | 'paused' | 'results';

interface Props {
  questions: GameQuestion[];
  skipped: number;
  deckId: string | null;
  mode: GameMode;
  title: string;
  settings: Settings;
  previousHighscore: number;
}

const KEY_DIRECTIONS: Record<string, Direction> = {
  arrowup: 'up',
  arrowdown: 'down',
  arrowleft: 'left',
  arrowright: 'right',
  w: 'up',
  s: 'down',
  a: 'left',
  d: 'right',
};

interface LabelRect {
  left: number;
  top: number;
  w: number;
  h: number;
  below?: boolean;
}

function overlaps(a: LabelRect, b: LabelRect, margin = 4): boolean {
  return a.left < b.left + b.w + margin && b.left < a.left + a.w + margin && a.top < b.top + b.h + margin && b.top < a.top + a.h + margin;
}

export function SnakeGame({ questions, skipped, deckId, mode, title, settings, previousHighscore }: Props) {
  const { store } = useServices();
  const recorder = useGameRecorder();
  const sfx = useMemo(() => new SoundFx(), []);
  const [mapSize, setMapSize] = useState<SnakeMapSize>(settings.snakeMapSize);
  const [speed, setSpeed] = useState<SnakeSpeed>(settings.snakeSpeed);
  const [overlay, setOverlay] = useState<Overlay>('config');
  const [summary, setSummary] = useState<SnakeSummary | null>(null);
  const [highscore, setHighscore] = useState(previousHighscore);
  const [newRecord, setNewRecord] = useState(false);
  const [pop, setPop] = useState<{ id: number; value: number } | null>(null);
  const [flash, setFlash] = useState<{ id: number; tone: 'good' | 'bad'; text: string } | null>(null);
  const [, setTick] = useState(0);
  const rerender = useCallback(() => setTick((t) => t + 1), []);

  const engineRef = useRef<SnakeEngine | null>(null);
  const rendererRef = useRef<SnakeRenderer | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const labelLayerRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<AnswerLabel[]>([]);
  const overlayRef = useRef<Overlay>('config');
  overlayRef.current = overlay;
  const loop = useRef({ raf: 0, lastStep: 0, lastFrame: 0, interval: SNAKE_STEP_MS.medium, questionStart: 0, bombSlot: null as number | null, dead: false, waiting: true });
  const [waiting, setWaiting] = useState(true);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const highscoreRef = useRef(highscore);
  highscoreRef.current = highscore;
  /** Frage, auf die sich die gerade liegenden Früchte beziehen */
  const lastQuestion = useRef<GameQuestion | null>(null);

  const reduceMotion = settings.reduceMotion || (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true);
  const touch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true;

  useEffect(() => {
    sfx.configure(settings.soundEnabled, settings.volume);
  }, [sfx, settings.soundEnabled, settings.volume]);

  // ------------------------------------------------------------------ Antwortbeschriftungen

  const clearLabels = useCallback(() => {
    for (const l of labelsRef.current) l.destroy();
    labelsRef.current = [];
  }, []);

  /** Beschriftung über (oder unter) der Frucht; berechnet für alle drei Früchte eine überlappungsfreie Lage. */
  const layoutLabels = useCallback((cells: Cell[]): LabelRect[] | null => {
    const r = rendererRef.current;
    const engine = engineRef.current;
    if (!r || !engine) return null;
    const { cell, width: W, height: H } = r;
    const rects: LabelRect[] = [];
    for (let i = 0; i < cells.length; i++) {
      const label = labelsRef.current[i];
      if (!label) return null;
      const w = label.width;
      const h = label.height;
      const cx = (cells[i].x + 0.5) * cell;
      let top = cells[i].y * cell - h - 5;
      let below = false;
      if (top < 2) {
        top = (cells[i].y + 1) * cell + 5;
        below = true;
      }
      if (top + h > H - 2) return null;
      const left = Math.min(Math.max(2, cx - w / 2), W - 2 - w);
      if (left < 0) return null;
      rects.push({ left, top, w, h, below });
    }
    const cellRect = (c: Cell): LabelRect => ({ left: c.x * cell, top: c.y * cell, w: cell, h: cell });
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) if (overlaps(rects[i], rects[j])) return null;
      // keine Beschriftung über einer anderen Frucht oder dem Schlangenkopf
      for (let j = 0; j < cells.length; j++) if (j !== i && overlaps(rects[i], cellRect(cells[j]), 0)) return null;
      if (overlaps(rects[i], cellRect(engine.head), cell * 0.5)) return null;
    }
    return rects;
  }, []);

  const applyLabelRects = useCallback((rects: LabelRect[]) => {
    rects.forEach((rect, i) => {
      const l = labelsRef.current[i];
      if (!l) return;
      l.setPosition(rect.left + rect.w / 2, rect.top);
      l.el.classList.toggle('below', !!rect.below);
    });
  }, []);

  /** Rückfall (z. B. nach Drehen des Geräts): Beschriftungen nahe der Frucht, aber immer innerhalb des Feldes. */
  const clampLabels = useCallback(() => {
    const engine = engineRef.current;
    const r = rendererRef.current;
    if (!engine || !r) return;
    engine.fruits.forEach((f, i) => {
      const l = labelsRef.current[i];
      if (!l) return;
      let top = f.cell.y * r.cell - l.height - 5;
      const below = top < 2;
      if (below) top = Math.min((f.cell.y + 1) * r.cell + 5, r.height - l.height - 2);
      const cx = Math.min(Math.max(l.width / 2 + 2, (f.cell.x + 0.5) * r.cell), r.width - l.width / 2 - 2);
      l.setPosition(cx, Math.max(2, top));
      l.el.classList.toggle('below', below);
    });
  }, []);

  /** Drei Beschriftungen für die aktuelle Frage erzeugen und die Früchte passend platzieren. */
  const setupFruits = useCallback((): boolean => {
    const engine = engineRef.current;
    const r = rendererRef.current;
    const layer = labelLayerRef.current;
    if (!engine || !r || !layer || !engine.question) return false;
    clearLabels();
    const maxW = Math.max(90, Math.min(r.width * 0.44, r.cell * 7.5, 260));
    const maxH = Math.max(46, r.cell * 3.2);
    const font = r.cell < 26 ? 13 : r.cell < 34 ? 14 : 16;
    labelsRef.current = engine.slotAnswers.map((text, slot) => {
      const style = FRUIT_STYLES[slot % FRUIT_STYLES.length];
      const l = new AnswerLabel(layer, text, { className: 'snake-label', accent: style.body });
      l.fit(font, maxW, maxH);
      return l;
    });
    let chosen: LabelRect[] | null = null;
    const ok = engine.placeFruits((cells) => {
      const rects = layoutLabels(cells);
      if (rects) chosen = rects;
      return rects !== null;
    });
    if (!ok) return false;
    if (chosen) applyLabelRects(chosen);
    else clampLabels(); // Notfall (sehr kleines Feld): ohne Platzprüfung platziert
    loop.current.questionStart = performance.now();
    return true;
  }, [applyLabelRects, clampLabels, clearLabels, layoutLabels]);

  // ------------------------------------------------------------------ Grösse

  const fitBoard = useCallback(() => {
    const engine = engineRef.current;
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!engine || !stage || !canvas) return;
    if (!rendererRef.current) rendererRef.current = new SnakeRenderer(canvas);
    const r = rendererRef.current;
    const rect = stage.getBoundingClientRect();
    r.resize(engine.cols, engine.rows, rect.width - 8, rect.height - 8);
    if (boardRef.current) {
      boardRef.current.style.width = `${r.width}px`;
      boardRef.current.style.height = `${r.height}px`;
    }
    if (engine.fruits.length) {
      const rects = layoutLabels(engine.fruits.map((f) => f.cell));
      if (rects) applyLabelRects(rects);
      else clampLabels();
    }
  }, [applyLabelRects, clampLabels, layoutLabels]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(() => fitBoard());
    observer.observe(stage);
    return () => observer.disconnect();
  }, [fitBoard]);

  // ------------------------------------------------------------------ Spielende

  const later = (fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  };

  const finish = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const s = engine.summary();
    recorder.recordSession({
      gameType: 'snake',
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
    setSummary(s);
    setNewRecord(s.score > 0 && s.score > highscoreRef.current);
    if (s.score > highscoreRef.current) setHighscore(s.score);
    clearLabels();
    setOverlay('results');
  }, [clearLabels, recorder]);

  // ------------------------------------------------------------------ Spielschleife

  const handleStep = useCallback(
    (now: number) => {
      const engine = engineRef.current!;
      const r = rendererRef.current!;
      const result = engine.step();
      if (result.type === 'eat') {
        const q = result.fruit;
        const question = engine.question;
        r.burst('eat', q.cell, now, reduceMotion);
        sfx.play('correct');
        setPop({ id: now, value: result.points });
        setFlash({ id: now, tone: 'good', text: `Richtig! +${result.points}` });
        // Frage, die gerade beantwortet wurde (engine.question ist schon die nächste)
        const answered = lastQuestion.current;
        if (answered) recorder.recordAnswer(answered, 'correct', result.points, Math.round(now - loop.current.questionStart));
        lastQuestion.current = question;
        if (engine.phase === 'over') {
          clearLabels();
          later(finish, 700);
        } else if (!setupFruits()) {
          engine.quit();
          later(finish, 400);
        }
      } else if (result.type === 'bomb') {
        recorder.recordAnswer(result.question, 'wrong', 0, Math.round(now - loop.current.questionStart));
        loop.current.bombSlot = result.fruit.slot;
        labelsRef.current.forEach((l, i) => l.setTone(i === engine.correctSlot ? 'correct' : i === result.fruit.slot ? 'wrong' : 'normal'));
        sfx.play('wrong');
        setFlash({ id: now, tone: 'bad', text: 'Bombe! Falsche Antwort.' });
        later(() => {
          loop.current.bombSlot = null;
          loop.current.dead = true;
          engine.fruits = engine.fruits.filter((f) => f.slot !== result.fruit.slot);
          r.burst('bomb', result.fruit.cell, performance.now(), reduceMotion);
          sfx.play('explosion');
          if (!reduceMotion) boardRef.current?.classList.add('shake');
        }, 380);
        later(finish, 1700);
      } else if (result.type === 'crash') {
        loop.current.dead = true;
        r.burst('crash', engine.head, now, reduceMotion);
        sfx.play('impact');
        setFlash({ id: now, tone: 'bad', text: result.reason === 'wall' ? 'Gegen die Wand!' : 'In den eigenen Körper!' });
        if (!reduceMotion) boardRef.current?.classList.add('shake');
        later(finish, 1100);
      }
      rerender();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clearLabels, finish, recorder, reduceMotion, rerender, setupFruits, sfx],
  );
  const frame = useCallback(
    (now: number) => {
      const engine = engineRef.current;
      const r = rendererRef.current;
      const l = loop.current;
      if (!engine || !r) return;
      const dt = l.lastFrame ? now - l.lastFrame : 16;
      l.lastFrame = now;
      if (overlayRef.current === 'none' && engine.phase === 'playing' && !l.waiting) {
        // feste Schrittweite; nach Tab-Wechsel höchstens einen Schritt nachholen
        if (now - l.lastStep > l.interval * 3) l.lastStep = now - l.interval;
        while (engine.phase === 'playing' && now - l.lastStep >= l.interval) {
          l.lastStep += l.interval;
          handleStep(now);
        }
      }
      const t = overlayRef.current === 'paused' || l.waiting ? 1 : Math.min(1, Math.max(0, (now - l.lastStep) / l.interval));
      r.draw(
        {
          cols: engine.cols,
          rows: engine.rows,
          snake: engine.snake,
          previous: engine.previous,
          direction: engine.direction,
          fruits: engine.fruits,
          t: engine.phase === 'playing' ? t : 1,
          dead: l.dead,
          reduceMotion,
          bombSlot: l.bombSlot,
        },
        now,
        dt,
      );
      l.raf = requestAnimationFrame(frame);
    },
    [handleStep, reduceMotion],
  );

  // Vorschau des Feldes schon im Konfigurationsbildschirm
  const buildEngine = useCallback(
    (size: SnakeMapSize, qs: GameQuestion[] = questions, m: GameMode = mode) => {
      const stage = stageRef.current?.getBoundingClientRect();
      const grid = snakeGridSize(size, stage?.width ?? 400, stage?.height ?? 400);
      engineRef.current = new SnakeEngine({ questions: qs, cols: grid.cols, rows: grid.rows, mode: m, deckId: m === 'repeat' ? null : deckId, endless: m !== 'repeat' });
      loop.current.dead = false;
      loop.current.bombSlot = null;
      boardRef.current?.classList.remove('shake');
      clearLabels();
      fitBoard();
      rerender();
    },
    [clearLabels, deckId, fitBoard, mode, questions, rerender],
  );

  useEffect(() => {
    buildEngine(mapSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapSize]);

  useEffect(() => {
    loop.current.raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(loop.current.raf);
  }, [frame]);

  useEffect(
    () => () => {
      for (const t of timers.current) clearTimeout(t);
      clearLabels();
      const engine = engineRef.current;
      if (engine && engine.phase === 'playing' && engine.answeredRounds > 0 && !recorder.isSaved()) {
        engine.quit();
        const s = engine.summary();
        recorder.recordSession({ gameType: 'snake', mode: s.mode, deckId: s.deckId, score: s.score, rounds: s.rounds, correctCount: s.correctCount, wrongCount: s.wrongCount, maxStreak: s.maxStreak, startedAt: s.startedAt, endedAt: s.endedAt });
      }
      sfx.close();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // ------------------------------------------------------------------ Steuerung

  const start = useCallback(
    (qs: GameQuestion[] = questions, m: GameMode = mode) => {
      for (const t of timers.current) clearTimeout(t);
      timers.current = [];
      if (engineRef.current?.phase !== 'ready' || qs !== questions || m !== mode) buildEngine(mapSize, qs, m);
      const engine = engineRef.current!;
      recorder.reset();
      sfx.unlock();
      fitBoard();
      const q = engine.start();
      lastQuestion.current = q;
      if (!setupFruits()) {
        engine.quit();
        finish();
        return;
      }
      loop.current.interval = SNAKE_STEP_MS[speed];
      loop.current.lastStep = performance.now();
      // Die Schlange wartet auf die erste Richtungseingabe: Zeit zum Lesen der Frage
      loop.current.waiting = true;
      setWaiting(true);
      setSummary(null);
      setPop(null);
      setFlash(null);
      setOverlay('none');
      void store.updateSettings({ snakeMapSize: mapSize, snakeSpeed: speed });
      rerender();
    },
    [buildEngine, finish, fitBoard, mapSize, mode, questions, recorder, rerender, setupFruits, sfx, speed, store],
  );

  const turn = useCallback((dir: Direction) => {
    if (overlayRef.current !== 'none') return;
    const engine = engineRef.current;
    if (!engine) return;
    if (loop.current.waiting && engine.phase === 'playing') {
      // erste Eingabe startet die Bewegung (auch in die aktuelle Richtung)
      loop.current.waiting = false;
      loop.current.lastStep = performance.now() - loop.current.interval;
      setWaiting(false);
    }
    engine.turn(dir);
  }, []);

  const pause = useCallback(() => {
    if (overlayRef.current !== 'none' || engineRef.current?.phase !== 'playing') return;
    sfx.suspend();
    setOverlay('paused');
  }, [sfx]);

  const resume = useCallback(() => {
    if (overlayRef.current !== 'paused') return;
    sfx.resume();
    loop.current.lastStep = performance.now();
    setOverlay('none');
  }, [sfx]);

  const quit = useCallback(() => {
    const engine = engineRef.current;
    sfx.resume();
    if (engine && engine.phase === 'playing' && engine.answeredRounds > 0) {
      engine.quit();
      finish();
    } else {
      navigate('/games');
    }
  }, [finish, sfx]);

  const backToConfig = useCallback(() => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
    buildEngine(mapSize);
    setSummary(null);
    setOverlay('config');
  }, [buildEngine, mapSize]);

  useAutoPause(pause);

  // Tastatur: Pfeiltasten/WASD lenken, Leertaste/Esc/P pausieren, Enter startet
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;
      const k = e.key.toLowerCase();
      const current = overlayRef.current;
      const dir = KEY_DIRECTIONS[k];
      if (dir && current === 'none') {
        e.preventDefault();
        turn(dir);
        return;
      }
      if (k.startsWith('arrow')) e.preventDefault(); // Seite nie scrollen
      if ((k === ' ' || k === 'escape' || k === 'p') && !e.repeat) {
        e.preventDefault();
        if (current === 'none') pause();
        else if (current === 'paused') resume();
      } else if (k === 'enter' && current === 'config' && !e.repeat) {
        e.preventDefault();
        start();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pause, resume, start, turn]);

  // Wischen: Richtung nach 22 px Bewegung; mehrere Wischbewegungen in einer Berührung möglich
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let origin: { x: number; y: number; id: number } | null = null;
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      origin = { x: e.clientX, y: e.clientY, id: e.pointerId };
    };
    const move = (e: PointerEvent) => {
      if (!origin || e.pointerId !== origin.id) return;
      const dx = e.clientX - origin.x;
      const dy = e.clientY - origin.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 22) return;
      turn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up');
      origin = { x: e.clientX, y: e.clientY, id: e.pointerId };
    };
    const up = () => {
      origin = null;
    };
    stage.addEventListener('pointerdown', down);
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    return () => {
      stage.removeEventListener('pointerdown', down);
      stage.removeEventListener('pointermove', move);
      stage.removeEventListener('pointerup', up);
      stage.removeEventListener('pointercancel', up);
    };
  }, [turn]);

  // Nur im Entwicklungsmodus: Zugriff für automatisierte Tests
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __snake?: unknown };
    w.__snake = { engine: () => engineRef.current, turn, step: () => handleStep(performance.now()), labels: () => labelsRef.current, waiting: () => loop.current.waiting };
    return () => {
      delete w.__snake;
    };
  }, [handleStep, turn]);

  // ------------------------------------------------------------------ Darstellung

  const engine = engineRef.current;
  const question = engine?.question ?? summary?.missedQuestion ?? null;
  const qLen = question?.question.length ?? 0;
  const endText: Record<string, string> = {
    bomb: 'Bombe! Die Frucht hatte die falsche Antwort.',
    wall: 'Die Schlange ist gegen die Wand gefahren.',
    self: 'Die Schlange hat sich selbst gebissen.',
    completed: 'Alle Fragen der Wiederholung richtig beantwortet.',
    quit: 'Runde beendet.',
  };

  return (
    <div className={`snake-screen${touch ? ' snake-touch' : ''}`}>
      <header className="snake-hud">
        <button type="button" className="snake-hud-btn" onClick={pause} aria-label="Pause" disabled={overlay !== 'none'}>
          <Icon name="pause" />
        </button>
        <div className="snake-hud-item">
          <span>Punkte</span>
          <strong>
            {formatNumber(engine?.score ?? 0)}
            <ScorePop pop={pop} />
          </strong>
        </div>
        <div className="snake-hud-item">
          <span>Länge</span>
          <strong>{engine?.length ?? 0}</strong>
        </div>
        <div className="snake-hud-item">
          <span>Frage</span>
          <strong>{Math.max(1, engine?.roundNumber ?? 1)}</strong>
        </div>
        {engine && engine.streak >= 2 ? <div className="snake-streak">Serie ×{engine.streak}</div> : null}
        <div className="snake-badge">
          <img src="/games/snake/logo.svg" alt="" width={22} height={22} />
          Snake
        </div>
      </header>

      <section className="snake-question" aria-live="polite">
        <div className="snake-question-meta">
          <span>{title}</span>
          {question?.category ? <span>· {question.category}</span> : null}
          {question ? <span>· {DIFFICULTY_LABELS[question.difficulty]}</span> : null}
        </div>
        <h1 className={qLen > 140 ? 'q-long' : qLen > 70 ? 'q-medium' : undefined}>
          {question && overlay !== 'config' ? <BidiText text={question.question} /> : 'Friss die Frucht mit der richtigen Antwort'}
        </h1>
        {overlay === 'none' && waiting && engine?.phase === 'playing' ? (
          <p className="snake-start-hint">{touch ? 'Wische oder tippe eine Richtung, um loszufahren' : 'Drücke eine Pfeiltaste oder WASD, um loszufahren'}</p>
        ) : null}
        {flash ? (
          <p key={flash.id} className={`snake-flash ${flash.tone}`} role="status">
            {flash.text}
          </p>
        ) : null}
      </section>

      <div className="snake-stage" ref={stageRef}>
        <div className="snake-board" ref={boardRef}>
          <canvas ref={canvasRef} aria-label="Snake-Spielfeld" />
          <div className="snake-labels" ref={labelLayerRef} aria-hidden="true" />
        </div>
        {/* Für Screenreader: die drei Antworten als Liste */}
        <ol className="sr-only">
          {engine?.fruits.map((f) => (
            <li key={f.slot}>
              {FRUIT_STYLES[f.slot].name}: {f.answer}
            </li>
          ))}
        </ol>

        {overlay === 'config' ? (
          <div className="snake-overlay">
            <div className="snake-card">
              <img src="/games/snake/logo.svg" alt="" width={64} height={64} className="snake-card-logo" />
              <h2>Snake</h2>
              <p className="snake-muted">
                {title} · {plural(questions.length, 'Frage', 'Fragen')}
              </p>
              <p>
                Oben steht die Frage, auf dem Feld liegen drei Früchte mit Antworten. <strong>Friss die richtige Frucht.</strong> Eine falsche Frucht ist eine
                Bombe. Wand und eigener Körper beenden das Spiel ebenfalls.
              </p>
              {skipped > 0 ? (
                <p className="snake-note">
                  {plural(skipped, 'Frage wird', 'Fragen werden')} übersprungen, weil sie keine drei unterschiedlichen Antworten hat.
                </p>
              ) : null}
              <fieldset className="snake-choice">
                <legend>Kartengrösse</legend>
                <div className="snake-segmented" role="radiogroup" aria-label="Kartengrösse">
                  {(['small', 'large'] as SnakeMapSize[]).map((m) => (
                    <button key={m} type="button" role="radio" aria-checked={mapSize === m} className={mapSize === m ? 'active' : undefined} onClick={() => setMapSize(m)}>
                      {SNAKE_MAP_LABELS[m]}
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset className="snake-choice">
                <legend>Geschwindigkeit</legend>
                <div className="snake-segmented three" role="radiogroup" aria-label="Geschwindigkeit">
                  {(['slow', 'medium', 'fast'] as SnakeSpeed[]).map((v) => (
                    <button key={v} type="button" role="radio" aria-checked={speed === v} className={speed === v ? 'active' : undefined} onClick={() => setSpeed(v)}>
                      {SNAKE_SPEED_LABELS[v]}
                    </button>
                  ))}
                </div>
              </fieldset>
              <p className="snake-muted small">{touch ? 'Steuerung: Wischen oder Steuerkreuz' : 'Steuerung: Pfeiltasten oder WASD · Leertaste für Pause'}</p>
              <div className="snake-actions">
                <button type="button" className="snake-btn primary" onClick={() => start()}>
                  <Icon name="play" size={20} />
                  Start
                </button>
                <button type="button" className="snake-btn ghost" onClick={() => navigate(gameRoute('snake'))}>
                  Anderes Lernpaket
                </button>
                <button type="button" className="snake-btn ghost" onClick={() => navigate(gameRoute('meteor-defense', { deckId }))}>
                  Zu Meteor Defense
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {overlay === 'paused' ? (
          <div className="snake-overlay">
            <div className="snake-card">
              <h2>Pause</h2>
              <p className="snake-muted">
                {formatNumber(engine?.score ?? 0)} Punkte · Länge {engine?.length ?? 0}
              </p>
              <div className="snake-actions">
                <button type="button" className="snake-btn primary" onClick={resume}>
                  <Icon name="play" size={20} />
                  Weiterspielen
                </button>
                <button type="button" className="snake-btn" onClick={backToConfig}>
                  <Icon name="settings" size={18} />
                  Neu starten / Einstellungen
                </button>
                <button type="button" className="snake-btn ghost" onClick={quit}>
                  Spiel beenden
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {overlay === 'results' && summary ? (
          <div className="snake-overlay">
            <div className={`snake-card results ${summary.reason === 'bomb' ? 'bomb' : ''}`}>
              <h2>{summary.reason === 'completed' ? 'Geschafft!' : summary.reason === 'quit' ? 'Runde beendet' : 'Game Over'}</h2>
              <p className="snake-muted">{endText[summary.reason]}</p>
              <div className="snake-score">{formatNumber(summary.score)}</div>
              <p className={newRecord ? 'snake-highscore new' : 'snake-highscore'}>
                {newRecord ? 'Neuer Snake-Highscore!' : `Highscore Snake: ${formatNumber(Math.max(highscore, summary.score))}`}
              </p>
              <dl className="snake-facts">
                <div>
                  <dt>Richtig</dt>
                  <dd>{summary.correctCount}</dd>
                </div>
                <div>
                  <dt>Falsch</dt>
                  <dd>{summary.wrongCount}</dd>
                </div>
                <div>
                  <dt>Quote</dt>
                  <dd>{formatPercent(summary.accuracy)}</dd>
                </div>
                <div>
                  <dt>Länge</dt>
                  <dd>{summary.length}</dd>
                </div>
              </dl>
              {summary.missedQuestion ? (
                <div className="snake-solution">
                  <span className="snake-muted small">Richtige Antwort</span>
                  <strong>
                    <span className="solution-letter">{ANSWER_LETTERS[summary.missedQuestion.correctIndex]}</span>
                    <BidiText text={summary.missedQuestion.answers[summary.missedQuestion.correctIndex]} />
                  </strong>
                  {summary.missedQuestion.explanation.trim() ? (
                    <p className="snake-muted small">
                      <BidiText text={summary.missedQuestion.explanation.trim()} />
                    </p>
                  ) : null}
                </div>
              ) : null}
              <div className="snake-actions">
                <button type="button" className="snake-btn primary" onClick={() => start()}>
                  <Icon name="play" size={20} />
                  Nochmal spielen
                </button>
                {summary.missedQuestion ? (
                  <button type="button" className="snake-btn" onClick={() => start([summary.missedQuestion!], 'repeat')}>
                    <Icon name="repeat" size={18} />
                    Falsche Frage wiederholen
                  </button>
                ) : null}
                <button type="button" className="snake-btn" onClick={backToConfig}>
                  <Icon name="settings" size={18} />
                  Einstellungen ändern
                </button>
                <button type="button" className="snake-btn ghost" onClick={() => navigate('/games')}>
                  Anderes Spiel
                </button>
                <button type="button" className="snake-btn ghost" onClick={() => navigate('/', { replace: true })}>
                  Zum Dashboard
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {touch ? (
        // Platz immer reservieren, damit sich das Spielfeld beim Start nicht verkleinert
        <div className={overlay === 'none' || overlay === 'paused' ? 'snake-dpad' : 'snake-dpad inactive'} aria-label="Steuerkreuz" aria-hidden={overlay === 'none' || overlay === 'paused' ? undefined : true}>
          {(['up', 'left', 'right', 'down'] as Direction[]).map((d) => (
            <button
              key={d}
              type="button"
              className={`dpad-${d}`}
              aria-label={{ up: 'Nach oben', down: 'Nach unten', left: 'Nach links', right: 'Nach rechts' }[d]}
              onPointerDown={(e) => {
                e.preventDefault();
                turn(d);
              }}
            >
              <Icon name="chevron" size={26} />
            </button>
          ))}
          <button type="button" className="dpad-pause" aria-label="Pause" onPointerDown={(e) => { e.preventDefault(); if (overlayRef.current === 'none') pause(); else resume(); }}>
            <Icon name="pause" size={20} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
