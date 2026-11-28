import { useCallback, useSyncExternalStore } from 'react';

/**
 * Gemeinsame Lernpaket-Auswahl aller Spiele. Das gewählte Paket bleibt erhalten, wenn der
 * Benutzer das Spiel wechselt (gespeichert pro Gerät, nicht synchronisiert).
 */
const KEY = 'lernarcade:selectedDeck';
const listeners = new Set<() => void>();

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

let current: string | null = typeof window === 'undefined' ? null : read();

export function getSelectedDeck(): string | null {
  return current;
}

export function setSelectedDeck(deckId: string | null): void {
  if (deckId === current) return;
  current = deckId;
  try {
    if (deckId) localStorage.setItem(KEY, deckId);
    else localStorage.removeItem(KEY);
  } catch {
    /* privater Modus: Auswahl gilt nur für diese Sitzung */
  }
  for (const l of [...listeners]) l();
}

export function useSelectedDeck(): [string | null, (deckId: string | null) => void] {
  const value = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getSelectedDeck,
  );
  const set = useCallback((deckId: string | null) => setSelectedDeck(deckId), []);
  return [value, set];
}
