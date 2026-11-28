/** Normalisiert Text für Vergleiche (Duplikaterkennung): Kleinschreibung, typografische Zeichen,
 *  Satzzeichen und Mehrfach-Leerzeichen werden vereinheitlicht. */
export function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('de')
    .replace(/[\u2018\u2019\u201a\u201b\u2032]/g, "'")
    .replace(/[\u201c\u201d\u201e\u2033]/g, '"')
    .replace(/ß/g, 'ss')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Entfernt überflüssige Leerzeichen, behält aber einzelne Zeilenumbrüche. */
export function tidyText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function formatPercent(ratio: number | null): string {
  if (ratio === null || Number.isNaN(ratio)) return 'keine Daten';
  return `${Math.round(ratio * 100)} %`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('de-CH').format(value);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return 'unbekannt';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unbekannt';
  return new Intl.DateTimeFormat('de-CH', { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

export function formatRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'noch nie';
  const diff = Math.round((now - new Date(iso).getTime()) / 1000);
  if (diff < 10) return 'gerade eben';
  if (diff < 60) return `vor ${diff} s`;
  if (diff < 3600) return `vor ${Math.round(diff / 60)} min`;
  if (diff < 86400) return `vor ${Math.round(diff / 3600)} h`;
  return formatDateTime(iso);
}
