import type { AnswerIndex, Difficulty, DraftQuestion } from '../domain/types.ts';
import { cleanDraft, parseCorrect, parseDifficulty, splitAcceptedAnswers, validateDraft } from './validate.ts';

/**
 * Parser für das Textformat:
 *
 *   Frage: Was versteht man unter einer funktionalen Anforderung?
 *   A) Eine Beschreibung einer Systemfunktion
 *   B) Eine Vorgabe zur Hardwareleistung
 *   C) Eine Beschreibung der Projektkosten
 *   Richtig: A
 *   Erklärung: Funktionale Anforderungen beschreiben die Funktionen eines Systems.
 *
 * Optional: «Schwierigkeit: leicht|mittel|schwer», «Kategorie: …» und für den Tippmodus
 * «Auch richtig: Zaster; Moneten» (weitere gültige Schreibweisen, getrennt mit ; oder |).
 * Mehrere Fragen werden nacheinander erkannt. Leerzeilen, Markdown-Fettschrift,
 * Aufzählungszeichen, Nummerierungen und Windows-Zeilenumbrüche werden toleriert.
 * Nicht erkannte Zeilen werden gemeldet und niemals stillschweigend übernommen.
 */

export interface ParsedItem {
  /** laufende Nummer in der Importquelle (1-basiert) */
  index: number;
  /** Zeile, in der die Frage beginnt (1-basiert); bei JSON die Position im Array (1-basiert) */
  line: number;
  draft: DraftQuestion | null;
  errors: string[];
  warnings: string[];
  preview: string;
}

type LineKind =
  | { kind: 'question'; text: string }
  | { kind: 'answer'; letter: string; text: string }
  | { kind: 'correct'; text: string }
  | { kind: 'explanation'; text: string }
  | { kind: 'difficulty'; text: string }
  | { kind: 'category'; text: string }
  | { kind: 'accepted'; text: string }
  | { kind: 'blank' }
  | { kind: 'text'; text: string };

const QUESTION_RE = /^(?:\d+\s*[.)]\s*)?(?:frage|question)\s*(?:nr\.?\s*)?(?:\d+)?\s*[:.)\-–]\s*(.*)$/i;
const ANSWER_RE = /^\(?([a-fA-F])\s*[).:\]]\s*(.*)$/;
const CORRECT_RE =
  /^(?:richtige\s+antwort|richtig|korrekte\s+antwort|korrekt|lösung|loesung|antwort|correct\s+answer|correct|answer|solution)\s*[:=]\s*(.*)$/i;
const EXPLANATION_RE = /^(?:erklärung|erklaerung|begründung|begruendung|hinweis|explanation)\s*[:=]\s*(.*)$/i;
const DIFFICULTY_RE = /^(?:schwierigkeitsgrad|schwierigkeit|niveau|difficulty|level)\s*[:=]\s*(.*)$/i;
const CATEGORY_RE = /^(?:kategorie|thema|category|topic)\s*[:=]\s*(.*)$/i;
const ACCEPTED_RE =
  /^(?:auch\s+richtig|ebenfalls\s+richtig|akzeptiert|weitere\s+antworten|alternativen?|accepted(?:\s+answers)?|also\s+correct)\s*[:=]\s*(.*)$/i;

