-- =====================================================================================
-- Meteor Defense – Datenbankschema für die geräteübergreifende Synchronisierung
-- =====================================================================================
--
-- Prinzip (siehe README «Sichere Synchronisierung»):
--   * Jeder Datensatz hat eine vom Client erzeugte UUID (stabil auf allen Geräten).
--   * Primärschlüssel ist (user_id, id) – jeder Benutzer hat seinen eigenen Namensraum.
--   * version   : wird bei jeder Änderung um 1 erhöht (optimistische Sperre).
--   * server_seq: fortlaufender Zähler pro Benutzer. Geräte holen «alles nach Zähler X».
--   * deleted   : Löschmarker (Tombstone). Zeilen werden nie physisch gelöscht, damit
--                 veraltete Offline-Kopien gelöschte Inhalte nicht wiederherstellen.
--   * Änderungen werden nur über push_changes() geschrieben: Passt die Basisversion des
--     Geräts nicht zur Server-Version, wird nichts überschrieben, sondern ein Konflikt
--     gemeldet. Spielereignisse sind unveränderlich (nur anfügen).
--   * Row Level Security: Jeder Benutzer sieht und ändert ausschliesslich eigene Zeilen.
--
-- Ausführen: Supabase-Dashboard → SQL Editor → Inhalt einfügen → Run
--            oder mit der Supabase CLI: supabase db push
-- Die Migration ist wiederholbar (idempotent) geschrieben.
-- =====================================================================================

create schema if not exists app_private;
revoke all on schema app_private from public;
grant usage on schema app_private to authenticated;

-- -------------------------------------------------------------------------------------
-- Fortlaufender Zähler pro Benutzer
-- -------------------------------------------------------------------------------------
create table if not exists app_private.sync_state (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  last_seq bigint not null default 0
);
revoke all on table app_private.sync_state from public, anon, authenticated;

-- Die Zeilensperre auf sync_state bleibt bis zum Ende der Transaktion bestehen. Dadurch
-- werden Schreibvorgänge eines Benutzers serialisiert: Ein höherer Zähler wird immer erst
-- nach allen niedrigeren sichtbar – kein Gerät verpasst beim Abruf eine Änderung.
create or replace function app_private.next_server_seq()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_seq bigint;
begin
  if v_uid is null then
    raise exception 'Nicht angemeldet' using errcode = '42501';
  end if;
  insert into app_private.sync_state as s (user_id, last_seq)
  values (v_uid, 1)
  on conflict (user_id) do update set last_seq = s.last_seq + 1
  returning s.last_seq into v_seq;
  return v_seq;
end;
$$;
revoke all on function app_private.next_server_seq() from public, anon, authenticated;

-- Gemeinsamer Trigger: setzt Version, Zähler und Zeitstempel serverseitig
create or replace function app_private.tg_sync_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.user_id := coalesce(new.user_id, auth.uid());
    new.version := 1;
    new.created_at := coalesce(new.created_at, now());
  else
    new.user_id := old.user_id;
    new.id := old.id;
    new.created_at := old.created_at;
    new.version := old.version + 1;
  end if;
  new.updated_at := now();
  new.server_seq := app_private.next_server_seq();
  return new;
end;
$$;
revoke all on function app_private.tg_sync_columns() from public, anon;
grant execute on function app_private.tg_sync_columns() to authenticated;

-- -------------------------------------------------------------------------------------
-- Lernpakete
-- -------------------------------------------------------------------------------------
create table if not exists public.decks (
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id          uuid not null,
  name        text not null check (char_length(name) between 1 and 200),
  description text not null default '' check (char_length(description) <= 2000),
  deleted     boolean not null default false,
  version     integer not null default 1,
  server_seq  bigint not null default 0,
  device_id   text check (device_id is null or char_length(device_id) <= 100),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists decks_sync_idx on public.decks (user_id, server_seq);

-- -------------------------------------------------------------------------------------
-- Fragen (genau drei Antworten, eine richtige)
-- -------------------------------------------------------------------------------------
create table if not exists public.questions (
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id            uuid not null,
  deck_id       uuid not null,
  question      text not null check (char_length(question) between 1 and 2000),
  answers       text[] not null check (
                  cardinality(answers) = 3
                  and array_position(answers, null) is null
                  and char_length(answers[1]) between 1 and 500
                  and char_length(answers[2]) between 1 and 500
                  and char_length(answers[3]) between 1 and 500),
  correct_index smallint not null check (correct_index between 0 and 2),
  explanation   text not null default '' check (char_length(explanation) <= 4000),
  difficulty    smallint not null default 2 check (difficulty between 1 and 3),
  category      text not null default '' check (char_length(category) <= 200),
  deleted       boolean not null default false,
  version       integer not null default 1,
  server_seq    bigint not null default 0,
  device_id     text check (device_id is null or char_length(device_id) <= 100),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, deck_id) references public.decks (user_id, id) on delete cascade
);
create index if not exists questions_sync_idx on public.questions (user_id, server_seq);
create index if not exists questions_deck_idx on public.questions (user_id, deck_id);

