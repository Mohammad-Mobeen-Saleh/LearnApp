import { splitBidiSegments } from '../lib/bidi.ts';

/**
 * Antwortbeschriftung eines Meteoriten als HTML-Element über dem Spielfeld.
 *
 * Phaser zeichnet Text in eine Canvas-Textur und misst die Höhe anhand lateinischer
 * Referenzzeichen. Arabische Vokalzeichen (oberhalb/unterhalb der Grundlinie) und
 * Umschrift-Zeichen wie «ḥ» werden dabei abgeschnitten, und gemischte Schreibrichtungen
 * werden falsch angeordnet. Der Browser beherrscht beides korrekt – deshalb liegen die
 * Beschriftungen als HTML über der Canvas und folgen den Meteoriten Bild für Bild.
 *
 * Koordinaten werden in CSS-Pixeln übergeben (Spielkoordinaten ÷ Pixeldichte).
 */

export type AnswerLabelTone = 'normal' | 'hover' | 'correct' | 'wrong';

export const LABEL_MIN_FONT_PX = 11;

export class AnswerLabel {
  readonly el: HTMLDivElement;
  private readonly hintEl: HTMLSpanElement | null;
  private _x = 0;
  private _y = 0;
  private _alpha = 1;
  private _visible = true;
  /** Breite/Höhe in CSS-Pixeln (nach fit()) */
  width = 0;
  height = 0;

  constructor(layer: HTMLElement, text: string, options: { hint?: string } = {}) {
    const el = document.createElement('div');
    el.className = 'answer-label tone-normal';
    el.setAttribute('aria-hidden', 'true');
    // Absatzrichtung LTR: Abschnitte stehen in Originalreihenfolge nebeneinander,
    // jeder Abschnitt hat seine eigene, isolierte Schreibrichtung.
    el.dir = 'ltr';
    for (const segment of splitBidiSegments(text)) {
      const span = document.createElement('span');
      span.className = segment.dir === 'rtl' ? 'seg seg-rtl' : 'seg seg-ltr';
      span.dir = segment.dir;
      if (segment.dir === 'rtl') span.lang = 'ar';
      // Umbruch nur zwischen Wörtern, nie innerhalb (auch nicht am Bindestrich wie in «bi-ǧiwār»)
      segment.text.split(/(\s+)/).forEach((part) => {
        if (!part) return;
        if (/^\s+$/.test(part)) {
          span.appendChild(document.createTextNode(' '));
        } else {
          const word = document.createElement('span');
          word.className = 'word';
          word.textContent = part;
          span.appendChild(word);
        }
      });
      el.appendChild(span);
    }
    if (options.hint) {
      const hint = document.createElement('span');
      hint.className = 'key-hint';
      hint.textContent = options.hint;
      el.appendChild(hint);
      this.hintEl = hint;
    } else {
      this.hintEl = null;
    }
    layer.appendChild(el);
    this.el = el;
    this.apply();
  }

