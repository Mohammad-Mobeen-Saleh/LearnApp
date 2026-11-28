import type { GameId, GameType } from '../domain/types.ts';

/**
 * Spiele der LernArcade. Jedes Spiel nutzt dieselben Lernpakete, Fragen, Spielereignisse
 * und Statistiken; Gestaltung, Steuerung und Einstellungen sind pro Spiel eigenständig.
 * Ein neues Spiel wird hier eingetragen und als eigene Seite unter /games/<id> eingebunden.
 */
export interface GameDefinition {
  id: GameId;
  name: string;
  tagline: string;
  description: string;
  /** Spiellogo (eigene visuelle Identität) */
  logo: string;
  /** CSS-Klasse für die Spielkarte */
  theme: string;
  /** Varianten, die in game_sessions.game_type gespeichert werden */
  variants: GameType[];
  controls: string;
}

export const GAMES: readonly GameDefinition[] = [
  {
    id: 'meteor-defense',
    name: 'Meteor Defense',
    tagline: 'Schiesse den richtigen Meteoriten ab',
    description: 'Drei Meteoriten tragen je eine Antwort. Abwehrmodus mit drei Antworten oder Tippmodus zum Eintippen.',
    logo: '/games/meteor-defense/logo.svg',
    theme: 'game-card-meteor',
    variants: ['defense', 'typing'],
    controls: 'Tippen, Klicken oder Tasten 1, 2, 3',
  },
  {
    id: 'snake',
    name: 'Snake',
    tagline: 'Friss die Frucht mit der richtigen Antwort',
    description: 'Steuere die Schlange zur richtigen von drei Antwortfrüchten. Eine falsche Frucht ist eine Bombe.',
    logo: '/games/snake/logo.svg',
    theme: 'game-card-snake',
    variants: ['snake'],
    controls: 'Pfeiltasten, WASD oder Wischen',
  },
];

export function getGame(id: string | null | undefined): GameDefinition | null {
  return GAMES.find((g) => g.id === id) ?? null;
}

export const GAME_IDS: readonly GameId[] = GAMES.map((g) => g.id);

/** Route eines Spiels, optional mit Lernpaket bzw. Wiederholung. */
export function gameRoute(id: GameId, options: { deckId?: string | null; repeat?: boolean } = {}): string {
  const params = new URLSearchParams();
  if (options.repeat) params.set('mode', 'repeat');
  else if (options.deckId) params.set('deck', options.deckId);
  const q = params.toString();
  return `/games/${id}${q ? `?${q}` : ''}`;
}
