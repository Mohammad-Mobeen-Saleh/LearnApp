import type { Cell, Direction, Fruit } from '../../domain/snake.ts';

/**
 * Zeichnet das Snake-Spielfeld in eine Canvas (eigene visuelle Identität:
 * dunkelgrünes Feld, leuchtend grüne Schlange, türkise und hellgrüne Akzente).
 * Bewegung wird zwischen zwei Spielschritten weich interpoliert.
 */

export const FRUIT_STYLES = [
  { name: 'Apfel', body: '#f87171', shade: '#b91c1c', leaf: '#4ade80' },
  { name: 'Orange', body: '#fb923c', shade: '#c2410c', leaf: '#86efac' },
  { name: 'Traube', body: '#c084fc', shade: '#7e22ce', leaf: '#a3e635' },
] as const;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
}

interface Effect {
  kind: 'eat' | 'bomb' | 'crash';
  cell: Cell;
  start: number;
}

export interface RenderState {
  cols: number;
  rows: number;
  snake: Cell[];
  previous: Cell[];
  direction: Direction;
  fruits: Fruit[];
  /** 0…1 Fortschritt zwischen zwei Schritten */
  t: number;
  dead: boolean;
  reduceMotion: boolean;
  /** Frucht, die gerade zur Bombe wird */
  bombSlot: number | null;
}

