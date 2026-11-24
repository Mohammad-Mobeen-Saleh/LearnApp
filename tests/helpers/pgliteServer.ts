import { parsePullPage, parsePushResults, toRpcChanges } from '../../src/sync/protocol.ts';
import type { SyncRemote } from '../../src/sync/types.ts';
import { uuid } from '../../src/lib/uuid.ts';

/**
 * Echte PostgreSQL-Datenbank im Testprozess (PGlite) mit der Supabase-Migration.
 * Nachgebildet werden nur die Teile von Supabase, die die Migration benötigt:
 * Rollen anon/authenticated, Schema auth mit auth.users und auth.uid().
 * Ist @electric-sql/pglite nicht installiert, liefert tryCreatePgliteServer() null.
 */

export const SUPABASE_STUB_SQL = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  ), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
`;

interface PgLike {
  exec(sql: string): Promise<unknown>;
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  close(): Promise<void>;
}

export interface PgliteServer {
  createUser(): Promise<string>;
  remoteFor(userId: string): SyncRemote;
  /** SQL als angemeldeter Benutzer (Rolle authenticated) oder anonym (userId = null) ausführen */
  queryAs<T>(userId: string | null, sql: string, params?: unknown[]): Promise<T[]>;
  rowsFor(userId: string, table: string): Promise<Record<string, unknown>[]>;
  close(): Promise<void>;
}

export async function tryCreatePgliteServer(): Promise<PgliteServer | null> {
  let PGliteCtor: (new () => PgLike) | null = null;
  try {
    const mod = (await import(/* @vite-ignore */ '@electric-sql/pglite')) as unknown as { PGlite: new () => PgLike };
    PGliteCtor = mod.PGlite;
  } catch {
    return null;
  }
  if (!PGliteCtor) return null;
  const fs = await import(/* @vite-ignore */ 'node:fs/promises');
  const path = await import(/* @vite-ignore */ 'node:path');
  const db = new PGliteCtor();
  await db.exec(SUPABASE_STUB_SQL);
  const dir = path.resolve(process.cwd(), 'supabase/migrations');
  const files = (await fs.readdir(dir)).filter((f: string) => f.endsWith('.sql')).sort();
  for (const file of files) await db.exec(await fs.readFile(path.join(dir, file), 'utf8'));

  // PGlite hat nur eine Verbindung: Aufrufe nacheinander ausführen (Rolle/JWT pro Aufruf)
  let chain: Promise<unknown> = Promise.resolve();
  const serialized = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  };

  const queryAs = <T>(userId: string | null, sql: string, params: unknown[] = []) =>
    serialized(async () => {
      const claims = JSON.stringify(userId ? { sub: userId, role: 'authenticated' } : { role: 'anon' });
      await db.query(`select set_config('request.jwt.claims', $1, false)`, [claims]);
      await db.exec(userId ? 'set role authenticated' : 'set role anon');
      try {
        return (await db.query<T>(sql, params)).rows;
      } finally {
        await db.exec('reset role');
      }
    });

  return {
    async createUser() {
      const id = uuid();
      await serialized(() => db.query('insert into auth.users (id, email) values ($1, $2)', [id, `${id}@example.com`]));
      return id;
    },
    remoteFor(userId: string): SyncRemote {
      return {
        async push({ deviceId, knownSeq, changes }) {
          const rows = await queryAs<{ r: unknown }>(userId, 'select public.push_changes($1, $2, $3::jsonb) as r', [
            deviceId,
            knownSeq,
            JSON.stringify(toRpcChanges(changes)),
          ]);
          return parsePushResults(rows[0].r);
        },
        async pull({ since, limit }) {
          const rows = await queryAs<{ r: unknown }>(userId, 'select public.pull_changes($1, $2) as r', [since, limit]);
          return parsePullPage(rows[0].r);
        },
      };
    },
    queryAs,
    rowsFor(userId: string, table: string) {
      if (!/^[a-z_]+$/.test(table)) throw new Error('ungültiger Tabellenname');
      return queryAs<Record<string, unknown>>(userId, `select * from public.${table} order by server_seq`);
    },
    close: () => db.close(),
  };
}
