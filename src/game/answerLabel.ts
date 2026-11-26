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
   * Passt die Schriftgrösse an: so gross wie möglich (höchstens `fontPx`), bis der Text
   * innerhalb von `maxWidth` × `maxHeight` passt. Arabische Wörter werden nie mitten im Wort
   * getrennt; Arabisch und Umschrift dürfen auf zwei Zeilen stehen.
   */
  fit(fontPx: number, maxWidth: number, maxHeight: number): void {
    const el = this.el;
    el.style.maxWidth = `${Math.max(40, maxWidth)}px`;
    let size = Math.max(LABEL_MIN_FONT_PX, fontPx);
    for (;;) {
      el.style.fontSize = `${size}px`;
      const tooWide = el.scrollWidth > el.clientWidth + 1;
      const tooHigh = el.offsetHeight > maxHeight;
      if ((!tooWide && !tooHigh) || size <= LABEL_MIN_FONT_PX) break;
      size -= 1;
    }
    // Notlösung für extrem lange Einzelwörter: Umbruch innerhalb lateinischer Abschnitte erlauben
    el.classList.toggle('force-wrap', el.scrollWidth > el.clientWidth + 1);
    this.width = el.offsetWidth;
    this.height = el.offsetHeight;
  }

  setTone(tone: AnswerLabelTone): void {
    this.el.className = `answer-label tone-${tone}${this.el.classList.contains('force-wrap') ? ' force-wrap' : ''}`;
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
