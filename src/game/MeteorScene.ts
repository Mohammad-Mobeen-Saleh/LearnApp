import * as Phaser from 'phaser';
import type { SoundFx } from './sfx.ts';

/**
 * Darstellung des Meteoritenschwarms (Phaser 3).
 * Die Spielregeln liegen im GameController (domain/game.ts); die Szene meldet nur,
 * auf welchen Meteoriten geschossen wurde oder dass die Zeit abgelaufen ist.
 *
 * Für gestochen scharfe Schrift auf Retina-Displays rendert die Szene in Gerätepixeln
 * (Spielgrösse = CSS-Grösse × devicePixelRatio). Alle Masse werden mit `s` skaliert.
 */

export interface SceneRound {
  /** Abwehrmodus: drei Antworttexte; Tippmodus: leer (ein Meteorit ohne Beschriftung) */
  answers: string[];
  durationMs: number;
  roundNumber: number;
  kind?: 'choice' | 'typing';
  /** Endlos-Abwehrmodus: nach einem Treffer ohne Wartezeit zur nächsten Frage */
  fastAdvance?: boolean;
}

export interface SceneCallbacks {
  onShoot(slot: number, elapsedMs: number): { correct: boolean; correctSlot: number };
  onTimeout(elapsedMs: number): { correctSlot: number };
  onResolved(): void;
}

export class GameBridge {
  scene: MeteorScene | null = null;
  private pending: SceneRound | null = null;
  callbacks: SceneCallbacks;
  readonly pixelRatio: number;
  readonly sfx: SoundFx;
  reduceMotion: boolean;
  showKeyHints: boolean;

  constructor(callbacks: SceneCallbacks, sfx: SoundFx, options: { pixelRatio: number; reduceMotion: boolean; showKeyHints: boolean }) {
    this.callbacks = callbacks;
    this.sfx = sfx;
    this.pixelRatio = options.pixelRatio;
    this.reduceMotion = options.reduceMotion;
    this.showKeyHints = options.showKeyHints;
  }

  attach(scene: MeteorScene): void {
    this.scene = scene;
    if (this.pending) {
      const round = this.pending;
      this.pending = null;
      scene.startRound(round);
    }
  }

  /** Trennt die Verbindung – nur, wenn es noch dieselbe Szene ist (beim Neuaufbau des Spiels wichtig). */
  detach(scene?: MeteorScene): void {
    if (!scene || this.scene === scene) this.scene = null;
  }

  startRound(round: SceneRound): void {
    if (this.scene) this.scene.startRound(round);
    else this.pending = round;
  }

  shoot(slot: number): void {
    this.scene?.shoot(slot);
  }

  pause(): void {
    this.scene?.pauseGame();
  }

  resume(): void {
    this.scene?.resumeGame();
  }

  clear(): void {
    this.pending = null;
    this.scene?.clearRound();
  }

  /** Tippmodus: richtige Eingabe – Meteorit abschiessen. */
  typingHit(): void {
    this.scene?.typingHit();
  }

  /** Tippmodus: falsche Eingabe – kurzes Warnsignal, der Meteorit fällt weiter. */
  typingMiss(): void {
    this.scene?.typingMiss();
  }

  /** Vergangene Flugzeit der laufenden Runde (Pausen nicht mitgezählt). */
  elapsed(): number {
    return this.scene?.roundElapsed() ?? 0;
  }
}

const COLORS = {
  cyan: 0x22d3ee,
  cyanLight: 0xa5f3fc,
  violet: 0x8b5cf6,
  indigo: 0x6366f1,
  green: 0x34d399,
  red: 0xf87171,
  amber: 0xfbbf24,
  white: 0xffffff,
  labelFill: 0x10173f,
};
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

type LabelTone = 'normal' | 'hover' | 'correct' | 'wrong';

interface MeteorView {
  slot: number;
  rock: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Image;
  labelBg: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
  hint: Phaser.GameObjects.Text | null;
  x: number;
  y: number;
  y0: number;
  y1: number;
  labelW: number;
  labelH: number;
  wobble: number;
  spin: number;
  alive: boolean;
  tone: LabelTone;
  typing: boolean;
}

type RoundState = 'idle' | 'flying' | 'resolving';