-- -------------------------------------------------------------------------------------
-- Einstellungen (ein Datensatz pro Benutzer, feste ID)
-- -------------------------------------------------------------------------------------
create table if not exists public.user_settings (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id         uuid not null,
  data       jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 16384),
  deleted    boolean not null default false,
  version    integer not null default 1,
  server_seq bigint not null default 0,
  device_id  text check (device_id is null or char_length(device_id) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists user_settings_sync_idx on public.user_settings (user_id, server_seq);

-- -------------------------------------------------------------------------------------
-- Synchronisierungskonflikte (beide Versionen bleiben erhalten, bis entschieden wird)
-- -------------------------------------------------------------------------------------
create table if not exists public.sync_conflicts (
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id           uuid not null,
  collection   text not null check (collection in ('decks', 'questions', 'user_settings')),
  record_id    uuid not null,
  reason       text not null check (reason in ('edit_edit', 'remote_deleted', 'local_deleted', 'deck_deleted', 'deck_changed')),
  local_data   jsonb,
  remote_data  jsonb,
  device_label text not null default '' check (char_length(device_label) <= 100),
  resolved     boolean not null default false,
  resolution   text check (resolution is null or resolution in ('use_local', 'keep_remote', 'keep_both', 'restore', 'delete_anyway')),
  deleted      boolean not null default false,
  version      integer not null default 1,
  server_seq   bigint not null default 0,
  device_id    text check (device_id is null or char_length(device_id) <= 100),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists sync_conflicts_sync_idx on public.sync_conflicts (user_id, server_seq);

-- -------------------------------------------------------------------------------------
-- Spielereignisse (unveränderlich – Fortschritte verschiedener Geräte addieren sich)
-- -------------------------------------------------------------------------------------
create table if not exists public.game_sessions (
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id            uuid not null,
  deck_id       uuid,
  mode          text not null default 'normal' check (mode in ('normal', 'repeat')),
  score         integer not null check (score >= 0),
  rounds        integer not null check (rounds >= 0),
  correct_count integer not null check (correct_count >= 0),
  wrong_count   integer not null check (wrong_count >= 0),
  max_streak    integer not null default 0 check (max_streak >= 0),
  started_at    timestamptz not null,
  ended_at      timestamptz not null,
  deleted       boolean not null default false,
  version       integer not null default 1,
  server_seq    bigint not null default 0,
  device_id     text check (device_id is null or char_length(device_id) <= 100),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists game_sessions_sync_idx on public.game_sessions (user_id, server_seq);

create table if not exists public.answer_events (
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id          uuid not null,
  session_id  uuid not null,
  deck_id     uuid not null,
  question_id uuid not null,
  outcome     text not null check (outcome in ('correct', 'wrong', 'timeout')),
  points      integer not null default 0 check (points >= 0),
  response_ms integer not null default 0 check (response_ms >= 0),
  answered_at timestamptz not null,
  deleted     boolean not null default false,
  version     integer not null default 1,
  server_seq  bigint not null default 0,
  device_id   text check (device_id is null or char_length(device_id) <= 100),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists answer_events_sync_idx on public.answer_events (user_id, server_seq);

-- -------------------------------------------------------------------------------------
-- Trigger, Row Level Security und Rechte
-- -------------------------------------------------------------------------------------
do $$
declare
  t text;
begin
  -- veränderbare Tabellen: Einfügen und Ändern (Löschen nur per Tombstone)
  foreach t in array array['decks', 'questions', 'user_settings', 'sync_conflicts'] loop
    execute format('drop trigger if exists sync_columns on public.%I', t);
    execute format('create trigger sync_columns before insert or update on public.%I
                    for each row execute function app_private.tg_sync_columns()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s_select_own" on public.%I', t, t);
    execute format('drop policy if exists "%s_insert_own" on public.%I', t, t);
    execute format('drop policy if exists "%s_update_own" on public.%I', t, t);
    execute format('create policy "%s_select_own" on public.%I for select to authenticated
                    using ((select auth.uid()) = user_id)', t, t);
    execute format('create policy "%s_insert_own" on public.%I for insert to authenticated
                    with check ((select auth.uid()) = user_id)', t, t);
    execute format('create policy "%s_update_own" on public.%I for update to authenticated
                    using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t, t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select, insert, update on table public.%I to authenticated', t);
  end loop;

  -- Spielereignisse: nur lesen und anfügen
  foreach t in array array['game_sessions', 'answer_events'] loop
    execute format('drop trigger if exists sync_columns on public.%I', t);
    execute format('create trigger sync_columns before insert on public.%I
                    for each row execute function app_private.tg_sync_columns()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s_select_own" on public.%I', t, t);
    execute format('drop policy if exists "%s_insert_own" on public.%I', t, t);
    execute format('create policy "%s_select_own" on public.%I for select to authenticated
                    using ((select auth.uid()) = user_id)', t, t);
    execute format('create policy "%s_insert_own" on public.%I for insert to authenticated
                    with check ((select auth.uid()) = user_id)', t, t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select, insert on table public.%I to authenticated', t);
  end loop;
end;
$$;

-- -------------------------------------------------------------------------------------
-- Eine einzelne Änderung anwenden (wird von push_changes aufgerufen)
-- -------------------------------------------------------------------------------------
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
                                    explanation, difficulty, category, deleted, device_id, created_at)
      values (p_uid, v_id, (v_data ->> 'deck_id')::uuid, v_data ->> 'question',
              array(select jsonb_array_elements_text(v_data -> 'answers')),
              (v_data ->> 'correct_index')::smallint,
              coalesce(v_data ->> 'explanation', ''),
              coalesce((v_data ->> 'difficulty')::smallint, 2),
              coalesce(v_data ->> 'category', ''),
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
    insert into public.game_sessions (user_id, id, deck_id, mode, score, rounds, correct_count, wrong_count,
                                      max_streak, started_at, ended_at, device_id)
    values (p_uid, v_id, (v_data ->> 'deck_id')::uuid, coalesce(v_data ->> 'mode', 'normal'),
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

-- -------------------------------------------------------------------------------------
-- RPC: Änderungen hochladen. Jede Änderung wird einzeln behandelt; ein Fehler bei einer
-- Änderung bricht die übrigen nicht ab.
-- -------------------------------------------------------------------------------------
create or replace function public.push_changes(p_device_id text, p_known_seq bigint, p_changes jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_device  text := left(coalesce(p_device_id, ''), 100);
  v_change  jsonb;
  v_result  jsonb;
  v_results jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'Nicht angemeldet' using errcode = '42501';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' then
    raise exception 'p_changes muss ein JSON-Array sein' using errcode = '22023';
  end if;
  if jsonb_array_length(p_changes) > 500 then
    raise exception 'Zu viele Änderungen in einem Aufruf (höchstens 500)' using errcode = '54000';
  end if;

  for v_change in select value from jsonb_array_elements(p_changes) loop
    begin
      v_result := app_private.apply_change(v_uid, v_device, coalesce(p_known_seq, 0), v_change);
    exception when others then
      v_result := jsonb_build_object('collection', v_change ->> 'collection', 'id', v_change ->> 'id',
                                     'status', 'error', 'code', sqlstate, 'error', sqlerrm);
    end;
    v_results := v_results || jsonb_build_array(v_result);
  end loop;
  return v_results;
end;
$$;
revoke all on function public.push_changes(text, bigint, jsonb) from public, anon;
grant execute on function public.push_changes(text, bigint, jsonb) to authenticated;

-- -------------------------------------------------------------------------------------
-- RPC: Änderungen seit Zähler p_since abrufen (seitenweise, sortiert)
-- -------------------------------------------------------------------------------------
create or replace function public.pull_changes(p_since bigint, p_limit integer default 500)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_since bigint := coalesce(p_since, 0);
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 1000);
  v_rows  jsonb;
  v_count integer;
begin
  if v_uid is null then
    raise exception 'Nicht angemeldet' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('collection', c.collection, 'server_seq', c.server_seq, 'record', c.rec)
                            order by c.server_seq), '[]'::jsonb),
         count(*)
    into v_rows, v_count
    from (
      select u.collection, u.server_seq, u.rec
        from (
          select 'decks'::text as collection, d.server_seq, to_jsonb(d) as rec
            from public.decks d where d.user_id = v_uid and d.server_seq > v_since
          union all
          select 'questions', q.server_seq, to_jsonb(q)
            from public.questions q where q.user_id = v_uid and q.server_seq > v_since
          union all
          select 'user_settings', s.server_seq, to_jsonb(s)
            from public.user_settings s where s.user_id = v_uid and s.server_seq > v_since
          union all
          select 'sync_conflicts', k.server_seq, to_jsonb(k)
            from public.sync_conflicts k where k.user_id = v_uid and k.server_seq > v_since
          union all
          select 'game_sessions', g.server_seq, to_jsonb(g)
            from public.game_sessions g where g.user_id = v_uid and g.server_seq > v_since
          union all
          select 'answer_events', a.server_seq, to_jsonb(a)
            from public.answer_events a where a.user_id = v_uid and a.server_seq > v_since
        ) u
       order by u.server_seq
       limit v_limit + 1
    ) c;

  if v_count > v_limit then
    v_rows := v_rows - v_limit;  -- das zusätzliche Element (nur zur Erkennung von «weitere Seiten») entfernen
  end if;
  return jsonb_build_object('changes', v_rows, 'has_more', v_count > v_limit);
end;
$$;
revoke all on function public.pull_changes(bigint, integer) from public, anon;
grant execute on function public.pull_changes(bigint, integer) to authenticated;
