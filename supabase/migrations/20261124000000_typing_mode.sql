-- =====================================================================================
-- Meteor Defense – Erweiterung für den Tippmodus
-- =====================================================================================
--  * questions.accepted_answers: weitere gültige Schreibweisen/Übersetzungen (optional)
--  * game_sessions.game_type:    'defense' (Abwehrmodus) oder 'typing' (Tippmodus),
--                                getrennte Statistiken je Spielmodus
-- Bestehende Daten bleiben unverändert (Standardwerte: leere Liste bzw. 'defense').
-- Ausführen NACH 20261123000000_meteor_defense_schema.sql. Wiederholbar.
-- =====================================================================================

alter table public.questions
  add column if not exists accepted_answers text[] not null default '{}'::text[];

alter table public.game_sessions
  add column if not exists game_type text not null default 'defense';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'questions_accepted_answers_check') then
    alter table public.questions add constraint questions_accepted_answers_check
      check (cardinality(accepted_answers) <= 20 and array_position(accepted_answers, null) is null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'game_sessions_game_type_check') then
    alter table public.game_sessions add constraint game_sessions_game_type_check
      check (game_type in ('defense', 'typing'));
  end if;
end;
$$;

-- Synchronisierung: apply_change kennt die neuen Spalten (sonst unverändert)
create or replace function app_private.apply_change(
  p_uid uuid,
  p_device_id text,
  p_known_seq bigint,
  p_change jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_collection text := p_change ->> 'collection';
  v_id         uuid := (p_change ->> 'id')::uuid;
  v_base       integer := coalesce((p_change ->> 'base_version')::integer, 0);
  v_data       jsonb := coalesce(p_change -> 'data', '{}'::jsonb);
  v_deleted    boolean := coalesce((v_data ->> 'deleted')::boolean, false);
  v_created    timestamptz := coalesce((v_data ->> 'created_at')::timestamptz, now());
  v_current    jsonb;
  v_version    integer;
  v_seq        bigint;
  v_deck_deleted boolean;
  -- ältere App-Versionen senden kein accepted_answers: dann bleibt die Liste leer
  v_accepted   text[] := case when jsonb_typeof(v_data -> 'accepted_answers') = 'array'
                              then array(select jsonb_array_elements_text(v_data -> 'accepted_answers'))
                              else '{}'::text[] end;
begin
  if v_id is null then
    raise exception 'id fehlt' using errcode = '22023';
  end if;
  if jsonb_typeof(v_data) <> 'object' then
    raise exception 'data muss ein Objekt sein' using errcode = '22023';
  end if;

  -- ---------------------------------------------------------------- Lernpakete
  if v_collection = 'decks' then
    select to_jsonb(d) into v_current from public.decks d
     where d.user_id = p_uid and d.id = v_id for update;

    if v_current is null then
      insert into public.decks (user_id, id, name, description, deleted, device_id, created_at)
      values (p_uid, v_id, v_data ->> 'name', coalesce(v_data ->> 'description', ''), v_deleted, p_device_id, v_created)
      returning version, server_seq into v_version, v_seq;
    else
      if (v_current ->> 'version')::integer <> v_base then
        return jsonb_build_object('collection', v_collection, 'id', v_id, 'status', 'conflict',
                                  'reason', 'version_mismatch', 'record', v_current);
      end if;
      -- Löschen nur, wenn das Gerät alle neueren Fragen-Änderungen anderer Geräte kennt
      if v_deleted and not (v_current ->> 'deleted')::boolean and exists (
           select 1 from public.questions q
            where q.user_id = p_uid and q.deck_id = v_id
              and q.server_seq > p_known_seq
              and q.device_id is distinct from p_device_id) then
        return jsonb_build_object('collection', v_collection, 'id', v_id, 'status', 'conflict',
                                  'reason', 'deck_changed', 'record', v_current);
      end if;
      update public.decks d
         set name = v_data ->> 'name',
             description = coalesce(v_data ->> 'description', ''),
             deleted = v_deleted,
             device_id = p_device_id
       where d.user_id = p_uid and d.id = v_id
      returning version, server_seq into v_version, v_seq;
    end if;

  -- ---------------------------------------------------------------- Fragen
  elsif v_collection = 'questions' then
    select to_jsonb(q) into v_current from public.questions q
     where q.user_id = p_uid and q.id = v_id for update;

    -- Keine neuen Inhalte in ein Lernpaket schreiben, das ein anderes Gerät gelöscht hat
    if not v_deleted then
      select d.deleted into v_deck_deleted from public.decks d
       where d.user_id = p_uid and d.id = (v_data ->> 'deck_id')::uuid;
      if coalesce(v_deck_deleted, false) then
        return jsonb_build_object('collection', v_collection, 'id', v_id, 'status', 'conflict',
                                  'reason', 'deck_deleted', 'record', v_current);
      end if;
    end if;

    if v_current is null then
      insert into public.questions (user_id, id, deck_id, question, answers, correct_index,
                                    explanation, difficulty, category, accepted_answers, deleted, device_id, created_at)
      values (p_uid, v_id, (v_data ->> 'deck_id')::uuid, v_data ->> 'question',
              array(select jsonb_array_elements_text(v_data -> 'answers')),
              (v_data ->> 'correct_index')::smallint,
              coalesce(v_data ->> 'explanation', ''),
              coalesce((v_data ->> 'difficulty')::smallint, 2),
              coalesce(v_data ->> 'category', ''),
              v_accepted,
              v_deleted, p_device_id, v_created)
      returning version, server_seq into v_version, v_seq;
    else
      if (v_current ->> 'version')::integer <> v_base then
        return jsonb_build_object('collection', v_collection, 'id', v_id, 'status', 'conflict',
                                  'reason', 'version_mismatch', 'record', v_current);
      end if;
      update public.questions q
         set deck_id = (v_data ->> 'deck_id')::uuid,
             question = v_data ->> 'question',
             answers = array(select jsonb_array_elements_text(v_data -> 'answers')),
             correct_index = (v_data ->> 'correct_index')::smallint,
             explanation = coalesce(v_data ->> 'explanation', ''),
             difficulty = coalesce((v_data ->> 'difficulty')::smallint, 2),
             category = coalesce(v_data ->> 'category', ''),
             accepted_answers = v_accepted,
             deleted = v_deleted,
             device_id = p_device_id
       where q.user_id = p_uid and q.id = v_id
      returning version, server_seq into v_version, v_seq;
    end if;

  -- ---------------------------------------------------------------- Einstellungen
  elsif v_collection = 'user_settings' then
    select to_jsonb(s) into v_current from public.user_settings s
     where s.user_id = p_uid and s.id = v_id for update;

    if v_current is null then
      insert into public.user_settings (user_id, id, data, deleted, device_id, created_at)
      values (p_uid, v_id, coalesce(v_data -> 'data', '{}'::jsonb), v_deleted, p_device_id, v_created)
      returning version, server_seq into v_version, v_seq;
    else
      if (v_current ->> 'version')::integer <> v_base then
        return jsonb_build_object('collection', v_collection, 'id', v_id, 'status', 'conflict',
                                  'reason', 'version_mismatch', 'record', v_current);
      end if;
      update public.user_settings s
         set data = coalesce(v_data -> 'data', '{}'::jsonb),
             deleted = v_deleted,
             device_id = p_device_id
       where s.user_id = p_uid and s.id = v_id
      returning version, server_seq into v_version, v_seq;
    end if;

  -- ---------------------------------------------------------------- Konflikte
  elsif v_collection = 'sync_conflicts' then
    select to_jsonb(c) into v_current from public.sync_conflicts c
     where c.user_id = p_uid and c.id = v_id for update;

    if v_current is null then
      insert into public.sync_conflicts (user_id, id, collection, record_id, reason, local_data, remote_data,
                                         device_label, resolved, resolution, deleted, device_id, created_at)
      values (p_uid, v_id, v_data ->> 'collection', (v_data ->> 'record_id')::uuid, v_data ->> 'reason',
              v_data -> 'local_data', v_data -> 'remote_data', coalesce(v_data ->> 'device_label', ''),
              coalesce((v_data ->> 'resolved')::boolean, false), v_data ->> 'resolution',
              v_deleted, p_device_id, v_created)
      returning version, server_seq into v_version, v_seq;
    else
      if (v_current ->> 'version')::integer <> v_base then
        return jsonb_build_object('collection', v_collection, 'id', v_id, 'status', 'conflict',
                                  'reason', 'version_mismatch', 'record', v_current);
      end if;
      update public.sync_conflicts c
         set resolved = coalesce((v_data ->> 'resolved')::boolean, false),
             resolution = v_data ->> 'resolution',
             deleted = v_deleted,
             device_id = p_device_id
       where c.user_id = p_uid and c.id = v_id
      returning version, server_seq into v_version, v_seq;
    end if;

  -- ---------------------------------------------------------------- Spiele (nur anfügen)
  elsif v_collection = 'game_sessions' then
    insert into public.game_sessions (user_id, id, deck_id, mode, game_type, score, rounds, correct_count, wrong_count,
                                      max_streak, started_at, ended_at, device_id)
    values (p_uid, v_id, (v_data ->> 'deck_id')::uuid, coalesce(v_data ->> 'mode', 'normal'),
            coalesce(v_data ->> 'game_type', 'defense'),
            (v_data ->> 'score')::integer, (v_data ->> 'rounds')::integer,
            (v_data ->> 'correct_count')::integer, (v_data ->> 'wrong_count')::integer,
            coalesce((v_data ->> 'max_streak')::integer, 0),
            (v_data ->> 'started_at')::timestamptz, (v_data ->> 'ended_at')::timestamptz, p_device_id)
    on conflict (user_id, id) do nothing
    returning version, server_seq into v_version, v_seq;
    if v_version is null then
      -- bereits vorhanden (z. B. erneuter Versand nach Verbindungsabbruch): kein Duplikat
      select g.version, g.server_seq into v_version, v_seq from public.game_sessions g
       where g.user_id = p_uid and g.id = v_id;
    end if;

  -- ---------------------------------------------------------------- Antworten (nur anfügen)
  elsif v_collection = 'answer_events' then
    insert into public.answer_events (user_id, id, session_id, deck_id, question_id, outcome, points,
                                      response_ms, answered_at, device_id)
    values (p_uid, v_id, (v_data ->> 'session_id')::uuid, (v_data ->> 'deck_id')::uuid,
            (v_data ->> 'question_id')::uuid, v_data ->> 'outcome',
            coalesce((v_data ->> 'points')::integer, 0), coalesce((v_data ->> 'response_ms')::integer, 0),
            (v_data ->> 'answered_at')::timestamptz, p_device_id)
    on conflict (user_id, id) do nothing
    returning version, server_seq into v_version, v_seq;
    if v_version is null then
      select a.version, a.server_seq into v_version, v_seq from public.answer_events a
       where a.user_id = p_uid and a.id = v_id;
    end if;

  else
    raise exception 'Unbekannte Sammlung: %', v_collection using errcode = '22023';
  end if;

  return jsonb_build_object('collection', v_collection, 'id', v_id, 'status', 'applied',
                            'version', v_version, 'server_seq', v_seq);
end;
$$;
revoke all on function app_private.apply_change(uuid, text, bigint, jsonb) from public, anon;
grant execute on function app_private.apply_change(uuid, text, bigint, jsonb) to authenticated;