export class MeteorScene extends Phaser.Scene {
  private readonly bridge: GameBridge;
  private s = 1;
  private w = 0;
  private h = 0;
  private laneW = 0;
  private groundY = 0;
  private shieldCx = 0;
  private shieldCy = 0;
  private shieldR = 0;
  private meteorR = 30;
  private fontPx = 15;
  private maxLabelH = 120;
  private meteors: MeteorView[] = [];
  private state: RoundState = 'idle';
  private round: SceneRound | null = null;
  private elapsed = 0;
  private trailClock = 0;
  private paused = false;
  private hoverSlot = -1;
  private stars: { img: Phaser.GameObjects.Image; speed: number }[] = [];
  private lanes!: Phaser.GameObjects.Graphics;
  private ground!: Phaser.GameObjects.Graphics;
  private shield!: Phaser.GameObjects.Graphics;
  private turretBase!: Phaser.GameObjects.Image;
  private turretBarrel!: Phaser.GameObjects.Image;
  private timerBg!: Phaser.GameObjects.Rectangle;
  private timerBar!: Phaser.GameObjects.Rectangle;

  constructor(bridge: GameBridge) {
    super({ key: 'meteor' });
    this.bridge = bridge;
  }

  create(): void {
    this.s = this.bridge.pixelRatio;
    this.makeTextures();
    this.lanes = this.add.graphics().setDepth(1);
    this.ground = this.add.graphics().setDepth(4);
    this.shield = this.add.graphics().setDepth(5);
    this.turretBarrel = this.add.image(0, 0, 'md-barrel').setOrigin(0.5, 0.88).setDepth(8);
    this.turretBase = this.add.image(0, 0, 'md-turret').setOrigin(0.5, 1).setDepth(9);
    this.timerBg = this.add.rectangle(0, 0, 10, 10, COLORS.white, 0.08).setOrigin(0, 0).setDepth(30);
    this.timerBar = this.add.rectangle(0, 0, 10, 10, COLORS.cyan, 0.95).setOrigin(0, 0).setDepth(31);
    this.createStars();
    this.layout();

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.onPointerDown(pointer));
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => this.onPointerMove(pointer));
    this.scale.on('resize', () => this.layout());
    this.events.once('shutdown', () => this.bridge.detach(this));
    this.events.once('destroy', () => this.bridge.detach(this));
    this.bridge.attach(this);
  }

  // ------------------------------------------------------------------ Texturen

  private canvasTexture(key: string, width: number, height: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) {
    if (this.textures.exists(key)) this.textures.remove(key);
    const w = Math.max(2, Math.ceil(width));
    const h = Math.max(2, Math.ceil(height));
    const texture = this.textures.createCanvas(key, w, h);
    if (!texture) return;
    draw(texture.getContext(), w, h);
    texture.refresh();
  }

  private makeTextures(): void {
    const s = this.s;
    this.canvasTexture('md-glow', 96 * s, 96 * s, (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    });
    this.canvasTexture('md-spark', 14 * s, 14 * s, (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.8)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    });
    this.canvasTexture('md-star', 6 * s, 6 * s, (ctx, w, h) => {
      ctx.fillStyle = '#e0f2fe';
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2);
      ctx.fill();
    });
    for (let i = 0; i < 3; i++) this.rockTexture(`md-rock-${i}`, i);
    this.canvasTexture('md-turret', 84 * s, 46 * s, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#4338ca');
      g.addColorStop(1, '#1e1b4b');
      ctx.fillStyle = g;
      ctx.strokeStyle = '#a5b4fc';
      ctx.lineWidth = 3 * s;
      ctx.beginPath();
      ctx.moveTo(4 * s, h - 2 * s);
      ctx.arc(w / 2, h - 2 * s, w / 2 - 4 * s, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#67e8f9';
      ctx.beginPath();
      ctx.arc(w / 2, h - 16 * s, 6 * s, 0, Math.PI * 2);
      ctx.fill();
    });
    this.canvasTexture('md-barrel', 16 * s, 50 * s, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, '#93c5fd');
      g.addColorStop(0.5, '#e0f2fe');
      g.addColorStop(1, '#60a5fa');
      ctx.fillStyle = g;
      const r = w / 2;
      ctx.beginPath();
      ctx.moveTo(r, 0);
      ctx.arc(r, r, r, -Math.PI / 2, Math.PI * 1.5);
      ctx.fillRect(0, r, w, h - r);
      ctx.fill();
      ctx.fillStyle = '#22d3ee';
      ctx.fillRect(w * 0.25, 2 * s, w * 0.5, 6 * s);
    });
  }

  /** Low-Poly-Meteorit wie im Logo: dunkle Rückseite, glühende Vorderseite (unten). */
  private rockTexture(key: string, variant: number): void {
    const s = this.s;
    const R = 50 * s;
    const pad = 8 * s;
    const radii = [
      [1, 0.86, 0.96, 0.82, 0.94, 0.88, 1, 0.84, 0.92],
      [0.92, 1, 0.84, 0.95, 0.8, 0.97, 0.86, 0.99, 0.83],
      [0.97, 0.83, 1, 0.88, 0.93, 0.81, 0.95, 0.9, 0.87],
    ][variant % 3];
    this.canvasTexture(key, 2 * (R + pad), 2 * (R + pad), (ctx, w, h) => {
      const cx = w / 2;
      const cy = h / 2;
      const verts = radii.map((r, i) => {
        const a = (i / radii.length) * Math.PI * 2 + variant * 0.3;
        return [cx + Math.cos(a) * R * r, cy + Math.sin(a) * R * r] as const;
      });
      const hub = [cx - R * 0.1, cy - R * 0.12] as const;
      verts.forEach((v, i) => {
        const n = verts[(i + 1) % verts.length];
        const midY = (v[1] + n[1]) / 2 - cy;
        const midX = (v[0] + n[0]) / 2 - cx;
        // Licht von unten (Flugrichtung): je weiter unten, desto heller
        const light = Math.max(0, Math.min(1, (midY / R) * 0.9 + 0.35 - midX / R / 6));
        const shades = ['#4c1d95', '#5b21b6', '#6d28d9', '#7c3aed', '#8b5cf6', '#a78bfa', '#c4b5fd', '#e0e7ff', '#f0f9ff'];
        ctx.fillStyle = shades[Math.min(shades.length - 1, Math.floor(light * shades.length))];
        ctx.beginPath();
        ctx.moveTo(hub[0], hub[1]);
        ctx.lineTo(v[0], v[1]);
        ctx.lineTo(n[0], n[1]);
        ctx.closePath();
        ctx.fill();
      });
      ctx.strokeStyle = 'rgba(224,231,255,0.75)';
      ctx.lineWidth = 2.5 * s;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      verts.forEach((v, i) => (i === 0 ? ctx.moveTo(v[0], v[1]) : ctx.lineTo(v[0], v[1])));
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = 'rgba(46,16,101,0.75)';
      ctx.beginPath();
      ctx.arc(cx + R * 0.28, cy - R * 0.3, R * 0.13, 0, Math.PI * 2);
      ctx.arc(cx - R * 0.32, cy - R * 0.08, R * 0.08, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  private createStars(): void {
    for (let i = 0; i < 70; i++) {
      const img = this.add.image(0, 0, 'md-star').setDepth(0).setAlpha(0.2 + Math.random() * 0.6);
      img.setScale(0.4 + Math.random() * 0.8);
      this.stars.push({ img, speed: 0.004 + Math.random() * 0.012 });
      if (!this.bridge.reduceMotion) {
        this.tweens.add({ targets: img, alpha: 0.1, duration: 1200 + Math.random() * 2400, yoyo: true, repeat: -1, delay: Math.random() * 2000 });
      }
    }
  }

  // ------------------------------------------------------------------ Layout

  private layout(): void {
    const s = this.s;
    this.w = this.scale.width;
    this.h = this.scale.height;
    const cssW = this.w / s;
    const cssH = this.h / s;
    this.laneW = this.w / 3;
    this.groundY = this.h - Math.max(44, Math.min(78, cssH * 0.11)) * s;
    this.shieldR = Math.max(this.w, this.h) * 1.15;
    this.shieldCx = this.w / 2;
    this.shieldCy = this.groundY - 26 * s + this.shieldR;
    this.fontPx = (cssW < 380 ? 13 : cssW < 520 ? 14 : cssW < 800 ? 16 : 18) * s;
    this.meteorR = Math.max(18, Math.min(34, (this.laneW / s) * 0.19, cssH * 0.07)) * s;
    this.maxLabelH = Math.max(70 * s, (this.groundY - 40 * s) * 0.48);

    for (const star of this.stars) star.img.setPosition(Math.random() * this.w, Math.random() * this.groundY);
    this.drawGround();
    this.drawShield(0);
    this.drawLanes();
    const baseY = this.groundY + 8 * s;
    this.turretBase.setPosition(this.w / 2, baseY).setDisplaySize(64 * s, 35 * s);
    this.turretBarrel.setPosition(this.w / 2, baseY - 18 * s).setDisplaySize(12 * s, 38 * s);
    this.timerBg.setPosition(0, 0).setSize(this.w, 5 * s);
    this.timerBar.setPosition(0, 0).setSize(this.w, 5 * s);
    for (const m of this.meteors) this.layoutMeteor(m);
    if (this.state === 'flying' && this.round) {
      const p = Math.min(1, this.elapsed / this.round.durationMs);
      for (const m of this.meteors) if (m.alive) this.positionMeteor(m, p);
    }
  }

  /** y-Koordinate des Schutzschilds an Position x */
  private shieldYAt(x: number): number {
    const dx = x - this.shieldCx;
    return this.shieldCy - Math.sqrt(Math.max(0, this.shieldR * this.shieldR - dx * dx));
  }

  private drawGround(): void {
    const s = this.s;
    const g = this.ground;
    g.clear();
    const r = this.shieldR * 1.05;
    const cy = this.groundY + r;
    g.fillStyle(0x0b1a3d, 1);
    g.fillCircle(this.w / 2, cy, r);
    g.lineStyle(3 * s, 0x38bdf8, 0.45);
    g.strokeCircle(this.w / 2, cy, r);
    g.lineStyle(14 * s, 0x38bdf8, 0.08);
    g.strokeCircle(this.w / 2, cy, r + 6 * s);
    // kleine Lichter der verteidigten Basis
    g.fillStyle(0x67e8f9, 0.8);
    for (let i = 1; i < 12; i++) {
      const x = (this.w / 12) * i;
      if (Math.abs(x - this.w / 2) < 44 * s) continue;
      const y = cy - Math.sqrt(Math.max(0, r * r - (x - this.w / 2) ** 2)) + 10 * s + (i % 3) * 4 * s;
      g.fillCircle(x, y, (1.4 + (i % 2)) * s);
    }
  }

  private drawShield(flash: number): void {
    const s = this.s;
    const g = this.shield;
    g.clear();
    const start = Math.atan2(this.shieldYAt(0) - this.shieldCy, -this.shieldCx);
    const end = Math.atan2(this.shieldYAt(this.w) - this.shieldCy, this.w - this.shieldCx);
    const stroke = (width: number, color: number, alpha: number) => {
      g.lineStyle(width, color, alpha);
      g.beginPath();
      g.arc(this.shieldCx, this.shieldCy, this.shieldR, start, end, false);
      g.strokePath();
    };
    stroke(18 * s, COLORS.cyan, 0.08 + flash * 0.25);
    stroke(8 * s, COLORS.cyan, 0.16 + flash * 0.3);
    stroke(2.5 * s, COLORS.cyanLight, 0.85);
  }

  private drawLanes(): void {
    const s = this.s;
    const g = this.lanes;
    g.clear();
    if (this.hoverSlot >= 0 && this.state === 'flying') {
      g.fillStyle(COLORS.cyan, 0.05);
      g.fillRect(this.laneW * this.hoverSlot, 0, this.laneW, this.groundY);
    }
    if (this.round?.kind === 'typing') return;
    g.lineStyle(1 * s, COLORS.indigo, 0.18);
    for (let i = 1; i < 3; i++) g.lineBetween(this.laneW * i, 12 * s, this.laneW * i, this.shieldYAt(this.laneW * i) - 6 * s);
  }

  private layoutMeteor(m: MeteorView): void {
    const s = this.s;
    if (m.typing) {
      // Tippmodus: ein grösserer Meteorit in der Mitte, ohne Beschriftung
      const r = this.meteorR * 1.35;
      m.labelW = 0;
      m.labelH = 0;
      m.label.setVisible(false);
      m.labelBg.clear();
      m.rock.setDisplaySize(r * 2.3, r * 2.3);
      m.glow.setDisplaySize(r * 4.2, r * 4.2);
      m.x = this.w / 2;
      m.y0 = r + 16 * s;
      m.y1 = Math.max(m.y0 + 30 * s, this.shieldYAt(m.x) - r - 6 * s);
      return;
    }
    const laneX = this.laneW * (m.slot + 0.5);
    const maxLabelW = Math.min(this.laneW - 10 * s, 320 * s);
    const padX = 10 * s;
    const padY = 8 * s;
    let size = this.fontPx;
    m.label.setFontSize(size);
    m.label.setWordWrapWidth(maxLabelW - 2 * padX, true);
    while (m.label.height + 2 * padY > this.maxLabelH && size > 11 * s) {
      size -= s;
      m.label.setFontSize(size);
    }
    m.labelW = Math.min(maxLabelW, Math.max(m.label.width + 2 * padX, 70 * s));
    m.labelH = m.label.height + 2 * padY;
    m.rock.setDisplaySize(this.meteorR * 2.3, this.meteorR * 2.3);
    m.glow.setDisplaySize(this.meteorR * 4.2, this.meteorR * 4.2);
    m.x = laneX;
    m.y0 = this.meteorR + 16 * s;
    const impact = this.shieldYAt(laneX);
    m.y1 = Math.max(m.y0 + 30 * s, impact - m.labelH - this.meteorR - 10 * s);
    this.drawLabel(m, m.tone);
  }

  private drawLabel(m: MeteorView, tone: LabelTone): void {
    const s = this.s;
    m.tone = tone;
    const g = m.labelBg;
    g.clear();
    if (m.labelH === 0) return;
    const radius = Math.min(12 * s, m.labelH / 2, m.labelW / 2);
    const fill = tone === 'correct' ? 0x064e3b : tone === 'wrong' ? 0x7f1d1d : COLORS.labelFill;
    const stroke = tone === 'correct' ? COLORS.green : tone === 'wrong' ? COLORS.red : tone === 'hover' ? COLORS.cyan : COLORS.indigo;
    g.fillStyle(fill, 0.94);
    g.fillRoundedRect(-m.labelW / 2, 0, m.labelW, m.labelH, radius);
    g.lineStyle((tone === 'normal' ? 1.5 : 2.5) * s, stroke, tone === 'normal' ? 0.7 : 1);
    g.strokeRoundedRect(-m.labelW / 2, 0, m.labelW, m.labelH, radius);
  }

  private positionMeteor(m: MeteorView, p: number): void {
    const s = this.s;
    const wobble = this.bridge.reduceMotion ? 0 : Math.sin(this.elapsed / 650 + m.wobble) * 3 * s;
    m.y = m.y0 + (m.y1 - m.y0) * p;
    const x = m.x + wobble;
    m.rock.setPosition(x, m.y);
    m.glow.setPosition(x, m.y - this.meteorR * 0.3);
    const top = m.y + this.meteorR + 6 * s;
    m.labelBg.setPosition(x, top);
    m.label.setPosition(x, top + 8 * s);
    m.hint?.setPosition(x - m.labelW / 2 + 2 * s, top - 2 * s);
  }

  // ------------------------------------------------------------------ Runden

  startRound(round: SceneRound): void {
    this.clearRound();
    this.round = round;
    this.elapsed = 0;
    this.trailClock = 0;
    const s = this.s;
    const order = [0, 1, 2].sort(() => Math.random() - 0.5);
    const typing = round.kind === 'typing';
    const entries: { text: string; slot: number }[] = typing ? [{ text: '', slot: 1 }] : round.answers.map((text, slot) => ({ text, slot }));
    this.meteors = entries.map(({ text: answer, slot }) => {
      const glow = this.add.image(0, 0, 'md-glow').setTint(COLORS.violet).setAlpha(0.45).setDepth(10).setBlendMode(Phaser.BlendModes.ADD);
      const rock = this.add.image(0, 0, `md-rock-${order[slot]}`).setDepth(11);
      const labelBg = this.add.graphics().setDepth(12);
      const label = this.add
        .text(0, 0, answer, {
          fontFamily: FONT,
          fontSize: `${this.fontPx}px`,
          fontStyle: 'bold',
          color: '#eef2ff',
          align: 'center',
          wordWrap: { width: 100, useAdvancedWrap: true },
          lineSpacing: 2 * s,
        })
        .setOrigin(0.5, 0)
        .setDepth(13);
      const hint = this.bridge.showKeyHints && !typing
        ? this.add
            .text(0, 0, String(slot + 1), {
              fontFamily: FONT,
              fontSize: `${11 * s}px`,
              fontStyle: 'bold',
              color: '#0b1030',
              backgroundColor: '#a5b4fc',
              padding: { x: 5 * s, y: 1 * s },
            })
            .setOrigin(0, 0.5)
            .setDepth(14)
        : null;
      const view: MeteorView = {
        slot,
        rock,
        glow,
        labelBg,
        label,
        hint,
        x: 0,
        y: 0,
        y0: 0,
        y1: 0,
        labelW: 0,
        labelH: 0,
        wobble: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 0.0012,
        alive: true,
        tone: 'normal',
        typing,
      };
      this.layoutMeteor(view);
      this.positionMeteor(view, 0);
      for (const obj of [rock, glow, labelBg, label, ...(hint ? [hint] : [])]) {
        obj.setAlpha(0);
        this.tweens.add({ targets: obj, alpha: obj === glow ? 0.45 : 1, duration: round.fastAdvance || typing ? 180 : 260, delay: typing ? 0 : slot * 70 });
      }
      return view;
    });
    this.updateTimer(1);
    this.state = 'flying';
    this.drawLanes();
  }

  clearRound(): void {
    for (const m of this.meteors) this.destroyMeteor(m);
    this.meteors = [];
    this.state = 'idle';
    this.round = null;
    this.updateTimer(1);
    this.drawLanes();
  }

  private destroyMeteor(m: MeteorView): void {
    for (const obj of [m.rock, m.glow, m.labelBg, m.label, m.hint]) {
      if (!obj) continue;
      this.tweens.killTweensOf(obj);
      obj.destroy();
    }
  }

  pauseGame(): void {
    if (this.paused) return;
    this.paused = true;
    this.scene.pause();
  }

  resumeGame(): void {
    if (!this.paused) return;
    this.paused = false;
    this.scene.resume();
  }

  update(_time: number, delta: number): void {
    const dt = Math.min(delta, 50);
    if (!this.bridge.reduceMotion) {
      for (const star of this.stars) {
        star.img.y += star.speed * dt * this.s;
        if (star.img.y > this.groundY) star.img.y = 0;
      }
    }
    if (this.paused || this.state !== 'flying' || !this.round) return;
    this.elapsed += dt;
    const p = Math.min(1, this.elapsed / this.round.durationMs);
    for (const m of this.meteors) {
      if (!m.alive) continue;
      this.positionMeteor(m, p);
      m.rock.rotation += m.spin * dt;
    }
    this.updateTimer(1 - p);
    this.trailClock += dt;
    if (this.trailClock > 45) {
      this.trailClock = 0;
      for (const m of this.meteors) if (m.alive) this.spawnTrail(m);
    }
    if (p >= 1) this.handleTimeout();
  }

  private updateTimer(remaining: number): void {
    const r = Math.max(0, Math.min(1, remaining));
    this.timerBar.scaleX = r;
    this.timerBar.setFillStyle(r > 0.5 ? COLORS.cyan : r > 0.25 ? COLORS.amber : COLORS.red, 0.95);
  }

  // ------------------------------------------------------------------ Eingabe

  private slotAt(x: number): number {
    return Math.max(0, Math.min(2, Math.floor(x / this.laneW)));
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.state !== 'flying' || this.paused || this.round?.kind === 'typing') return;
    this.bridge.sfx.unlock();
    this.shoot(this.slotAt(pointer.x));
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (this.state !== 'flying' || this.round?.kind === 'typing') return;
    const slot = pointer.y < this.groundY ? this.slotAt(pointer.x) : -1;
    if (slot === this.hoverSlot) return;
    this.hoverSlot = slot;
    for (const m of this.meteors) if (m.alive && m.tone !== 'correct' && m.tone !== 'wrong') this.drawLabel(m, m.slot === slot ? 'hover' : 'normal');
    this.drawLanes();
  }

  /** Verteidigungsstation feuert auf den Meteoriten in `slot`. */
  shoot(slot: number): void {
    if (this.state !== 'flying' || this.paused || this.round?.kind === 'typing') return;
    const target = this.meteors.find((m) => m.slot === slot && m.alive);
    if (!target) return;
    this.state = 'resolving';
    this.hoverSlot = -1;
    this.drawLanes();
    const result = this.bridge.callbacks.onShoot(slot, this.elapsed);
    const s = this.s;
    const bx = this.turretBarrel.x;
    const by = this.turretBarrel.y;
    const angle = Phaser.Math.Angle.Between(bx, by, target.rock.x, target.rock.y);
    this.turretBarrel.setRotation(angle + Math.PI / 2);
    const tipX = bx + Math.cos(angle) * 30 * s;
    const tipY = by + Math.sin(angle) * 30 * s;
    this.bridge.sfx.play('laser');

    const beam = this.add.graphics().setDepth(15).setBlendMode(Phaser.BlendModes.ADD);
    beam.lineStyle(12 * s, COLORS.cyan, 0.25);
    beam.lineBetween(tipX, tipY, target.rock.x, target.rock.y);
    beam.lineStyle(3.5 * s, COLORS.white, 0.95);
    beam.lineBetween(tipX, tipY, target.rock.x, target.rock.y);
    this.tweens.add({ targets: beam, alpha: 0, duration: 280, onComplete: () => beam.destroy() });
    const muzzle = this.add.image(tipX, tipY, 'md-glow').setTint(COLORS.cyan).setBlendMode(Phaser.BlendModes.ADD).setDepth(16);
    muzzle.setDisplaySize(40 * s, 40 * s);
    this.tweens.add({ targets: muzzle, alpha: 0, scale: muzzle.scale * 1.8, duration: 220, onComplete: () => muzzle.destroy() });

    this.time.delayedCall(120, () => {
      if (result.correct) {
        this.drawLabel(target, 'correct');
        this.explode(target, [COLORS.cyan, COLORS.violet, COLORS.white, COLORS.amber], 30);
        this.bridge.sfx.play('explosion');
        this.bridge.sfx.play('correct');
        for (const m of this.meteors) if (m !== target) this.dissolve(m);
        // Endlosmodus: die nächste Frage folgt praktisch sofort (die Explosion läuft weiter)
        this.time.delayedCall(this.round?.fastAdvance ? 260 : 750, () => this.finish());
      } else {
        this.drawLabel(target, 'wrong');
        target.rock.setTint(0xff8a8a);
        this.explode(target, [COLORS.red, 0xfca5a5, COLORS.white], 16);
        this.bridge.sfx.play('wrong');
        const correct = this.meteors.find((m) => m.slot === result.correctSlot);
        for (const m of this.meteors) if (m !== target && m !== correct) this.dissolve(m);
        if (correct) {
          this.drawLabel(correct, 'correct');
          this.pulse(correct);
          // Der richtige Meteorit trifft den Schild
          const startY = correct.y;
          const impactY = Math.max(startY, this.shieldYAt(correct.x) - correct.labelH - this.meteorR * 0.4);
          const anim = { p: 0 };
          this.tweens.add({
            targets: anim,
            p: 1,
            duration: 520,
            ease: 'Cubic.easeIn',
            onUpdate: () => this.positionMeteorAbsolute(correct, startY + (impactY - startY) * anim.p),
            onComplete: () => {
              this.impact(correct.x, this.shieldYAt(correct.x));
              this.time.delayedCall(650, () => this.finish());
            },
          });
        } else {
          this.time.delayedCall(700, () => this.finish());
        }
      }
    });
  }

  private positionMeteorAbsolute(m: MeteorView, y: number): void {
    const s = this.s;
    m.y = y;
    m.rock.setPosition(m.x, y);
    m.glow.setPosition(m.x, y - this.meteorR * 0.3);
    const top = y + this.meteorR + 6 * s;
    m.labelBg.setPosition(m.x, top);
    m.label.setPosition(m.x, top + 8 * s);
    m.hint?.setPosition(m.x - m.labelW / 2 + 2 * s, top - 2 * s);
  }

  roundElapsed(): number {
    return this.elapsed;
  }

  typingHit(): void {
    if (this.state !== 'flying' || this.round?.kind !== 'typing') return;
    const target = this.meteors[0];
    if (!target) return;
    this.state = 'resolving';
    const s = this.s;
    const bx = this.turretBarrel.x;
    const by = this.turretBarrel.y;
    const angle = Phaser.Math.Angle.Between(bx, by, target.rock.x, target.rock.y);
    this.turretBarrel.setRotation(angle + Math.PI / 2);
    const tipX = bx + Math.cos(angle) * 30 * s;
    const tipY = by + Math.sin(angle) * 30 * s;
    this.bridge.sfx.play('laser');
    const beam = this.add.graphics().setDepth(15).setBlendMode(Phaser.BlendModes.ADD);
    beam.lineStyle(12 * s, COLORS.cyan, 0.25);
    beam.lineBetween(tipX, tipY, target.rock.x, target.rock.y);
    beam.lineStyle(3.5 * s, COLORS.white, 0.95);
    beam.lineBetween(tipX, tipY, target.rock.x, target.rock.y);
    this.tweens.add({ targets: beam, alpha: 0, duration: 280, onComplete: () => beam.destroy() });
    this.time.delayedCall(100, () => {
      this.explode(target, [COLORS.cyan, COLORS.violet, COLORS.white, COLORS.amber], 30);
      this.bridge.sfx.play('explosion');
      this.bridge.sfx.play('correct');
      this.time.delayedCall(220, () => this.finish());
    });
  }

  typingMiss(): void {
    if (this.state !== 'flying' || this.round?.kind !== 'typing') return;
    const m = this.meteors[0];
    if (!m) return;
    this.bridge.sfx.play('wrong');
    m.rock.setTint(0xff8a8a);
    m.glow.setTint(COLORS.red);
    this.time.delayedCall(260, () => {
      if (!m.alive) return;
      m.rock.clearTint();
      m.glow.setTint(COLORS.violet);
    });
    this.shake(120, 0.003);
  }

  private handleTimeout(): void {
    if (this.state !== 'flying') return;
    this.state = 'resolving';
    const { correctSlot } = this.bridge.callbacks.onTimeout(this.round?.durationMs ?? this.elapsed);
    for (const m of this.meteors) {
      this.impact(m.x, this.shieldYAt(m.x), false);
      if (m.slot === correctSlot) {
        this.drawLabel(m, 'correct');
        this.pulse(m);
      } else {
        this.dissolve(m);
      }
    }
    this.bridge.sfx.play('impact');
    this.shake(260, 0.008);
    this.time.delayedCall(900, () => this.finish());
  }

  private finish(): void {
    if (this.state !== 'resolving') return;
    this.bridge.callbacks.onResolved();
  }

  // ------------------------------------------------------------------ Effekte

  private shake(duration: number, intensity: number): void {
    if (!this.bridge.reduceMotion) this.cameras.main.shake(duration, intensity);
  }

  private spawnTrail(m: MeteorView): void {
    const s = this.s;
    const p = this.add
      .image(m.rock.x + (Math.random() - 0.5) * this.meteorR * 0.9, m.rock.y - this.meteorR * 0.5, 'md-spark')
      .setTint(Math.random() < 0.5 ? COLORS.cyan : COLORS.violet)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(9)
      .setAlpha(0.85);
    p.setDisplaySize(this.meteorR * 0.7, this.meteorR * 0.7);
    this.tweens.add({
      targets: p,
      y: p.y - (24 + Math.random() * 30) * s,
      alpha: 0,
      scale: p.scale * 0.2,
      duration: 520,
      onComplete: () => p.destroy(),
    });
  }

  private explode(m: MeteorView, colors: number[], count: number): void {
    const s = this.s;
    m.alive = false;
    const { x, y } = m.rock;
    const flash = this.add.image(x, y, 'md-glow').setTint(colors[0]).setBlendMode(Phaser.BlendModes.ADD).setDepth(20);
    flash.setDisplaySize(this.meteorR * 3, this.meteorR * 3);
    this.tweens.add({ targets: flash, scale: flash.scale * 2.6, alpha: 0, duration: 420, ease: 'Cubic.easeOut', onComplete: () => flash.destroy() });
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = (40 + Math.random() * 70) * s;
      const spark = this.add.image(x, y, 'md-spark').setTint(colors[i % colors.length]).setBlendMode(Phaser.BlendModes.ADD).setDepth(21);
      spark.setDisplaySize((6 + Math.random() * 8) * s, (6 + Math.random() * 8) * s);
      this.tweens.add({
        targets: spark,
        x: x + Math.cos(angle) * dist,
        y: y + Math.sin(angle) * dist,
        alpha: 0,
        duration: 420 + Math.random() * 380,
        ease: 'Cubic.easeOut',
        onComplete: () => spark.destroy(),
      });
    }
    this.tweens.add({ targets: m.rock, alpha: 0, scale: m.rock.scale * 1.4, duration: 200 });
    this.tweens.add({ targets: m.glow, alpha: 0, duration: 200 });
    this.tweens.add({ targets: [m.label, m.labelBg, ...(m.hint ? [m.hint] : [])], alpha: 0, y: `-=${14 * s}`, duration: 650, delay: 250 });
    this.shake(160, 0.004);
  }

  private dissolve(m: MeteorView): void {
    m.alive = false;
    this.tweens.add({ targets: [m.rock, m.glow, m.label, m.labelBg, ...(m.hint ? [m.hint] : [])], alpha: 0.15, duration: 300 });
  }

  private pulse(m: MeteorView): void {
    const ring = this.add.image(m.rock.x, m.rock.y, 'md-glow').setTint(COLORS.green).setBlendMode(Phaser.BlendModes.ADD).setDepth(10);
    ring.setDisplaySize(this.meteorR * 4, this.meteorR * 4);
    this.tweens.add({ targets: ring, alpha: 0.2, duration: 380, yoyo: true, repeat: 2, onComplete: () => ring.destroy() });
  }

  private impact(x: number, y: number, shake = true): void {
    const s = this.s;
    const flash = this.add.image(x, y, 'md-glow').setTint(COLORS.cyan).setBlendMode(Phaser.BlendModes.ADD).setDepth(18);
    flash.setDisplaySize(90 * s, 40 * s);
    this.tweens.add({ targets: flash, scaleX: flash.scaleX * 2.4, alpha: 0, duration: 500, onComplete: () => flash.destroy() });
    const state = { f: 1 };
    this.tweens.add({
      targets: state,
      f: 0,
      duration: 600,
      onUpdate: () => this.drawShield(state.f),
    });
    if (shake) {
      this.bridge.sfx.play('impact');
      this.shake(240, 0.007);
    }
  }
}