  /**
   * Wählt die Darstellung, die am besten lesbar ist, und misst sie explizit aus
   * (die automatische Breitenberechnung des Browsers für umbrechende Zeilen ist unzuverlässig
   * und hat dazu geführt, dass jedes Wort auf einer eigenen Zeile stand).
   *
   * Reihenfolge je Schriftgrösse (von `fontPx` abwärts):
   *  1. alles auf einer Zeile
   *  2. jeder Abschnitt auf einer eigenen Zeile (Arabisch oben, Umschrift darunter)
   *  3. Umbruch zwischen Wörtern
   * Zuerst mit höchstens zwei Zeilen und nur leicht kleinerer Schrift, danach mit bis zu drei
   * Zeilen. Arabische Wörter werden nie getrennt.
   */
  fit(fontPx: number, maxWidth: number, maxHeight: number): void {
    const el = this.el;
    const limitW = Math.max(40, Math.floor(maxWidth));
    const largest = Math.max(LABEL_MIN_FONT_PX, Math.round(fontPx));
    const segments = el.querySelectorAll('.seg').length;
    el.classList.remove('force-wrap');
    el.style.maxWidth = '';

    const measure = (size: number, layout: 'line' | 'stack' | 'wrap') => {
      el.style.fontSize = `${size}px`;
      el.dataset.layout = layout;
      el.style.width = layout === 'wrap' ? `${limitW}px` : 'max-content';
      const rect = el.getBoundingClientRect();
      return { w: rect.width, h: rect.height };
    };
    const accept = (layout: 'line' | 'stack' | 'wrap') => {
      if (layout === 'wrap') this.tightenWidth(limitW);
      const rect = el.getBoundingClientRect();
      this.width = rect.width;
      this.height = rect.height;
    };

    // Durchgang 1: höchstens zwei Zeilen, Schrift nur leicht verkleinern
    // Durchgang 2: bis zu drei Zeilen (z. B. Arabisch + zweizeilige Umschrift) statt winziger Schrift
    const passes: { rows: number; smallest: number }[] = [
      { rows: 2, smallest: Math.max(LABEL_MIN_FONT_PX, Math.min(13, largest - 2)) },
      { rows: 3, smallest: LABEL_MIN_FONT_PX },
    ];
    for (const pass of passes) {
      for (let size = largest; size >= pass.smallest; size--) {
        const line = measure(size, 'line');
        if (line.w <= limitW && line.h <= maxHeight) return accept('line');
        if (segments > 1 && segments <= pass.rows) {
          const stack = measure(size, 'stack');
          if (stack.w <= limitW && stack.h <= maxHeight) return accept('stack');
        }
        const wrap = measure(size, 'wrap');
        if (this.rowCount(size) <= pass.rows && wrap.h <= maxHeight && el.scrollWidth <= el.clientWidth + 1) return accept('wrap');
      }
    }
    // Kleinste Schrift: beliebig viele Zeilen; sehr lange Einzelwörter (nur Lateinisch) notfalls trennen
    measure(LABEL_MIN_FONT_PX, 'wrap');
    if (el.scrollWidth > el.clientWidth + 1) el.classList.add('force-wrap');
    accept('wrap');
  }

  /** Anzahl Textzeilen (Wörter mit ähnlicher vertikaler Mitte bilden eine Zeile). */
  private rowCount(fontPx: number): number {
    const centers = [...this.el.querySelectorAll('.word')]
      .map((w) => {
        const r = w.getBoundingClientRect();
        return r.top + r.height / 2;
      })
      .sort((a, b) => a - b);
    let rows = 0;
    let last = -Infinity;
    for (const c of centers) {
      if (c - last > fontPx * 0.7) rows += 1;
      last = c;
    }
    return Math.max(1, rows);
  }

  /** Nach dem Umbruch die Fläche auf die tatsächlich benötigte Breite verkleinern. */
  private tightenWidth(limitW: number): void {
    const el = this.el;
    const words = [...el.querySelectorAll('.word')].map((w) => w.getBoundingClientRect());
    if (!words.length) return;
    const left = Math.min(...words.map((r) => r.left));
    const right = Math.max(...words.map((r) => r.right));
    const style = getComputedStyle(el);
    const chrome = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
    const needed = Math.ceil(right - left + chrome + 2);
    if (needed < limitW) el.style.width = `${needed}px`;
  }

  setTone(tone: AnswerLabelTone): void {
    for (const t of ['normal', 'hover', 'correct', 'wrong']) this.el.classList.toggle(`tone-${t}`, t === tone);
  }

  // Eigenschaften mit Settern, damit Phaser-Tweens das Element direkt animieren können
  get x(): number {
    return this._x;
  }
  set x(v: number) {
    this._x = v;
    this.apply();
  }
  get y(): number {
    return this._y;
  }
  set y(v: number) {
    this._y = v;
    this.apply();
  }
  get alpha(): number {
    return this._alpha;
  }
  set alpha(v: number) {
    this._alpha = v;
    this.el.style.opacity = String(Math.max(0, Math.min(1, v)));
  }

  setPosition(x: number, y: number): this {
    this._x = x;
    this._y = y;
    this.apply();
    return this;
  }

  setAlpha(v: number): this {
    this.alpha = v;
    return this;
  }

  setVisible(visible: boolean): this {
    this._visible = visible;
    this.el.style.visibility = visible ? '' : 'hidden';
    return this;
  }

  get visible(): boolean {
    return this._visible;
  }

  get hasHint(): boolean {
    return this.hintEl !== null;
  }

  private apply(): void {
    // x = horizontale Mitte, y = Oberkante
    this.el.style.transform = `translate3d(${this._x.toFixed(1)}px, ${this._y.toFixed(1)}px, 0) translateX(-50%)`;
  }

  destroy(): void {
    this.el.remove();
  }
}
