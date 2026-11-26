/**
 * Aufteilung gemischter Texte (z. B. «حَدِيقَة (ḥadīqa)») in Abschnitte mit eigener Schreibrichtung.
 *
 * Jeder arabische Abschnitt wird später als eigenes Element mit dir="rtl" dargestellt,
 * jeder lateinische Abschnitt mit dir="ltr". So kann der Unicode-Bidi-Algorithmus Klammern
 * und Satzzeichen nicht mehr falsch zwischen den Schriften verschieben, und Vokalzeichen
 * (Harakat) bleiben an ihrem Buchstaben, weil ein arabisches Wort nie getrennt wird.
 * Der Text selbst wird nicht verändert (nur NFC-normalisiert für die Darstellung).
 */

export type TextDirection = 'rtl' | 'ltr';

export interface BidiSegment {
  text: string;
  dir: TextDirection;
}

/** Arabische Schrift inkl. Vokalzeichen, Präsentationsformen und arabisch-indischer Ziffern. */
const ARABIC = '\\u0600-\\u06FF\\u0750-\\u077F\\u0870-\\u089F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF';
/** Hebräisch wird genauso behandelt (rechts nach links). */
const HEBREW = '\\u0590-\\u05FF\\uFB1D-\\uFB4F';
const RTL_CHARS = `${ARABIC}${HEBREW}`;

/** Zeichen, die zwischen zwei RTL-Wörtern zum selben Abschnitt gehören (Leerzeichen, Verbinder, Satzzeichen). */
const RTL_JOINERS = '\\s\\u200C\\u200D\\u200F\\u060C\\u061B\\u061F\\u066B\\u066C\\u06D4.,!?:;\\-–';

const RTL_RUN = new RegExp(`[${RTL_CHARS}]+(?:[${RTL_JOINERS}]+[${RTL_CHARS}]+)*`, 'gu');
const HAS_RTL = new RegExp(`[${RTL_CHARS}]`, 'u');

export function containsRtl(text: string): boolean {
  return HAS_RTL.test(text);
}

/**
 * Zerlegt einen Text in RTL- und LTR-Abschnitte (Reihenfolge wie im Original).
 * Leerzeichen an den Grenzen fallen weg; der Abstand entsteht in der Darstellung.
 */
export function splitBidiSegments(input: string): BidiSegment[] {
  const text = input.normalize('NFC');
  if (!containsRtl(text)) {
    const trimmed = text.trim();
    return trimmed ? [{ text: trimmed, dir: 'ltr' }] : [];
  }
  const segments: BidiSegment[] = [];
  const push = (value: string, dir: TextDirection) => {
    const trimmed = value.trim();
    if (trimmed) segments.push({ text: trimmed, dir });
  };
  let last = 0;
  for (const match of text.matchAll(RTL_RUN)) {
    const start = match.index ?? 0;
    push(text.slice(last, start), 'ltr');
    push(match[0], 'rtl');
    last = start + match[0].length;
  }
  push(text.slice(last), 'ltr');
  return segments;
}

/** Schreibrichtung eines ganzen Textes für Absätze: die des ersten starken Zeichens. */
export function paragraphDirection(text: string): TextDirection {
  const first = splitBidiSegments(text)[0];
  return first?.dir ?? 'ltr';
}