export class SnakeRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  private effects: Effect[] = [];
  private dpr = 1;
  cell = 20;
  width = 0;
  height = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas wird nicht unterstützt');
    this.ctx = ctx;
  }

  /** Grösse in CSS-Pixeln setzen (scharf auf Retina-Displays). */
  resize(cols: number, rows: number, maxWidth: number, maxHeight: number): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.cell = Math.max(8, Math.floor(Math.min(maxWidth / cols, maxHeight / rows)));
    this.width = this.cell * cols;
    this.height = this.cell * rows;
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
  }

  cellCenter(c: Cell): { x: number; y: number } {
    return { x: (c.x + 0.5) * this.cell, y: (c.y + 0.5) * this.cell };
  }

  burst(kind: Effect['kind'], cell: Cell, now: number, reduceMotion: boolean): void {
    this.effects.push({ kind, cell, start: now });
    if (reduceMotion) return;
    const { x, y } = this.cellCenter(cell);
    const colors =
      kind === 'eat' ? ['#bbf7d0', '#4ade80', '#5eead4', '#fef9c3'] : kind === 'bomb' ? ['#fde047', '#fb923c', '#ef4444', '#fff7ed'] : ['#fca5a5', '#f87171'];
    const count = kind === 'bomb' ? 46 : kind === 'eat' ? 22 : 14;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = (kind === 'bomb' ? 3.2 : 1.8) * this.cell * (0.4 + Math.random());
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        life: 0,
        max: 0.5 + Math.random() * (kind === 'bomb' ? 0.7 : 0.4),
        color: colors[i % colors.length],
        size: this.cell * (kind === 'bomb' ? 0.22 : 0.15) * (0.6 + Math.random()),
      });
    }
  }

  draw(state: RenderState, now: number, dt: number): void {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawBoard(state);
    for (const f of state.fruits) this.drawFruit(f, now, state.bombSlot === f.slot);
    this.drawSnake(state, now);
    this.drawEffects(now, state.reduceMotion);
    this.drawParticles(dt);
  }

  get busy(): boolean {
    return this.particles.length > 0 || this.effects.length > 0;
  }

  private drawBoard(state: RenderState): void {
    const { ctx, cell, width, height } = this;
    const bg = ctx.createLinearGradient(0, 0, width, height);
    bg.addColorStop(0, '#052e1a');
    bg.addColorStop(1, '#0a3a26');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(52, 211, 153, 0.045)';
    for (let y = 0; y < state.rows; y++) for (let x = (y % 2); x < state.cols; x += 2) ctx.fillRect(x * cell, y * cell, cell, cell);
    ctx.strokeStyle = 'rgba(94, 234, 212, 0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, width - 2, height - 2);
  }

  private drawFruit(f: Fruit, now: number, asBomb: boolean): void {
    const { ctx, cell } = this;
    const { x, y } = this.cellCenter(f.cell);
    const style = FRUIT_STYLES[f.slot % FRUIT_STYLES.length];
    const pulse = 1 + Math.sin(now / 260 + f.slot * 2) * 0.05;
    const r = cell * 0.36 * pulse;
    ctx.save();
    ctx.shadowColor = asBomb ? '#ef4444' : style.body;
    ctx.shadowBlur = cell * 0.5;
    if (asBomb) {
      ctx.fillStyle = '#111827';
      ctx.beginPath();
      ctx.arc(x, y + cell * 0.04, r * 1.05, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#a16207';
      ctx.lineWidth = cell * 0.08;
      ctx.beginPath();
      ctx.moveTo(x + r * 0.5, y - r * 0.7);
      ctx.quadraticCurveTo(x + r, y - r * 1.4, x + r * 1.2, y - r * 1.1);
      ctx.stroke();
      ctx.fillStyle = Math.floor(now / 80) % 2 ? '#fde047' : '#fb923c';
      ctx.beginPath();
      ctx.arc(x + r * 1.2, y - r * 1.1, cell * 0.1, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.4, r * 0.1, x, y, r);
      g.addColorStop(0, '#fff7ed');
      g.addColorStop(0.25, style.body);
      g.addColorStop(1, style.shade);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y + cell * 0.04, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = style.leaf;
      ctx.lineWidth = cell * 0.09;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, y - r * 0.8);
      ctx.quadraticCurveTo(x + r * 0.3, y - r * 1.4, x + r * 0.8, y - r * 1.3);
      ctx.stroke();
    }
    ctx.restore();
  }

  private interpolated(state: RenderState): { x: number; y: number }[] {
    const t = state.dead ? 1 : state.t;
    return state.snake.map((c, i) => {
      const p = state.previous[i] ?? state.previous[state.previous.length - 1] ?? c;
      const a = this.cellCenter(p);
      const b = this.cellCenter(c);
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    });
  }

  private drawSnake(state: RenderState, now: number): void {
    const { ctx, cell } = this;
    const pts = this.interpolated(state);
    if (!pts.length) return;
    const head = pts[0];
    const tail = pts[pts.length - 1];
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const grad = ctx.createLinearGradient(head.x, head.y, tail.x, tail.y);
    if (state.dead) {
      grad.addColorStop(0, '#fca5a5');
      grad.addColorStop(1, '#7f1d1d');
    } else {
      grad.addColorStop(0, '#bbf7d0');
      grad.addColorStop(0.35, '#4ade80');
      grad.addColorStop(1, '#15803d');
    }
    // Leuchten
    ctx.shadowColor = state.dead ? '#ef4444' : '#4ade80';
    ctx.shadowBlur = cell * 0.6;
    ctx.strokeStyle = grad;
    ctx.lineWidth = cell * 0.74;
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    if (pts.length === 1) ctx.lineTo(head.x + 0.01, head.y);
    ctx.stroke();
    ctx.shadowBlur = 0;
    // Musterstreifen
    ctx.strokeStyle = state.dead ? 'rgba(255,255,255,0.15)' : 'rgba(20, 83, 45, 0.35)';
    ctx.lineWidth = cell * 0.16;
    ctx.setLineDash([cell * 0.18, cell * 0.5]);
    ctx.lineDashOffset = -now / 60;
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
    ctx.setLineDash([]);
    // Kopf
    ctx.fillStyle = state.dead ? '#fecaca' : '#dcfce7';
    ctx.beginPath();
    ctx.arc(head.x, head.y, cell * 0.44, 0, Math.PI * 2);
    ctx.fill();
    const v = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[state.direction];
    const side = [-v[1], v[0]];
    ctx.fillStyle = '#052e1a';
    for (const s of [-1, 1]) {
      const ex = head.x + v[0] * cell * 0.14 + side[0] * s * cell * 0.17;
      const ey = head.y + v[1] * cell * 0.14 + side[1] * s * cell * 0.17;
      ctx.beginPath();
      if (state.dead) {
        ctx.lineWidth = cell * 0.06;
        ctx.strokeStyle = '#7f1d1d';
        const d = cell * 0.07;
        ctx.moveTo(ex - d, ey - d);
        ctx.lineTo(ex + d, ey + d);
        ctx.moveTo(ex + d, ey - d);
        ctx.lineTo(ex - d, ey + d);
        ctx.stroke();
      } else {
        ctx.arc(ex, ey, cell * 0.075, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private drawEffects(now: number, reduceMotion: boolean): void {
    const { ctx, cell } = this;
    this.effects = this.effects.filter((e) => now - e.start < (e.kind === 'bomb' ? 900 : 600));
    for (const e of this.effects) {
      const p = (now - e.start) / (e.kind === 'bomb' ? 900 : 600);
      const { x, y } = this.cellCenter(e.cell);
      ctx.save();
      if (e.kind === 'bomb') {
        ctx.fillStyle = `rgba(253, 224, 71, ${0.55 * (1 - p)})`;
        ctx.beginPath();
        ctx.arc(x, y, cell * (0.5 + p * (reduceMotion ? 2 : 5)), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(239, 68, 68, ${0.25 * (1 - p)})`;
        ctx.fillRect(0, 0, this.width, this.height);
      } else {
        ctx.strokeStyle = e.kind === 'eat' ? `rgba(94, 234, 212, ${1 - p})` : `rgba(248, 113, 113, ${1 - p})`;
        ctx.lineWidth = cell * 0.12;
        ctx.beginPath();
        ctx.arc(x, y, cell * (0.4 + p * 1.6), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  private drawParticles(dt: number): void {
    const { ctx } = this;
    const s = Math.min(dt, 50) / 1000;
    this.particles = this.particles.filter((p) => (p.life += s) < p.max);
    for (const p of this.particles) {
      p.x += p.vx * s;
      p.y += p.vy * s;
      p.vx *= 0.92;
      p.vy *= 0.92;
      ctx.globalAlpha = 1 - p.life / p.max;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
