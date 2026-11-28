-- =====================================================================================
-- LernArcade: weitere Spiele in game_sessions.game_type erlauben
-- =====================================================================================
--  * 'snake' für das Spiel Snake (bisher nur 'defense' und 'typing' für Meteor Defense).
--  * Keine neuen Tabellen oder Spalten. Bestehende Daten bleiben unverändert.
--  * Snake-Einstellungen liegen im bestehenden JSON-Feld user_settings.data.
-- Ausführen NACH 20261124000000_typing_mode.sql. Wiederholbar.
-- =====================================================================================

alter table public.game_sessions drop constraint if exists game_sessions_game_type_check;
alter table public.game_sessions add constraint game_sessions_game_type_check
  check (game_type in ('defense', 'typing', 'snake'));