/** Entfernt Markdown-Fettschrift, Aufzählungszeichen und Zitatzeichen. */
function stripDecorations(line: string): string {
  return line
    .replace(/\u00a0/g, ' ')
    .replace(/\*\*|__/g, '')
    .replace(/^\s*(?:[-*•>#]+\s*)+/, '')
    .trim();
}

function classify(rawLine: string): LineKind {
  const line = stripDecorations(rawLine);
  if (!line) return { kind: 'blank' };
  let m = QUESTION_RE.exec(line);
  if (m) return { kind: 'question', text: m[1] };
  m = ACCEPTED_RE.exec(line);
  if (m) return { kind: 'accepted', text: m[1] };
  m = CORRECT_RE.exec(line);
  if (m) return { kind: 'correct', text: m[1] };
  m = EXPLANATION_RE.exec(line);
  if (m) return { kind: 'explanation', text: m[1] };
  m = DIFFICULTY_RE.exec(line);
  if (m) return { kind: 'difficulty', text: m[1] };
  m = CATEGORY_RE.exec(line);
  if (m) return { kind: 'category', text: m[1] };
  m = ANSWER_RE.exec(line);
  if (m && m[2].trim()) return { kind: 'answer', letter: m[1].toUpperCase(), text: m[2] };
  return { kind: 'text', text: line };
}

interface Block {
  line: number;
  questionLines: string[];
  answers: { letter: string; text: string }[];
  correct: string | null;
  explanationLines: string[];
  difficulty: string | null;
  category: string | null;
  accepted: string[];
  state: 'question' | 'answers' | 'meta' | 'explanation';
  warnings: string[];
}

function newBlock(line: number, firstText: string): Block {
  return {
    line,
    questionLines: firstText.trim() ? [firstText.trim()] : [],
    answers: [],
    correct: null,
    explanationLines: [],
    difficulty: null,
    category: null,
    accepted: [],
    state: 'question',
    warnings: [],
  };
}

const short = (text: string) => (text.length > 60 ? `${text.slice(0, 60)}…` : text);

export function parseQuestionText(input: string): ParsedItem[] {
  const lines = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const kinds = lines.map(classify);
  const blocks: Block[] = [];
  const orphans: ParsedItem[] = [];
  let block: Block | null = null;

  /** Beginnt in Zeile i eine Frage ohne «Frage:»-Präfix? (Text, danach «A)») */
  const startsImplicitQuestion = (i: number): boolean => {
    let textLines = 0;
    for (let j = i + 1; j < kinds.length; j++) {
      const k = kinds[j];
      if (k.kind === 'blank') continue;
      if (k.kind === 'answer') return k.letter === 'A';
      if (k.kind === 'text' && textLines < 4) {
        textLines += 1;
        continue;
      }
      return false;
    }
    return false;
  };

  for (let i = 0; i < kinds.length; i++) {
    const k = kinds[i];
    const lineNo = i + 1;

    if (k.kind === 'question') {
      block = newBlock(lineNo, k.text);
      blocks.push(block);
      continue;
    }
    if (k.kind === 'blank') continue;

    const current: Block | null = block;
    if (!current) {
      if (k.kind === 'text' && startsImplicitQuestion(i)) {
        block = newBlock(lineNo, k.text);
        blocks.push(block);
      } else {
        const text = lines[i].trim();
        orphans.push({
          index: 0,
          line: lineNo,
          draft: null,
          errors: [`Zeile ${lineNo} gehört zu keiner Frage: «${short(text)}». Jede Frage beginnt mit «Frage:».`],
          warnings: [],
          preview: text.slice(0, 120),
        });
      }
      continue;
    }

    switch (k.kind) {
      case 'answer':
        if (current.state === 'question' || current.state === 'answers') {
          current.answers.push({ letter: k.letter, text: k.text });
          current.state = 'answers';
        } else if (current.state === 'explanation') {
          current.explanationLines.push(stripDecorations(lines[i]));
        } else {
          current.warnings.push(`Zeile ${lineNo} nach der Lösung wurde ignoriert: «${short(lines[i].trim())}»`);
        }
        break;
      case 'correct':
        if (current.correct !== null) current.warnings.push(`Zeile ${lineNo}: Lösung doppelt angegeben, die erste wird verwendet.`);
        else current.correct = k.text;
        current.state = 'meta';
        break;
      case 'explanation':
        current.explanationLines = k.text.trim() ? [k.text.trim()] : [];
        current.state = 'explanation';
        break;
      case 'difficulty':
        current.difficulty = k.text;
        current.state = 'meta';
        break;
      case 'category':
        current.category = k.text;
        current.state = 'meta';
        break;
      case 'accepted':
        current.accepted.push(...splitAcceptedAnswers(k.text));
        current.state = 'meta';
        break;
      case 'text':
        if (current.state === 'question') {
          current.questionLines.push(k.text);
        } else if (current.state === 'answers') {
          // umbrochene Antwort: an die letzte Antwort anhängen
          const last = current.answers[current.answers.length - 1];
          last.text = `${last.text} ${k.text}`;
        } else if (startsImplicitQuestion(i)) {
          block = newBlock(lineNo, k.text);
          blocks.push(block);
        } else if (current.state === 'explanation') {
          current.explanationLines.push(k.text);
        } else if (current.explanationLines.length === 0) {
          current.explanationLines.push(k.text);
          current.state = 'explanation';
          current.warnings.push(`Zeile ${lineNo} wurde als Erklärung übernommen.`);
        } else {
          current.warnings.push(`Zeile ${lineNo} wurde ignoriert: «${short(lines[i].trim())}»`);
        }
        break;
    }
  }

  const items = [...orphans, ...blocks.map((b) => blockToItem(b))].sort((a, b) => a.line - b.line);
  return items.map((it, i) => ({ ...it, index: i + 1 }));
}

function blockToItem(b: Block): ParsedItem {
  const errors: string[] = [];
  const warnings = [...b.warnings];
  const question = b.questionLines.join('\n').trim();
  const letters = b.answers.map((a) => a.letter);

  // Struktur: genau drei Antworten A, B, C
  if (b.answers.length !== 3) {
    errors.push(
      b.answers.length > 3
        ? `Genau 3 Antworten (A bis C) erwartet, gefunden: ${b.answers.length} (${letters.join(', ')}).`
        : `Genau 3 Antworten (A bis C) erforderlich, gefunden: ${b.answers.length}.`,
    );
  } else if (new Set(letters).size !== 3) {
    errors.push(`Antwortbuchstaben doppelt vergeben (${letters.join(', ')}).`);
  } else if (!letters.every((l) => ['A', 'B', 'C'].includes(l))) {
    errors.push(`Antworten müssen mit A), B) und C) beginnen (gefunden: ${letters.join(', ')}).`);
  }
  // Antworten in die Reihenfolge A, B, C bringen
  const ordered = [...b.answers].sort((x, y) => x.letter.localeCompare(y.letter));
  const answerTexts = ordered.slice(0, 3).map((a) => a.text.trim());

  // Lösung
  let correctIndex: AnswerIndex | null = null;
  if (b.correct === null) {
    errors.push('Die richtige Antwort fehlt (z. B. «Richtig: A»).');
  } else {
    const raw = b.correct.trim();
    if (/^\(?[d-z](?:\s*[).:\]]|\s*$)/i.test(raw) && raw.length <= 3) {
      errors.push(`«Richtig: ${raw}» verweist auf eine nicht vorhandene Antwort (nur A, B oder C).`);
    } else {
      correctIndex = parseCorrect(raw, answerTexts);
      if (correctIndex === null) errors.push(`Die Lösung «${short(raw)}» passt zu keiner Antwort (A, B oder C).`);
    }
  }

  let difficulty: Difficulty = 2;
  if (b.difficulty !== null) {
    const parsed = parseDifficulty(b.difficulty);
    if (parsed) difficulty = parsed;
    else warnings.push(`Unbekannte Schwierigkeit «${b.difficulty.trim()}». Es wird «mittel» verwendet.`);
  }

  const candidate: Partial<DraftQuestion> = {
    question,
    answers: answerTexts as DraftQuestion['answers'],
    correctIndex: correctIndex ?? undefined,
    explanation: b.explanationLines.join('\n').trim(),
    difficulty,
    category: (b.category ?? '').trim(),
    ...(b.accepted.length ? { acceptedAnswers: b.accepted } : {}),
  };
  const validation = validateDraft(candidate, { skipStructure: true });
  errors.push(...validation.errors);
  warnings.push(...validation.warnings);

  return {
    index: 0,
    line: b.line,
    draft: errors.length === 0 ? cleanDraft(candidate as DraftQuestion) : null,
    errors,
    warnings,
    preview: (question || answerTexts[0] || '(ohne Fragetext)').slice(0, 120),
  };
}

/** Beispieltext für die Import-Seite. */
export const SAMPLE_IMPORT_TEXT = `Frage: Was versteht man unter einer funktionalen Anforderung?
A) Eine Beschreibung einer Systemfunktion
B) Eine Vorgabe zur Hardwareleistung
C) Eine Beschreibung der Projektkosten
Richtig: A
Erklärung: Funktionale Anforderungen beschreiben die Funktionen eines Systems.

Frage: Welche Aussage beschreibt eine nichtfunktionale Anforderung?
A) Der Kunde kann eine Bestellung stornieren.
B) Die Suche liefert Ergebnisse in unter 2 Sekunden.
C) Das System versendet eine Rechnung per E-Mail.
Richtig: B
Erklärung: Nichtfunktionale Anforderungen beschreiben Qualitätseigenschaften wie Leistung oder Sicherheit.
Schwierigkeit: mittel
Kategorie: Requirements Engineering`;
