import { afterAll, describe, expect, it } from 'vitest';
import { tryCreatePgliteServer } from '../helpers/pgliteServer.ts';

/**
 * Prüft die SQL-Migration in einer echten PostgreSQL-Instanz (PGlite):
 * Row Level Security, Rechte, Versionsprüfung, Tombstones und Idempotenz.
 * Wird übersprungen, wenn @electric-sql/pglite nicht installiert ist.
 */

const server = await tryCreatePgliteServer();
afterAll(async () => {
  await server?.close();
});

const deckChange = (id: string, base: number, data: Record<string, unknown>) => ({
  collection: 'decks' as const,
  id,
  baseVersion: base,
  data: { name: 'Paket', description: '', deleted: false, ...data },
});

describe.skipIf(!server)('Supabase-Migration (PostgreSQL via PGlite)', () => {
  it('Row Level Security: Benutzer sehen nur ihre eigenen Daten', async () => {
    const alice = await server!.createUser();
    const bob = await server!.createUser();
    const deckId = crypto.randomUUID();
    const [res] = await server!.remoteFor(alice).push({ deviceId: 'a', knownSeq: 0, changes: [deckChange(deckId, 0, { name: 'Privat' })] });
    expect(res.status).toBe('applied');
    expect(await server!.queryAs(alice, 'select id from public.decks')).toHaveLength(1);
    expect(await server!.queryAs(bob, 'select id from public.decks')).toHaveLength(0);
    expect((await server!.remoteFor(bob).pull({ since: 0, limit: 100 })).changes).toHaveLength(0);
    // Bob kann Alices Datensatz nicht überschreiben – gleiche UUID landet in Bobs eigenem Namensraum
    await server!.remoteFor(bob).push({ deviceId: 'b', knownSeq: 0, changes: [deckChange(deckId, 0, { name: 'Bob' })] });
    const aliceRows = await server!.rowsFor(alice, 'decks');
    expect(aliceRows[0].name).toBe('Privat');
  });

  it('anonyme Zugriffe und direktes Löschen sind nicht erlaubt', async () => {
    const alice = await server!.createUser();
    await expect(server!.queryAs(null, 'select * from public.decks')).rejects.toThrow();
    await expect(server!.queryAs(null, "select public.pull_changes(0, 10)")).rejects.toThrow();
    await expect(server!.queryAs(alice, 'delete from public.decks')).rejects.toThrow();
    await expect(server!.queryAs(alice, 'select * from app_private.sync_state')).rejects.toThrow();
  });

  it('Versionsprüfung: veraltete Änderungen erzeugen einen Konflikt statt zu überschreiben', async () => {
    const user = await server!.createUser();
    const remote = server!.remoteFor(user);
    const id = crypto.randomUUID();
    const [created] = await remote.push({ deviceId: 'laptop', knownSeq: 0, changes: [deckChange(id, 0, { name: 'v1' })] });
    expect(created).toMatchObject({ status: 'applied', version: 1 });
    const [updated] = await remote.push({ deviceId: 'laptop', knownSeq: 0, changes: [deckChange(id, 1, { name: 'v2' })] });
    expect(updated).toMatchObject({ status: 'applied', version: 2 });
    const [stale] = await remote.push({ deviceId: 'iphone', knownSeq: 0, changes: [deckChange(id, 1, { name: 'veraltet' })] });
    expect(stale.status).toBe('conflict');
    if (stale.status === 'conflict') expect(stale.record?.name).toBe('v2');
    expect((await server!.rowsFor(user, 'decks'))[0].name).toBe('v2');
  });

  it('Server-Zähler steigt monoton, Pull liefert seitenweise in Reihenfolge', async () => {
    const user = await server!.createUser();
    const remote = server!.remoteFor(user);
    const changes = Array.from({ length: 5 }, () => deckChange(crypto.randomUUID(), 0, {}));
    const results = await remote.push({ deviceId: 'd', knownSeq: 0, changes });
    const seqs = results.map((r) => (r.status === 'applied' ? r.serverSeq : -1));
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    const first = await remote.pull({ since: 0, limit: 3 });
    expect(first.changes).toHaveLength(3);
    expect(first.hasMore).toBe(true);
    const second = await remote.pull({ since: first.changes[2].serverSeq, limit: 3 });
    expect(second.changes).toHaveLength(2);
    expect(second.hasMore).toBe(false);
  });

  it('Spielereignisse sind idempotent (kein Duplikat bei erneutem Senden)', async () => {
    const user = await server!.createUser();
    const remote = server!.remoteFor(user);
    const event = {
      collection: 'answer_events' as const,
      id: crypto.randomUUID(),
      baseVersion: 0,
      data: {
        session_id: crypto.randomUUID(),
        deck_id: crypto.randomUUID(),
        question_id: crypto.randomUUID(),
        outcome: 'correct',
        points: 100,
        response_ms: 1200,
        answered_at: new Date().toISOString(),
      },
    };
    expect((await remote.push({ deviceId: 'd', knownSeq: 0, changes: [event] }))[0].status).toBe('applied');
    expect((await remote.push({ deviceId: 'd', knownSeq: 0, changes: [event] }))[0].status).toBe('applied');
    expect(await server!.rowsFor(user, 'answer_events')).toHaveLength(1);
  });

  it('ungültige Fragen werden abgelehnt, ohne andere Änderungen zu blockieren', async () => {
    const user = await server!.createUser();
    const remote = server!.remoteFor(user);
    const deckId = crypto.randomUUID();
    const results = await remote.push({
      deviceId: 'd',
      knownSeq: 0,
      changes: [
        deckChange(deckId, 0, {}),
        {
          collection: 'questions',
          id: crypto.randomUUID(),
          baseVersion: 0,
          data: { deck_id: deckId, question: 'Nur zwei?', answers: ['a', 'b'], correct_index: 0, deleted: false },
        },
        {
          collection: 'questions',
          id: crypto.randomUUID(),
          baseVersion: 0,
          data: { deck_id: deckId, question: 'Gültig?', answers: ['a', 'b', 'c'], correct_index: 2, deleted: false },
        },
      ],
    });
    expect(results.map((r) => r.status)).toEqual(['applied', 'error', 'applied']);
  });

  it('Spielvariante snake wird gespeichert, unbekannte Spiele werden abgelehnt', async () => {
    const user = await server!.createUser();
    const remote = server!.remoteFor(user);
    const session = (game_type: string) => ({
      collection: 'game_sessions' as const,
      id: crypto.randomUUID(),
      baseVersion: 0,
      data: { deck_id: null, mode: 'normal', game_type, score: 120, rounds: 1, correct_count: 1, wrong_count: 0, max_streak: 1, started_at: new Date().toISOString(), ended_at: new Date().toISOString() },
    });
    const [ok, bad] = await remote.push({ deviceId: 'd', knownSeq: 0, changes: [session('snake'), session('tetris')] });
    expect(ok.status).toBe('applied');
    expect(bad.status).toBe('error');
    const rows = await server!.rowsFor(user, 'game_sessions');
    expect(rows.map((r) => r.game_type)).toEqual(['snake']);
  });
});
