import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryServer } from './helpers/memoryServer.ts';
import { closeAllDevices, deckNames, makeDrafts, openDevice } from './helpers/devices.ts';
import { tryCreatePgliteServer, type PgliteServer } from './helpers/pgliteServer.ts';
import { computeStats } from '../src/domain/stats.ts';
import type { SyncRemote } from '../src/sync/types.ts';

/**
 * Szenarien zwischen zwei Geräten (Laptop und iPhone) mit demselben Benutzerkonto.
 * Läuft gegen die In-Memory-Nachbildung und – falls @electric-sql/pglite installiert ist –
 * zusätzlich gegen die echte SQL-Migration in PostgreSQL (PGlite).
 */

interface Backend {
  name: string;
  setup(): Promise<{ remote: () => SyncRemote; setOnline(online: boolean): void; loseNextResponse(): void; serverRows(collection: string): Promise<Record<string, unknown>[]> }>;
}

let pglite: PgliteServer | null = null;
const pgliteAvailable = await (async () => {
  try {
    pglite = await tryCreatePgliteServer();
  } catch (err) {
    // Fehler in der Migration meldet tests/sql/migration.test.ts ausführlich
    console.warn('PGlite-Backend nicht verfügbar – Szenarien laufen nur gegen den In-Memory-Server:', err);
    pglite = null;
  }
  return pglite !== null;
})();

const backends: Backend[] = [
  {
    name: 'In-Memory-Server',
    async setup() {
      const server = new MemoryServer();
      return {
        remote: () => server.remote(),
        setOnline: (online) => {
          server.online = online;
        },
        loseNextResponse: () => {
          server.loseNextPushResponse = true;
        },
        serverRows: async (c) => server.rows(c as never),
      };
    },
  },
];
if (pgliteAvailable) {
  backends.push({
    name: 'PostgreSQL (PGlite, echte Migration)',
    async setup() {
      const userId = await pglite!.createUser();
      const control = { online: true, lose: false };
      const base = pglite!.remoteFor(userId);
      const remote: SyncRemote = {
        push: async (input) => {
          if (!control.online) throw new Error('TypeError: Failed to fetch');
          const result = await base.push(input);
          if (control.lose) {
            control.lose = false;
            throw new Error('TypeError: Failed to fetch');
          }
          return result;
        },
        pull: async (input) => {
          if (!control.online) throw new Error('TypeError: Failed to fetch');
          return base.pull(input);
        },
      };
      return {
        remote: () => remote,
        setOnline: (online) => {
          control.online = online;
        },
        loseNextResponse: () => {
          control.lose = true;
        },
        serverRows: (c) => pglite!.rowsFor(userId, c),
      };
    },
  });
}

afterEach(() => closeAllDevices());
afterAll(async () => {
  await pglite?.close();
});

describe.each(backends)('Synchronisierung zwischen Laptop und iPhone – $name', (backend) => {
  let env: Awaited<ReturnType<Backend['setup']>>;
  beforeEach(async () => {
    env = await backend.setup();
  });

  it('Laptop erstellt Paket A, iPhone Paket B → nach dem Abgleich haben beide A und B', async () => {
    const laptop = await openDevice('laptop', env.remote());
    const iphone = await openDevice('iphone', env.remote());

    const java = await laptop.store.createDeck({ name: 'Java' });
    await laptop.store.addQuestions(java.id, makeDrafts('Java', 50));
    await laptop.sync.sync();

    const arabic = await iphone.store.createDeck({ name: 'Arabisch' });
    await iphone.store.addQuestions(arabic.id, makeDrafts('Arabisch', 30));
    const report = await iphone.sync.sync();
    expect(report.ok).toBe(true);
    await laptop.sync.sync();

    for (const device of [laptop, iphone]) {
      expect(await deckNames(device.store)).toEqual(['Arabisch', 'Java']);
      expect(await device.store.listQuestions(java.id)).toHaveLength(50);
      expect(await device.store.listQuestions(arabic.id)).toHaveLength(30);
      expect(await device.store.listOutbox()).toHaveLength(0);
    }
    expect((await env.serverRows('decks')).length).toBe(2);
    expect((await env.serverRows('questions')).length).toBe(80);
  });

  it('beide Geräte gleichzeitig offline: unterschiedliche Pakete werden zusammengeführt, nichts wird ersetzt', async () => {
    const laptop = await openDevice('laptop', env.remote());
    const iphone = await openDevice('iphone', env.remote());
    laptop.online = false;
    iphone.online = false;
    const a = await laptop.store.createDeck({ name: 'A' });
    await laptop.store.addQuestions(a.id, makeDrafts('A', 5));
    const b = await iphone.store.createDeck({ name: 'B' });
    await iphone.store.addQuestions(b.id, makeDrafts('B', 7));
    laptop.online = true;
    iphone.online = true;
    await Promise.all([laptop.sync.sync(), iphone.sync.sync()]);
    await laptop.sync.sync();
    await iphone.sync.sync();
    for (const device of [laptop, iphone]) {
      expect(await deckNames(device.store)).toEqual(['A', 'B']);
      expect((await device.store.listAllQuestions()).length).toBe(12);
    }
  });

  it('Offline erfasste Fragen bleiben erhalten und werden nach dem Verbindungsunterbruch übertragen', async () => {
    const laptop = await openDevice('laptop', env.remote());
    const iphone = await openDevice('iphone', env.remote());
    const deck = await iphone.store.createDeck({ name: 'Netzwerke' });
    await iphone.sync.sync();

    env.setOnline(false);
    await iphone.store.addQuestions(deck.id, makeDrafts('Offline', 4));
    const failed = await iphone.sync.sync();
    expect(failed.ok).toBe(false);
    expect(iphone.sync.getStatus().phase).toBe('offline');
    expect((await iphone.store.listOutbox()).length).toBe(4);
    expect(await iphone.store.listQuestions(deck.id)).toHaveLength(4);

    env.setOnline(true);
    const ok = await iphone.sync.sync();
    expect(ok.ok).toBe(true);
    expect(await iphone.store.listOutbox()).toHaveLength(0);
    await laptop.sync.sync();
    expect(await laptop.store.listQuestions(deck.id)).toHaveLength(4);
  });

  it('verlorene Server-Antwort führt beim erneuten Senden nicht zu Duplikaten', async () => {
    const laptop = await openDevice('laptop', env.remote());
    const deck = await laptop.store.createDeck({ name: 'Doppelt?' });
    await laptop.store.addQuestions(deck.id, makeDrafts('D', 3));
    await laptop.store.recordAnswer({ sessionId: 's', deckId: deck.id, questionId: 'q', outcome: 'correct', points: 100, responseMs: 1, answeredAt: new Date().toISOString() });
    env.loseNextResponse();
    expect((await laptop.sync.sync()).ok).toBe(false);
    expect((await laptop.store.listOutbox()).length).toBe(5);

    // Zwischenzeitlich lokal weiter bearbeitet
    await laptop.store.updateDeck(deck.id, { description: 'nach Abbruch geändert' });
    expect((await laptop.sync.sync()).ok).toBe(true);
    expect(await laptop.store.listConflicts()).toHaveLength(0);
    expect(await laptop.store.listOutbox()).toHaveLength(0);
    expect((await env.serverRows('decks')).length).toBe(1);
    expect((await env.serverRows('questions')).length).toBe(3);
    expect((await env.serverRows('answer_events')).length).toBe(1);
    expect((await env.serverRows('decks'))[0].description).toBe('nach Abbruch geändert');
  });

  it('gleichzeitige Änderung derselben Frage: Konflikt wird erkannt, beide Versionen bleiben erhalten', async () => {
    const laptop = await openDevice('laptop', env.remote());
    const iphone = await openDevice('iphone', env.remote());
    const deck = await laptop.store.createDeck({ name: 'Konflikt' });
    const [q] = await laptop.store.addQuestions(deck.id, makeDrafts('K', 1));
    await laptop.sync.sync();
    await iphone.sync.sync();

    await laptop.store.updateQuestion(q.id, { question: 'Version vom Laptop?' });
    await iphone.store.updateQuestion(q.id, { question: 'Version vom iPhone?' });
    await laptop.sync.sync();
    const report = await iphone.sync.sync();
    expect(report.conflicts).toBe(1);

    const conflicts = await iphone.store.listConflicts();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ reason: 'edit_edit', collection: 'questions', recordId: q.id });
    expect(conflicts[0].localData?.question).toBe('Version vom iPhone?');
    expect(conflicts[0].remoteData?.question).toBe('Version vom Laptop?');
    // Lokal gilt vorerst die Cloud-Version, die eigene Version ist im Konflikt gesichert
    expect((await iphone.store.getQuestion(q.id))?.question).toBe('Version vom Laptop?');

    // Der Konflikt ist auch auf dem Laptop sichtbar (nichts geht verloren, selbst wenn das iPhone verloren geht)
    await laptop.sync.sync();
    expect(await laptop.store.listConflicts()).toHaveLength(1);

    // Auflösung «Beide behalten»: Kopie mit der iPhone-Version
    await iphone.store.resolveConflict(conflicts[0].id, 'keep_both');
    await iphone.sync.sync();
    await laptop.sync.sync();
    for (const device of [laptop, iphone]) {
      const texts = (await device.store.listQuestions(deck.id)).map((x) => x.question).sort();
      expect(texts).toEqual(['Version vom Laptop?', 'Version vom iPhone?']);
      expect(await device.store.listConflicts()).toHaveLength(0);
    }
  });

  it('Auflösung «Diese Version verwenden» setzt sich auf beiden Geräten durch', async () => {
    const laptop = await openDevice('laptop', env.remote());
    const iphone = await openDevice('iphone', env.remote());
    const deck = await laptop.store.createDeck({ name: 'Auflösung' });
    const [q] = await laptop.store.addQuestions(deck.id, makeDrafts('R', 1));
    await laptop.sync.sync();
    await iphone.sync.sync();
    await laptop.store.updateQuestion(q.id, { explanation: 'Laptop' });
    await iphone.store.updateQuestion(q.id, { explanation: 'iPhone' });
    await laptop.sync.sync();
    await iphone.sync.sync();
    const [conflict] = await iphone.store.listConflicts();
    await iphone.store.resolveConflict(conflict.id, 'use_local');
    await iphone.sync.sync();
    await laptop.sync.sync();
    expect((await laptop.store.getQuestion(q.id))?.explanation).toBe('iPhone');
    expect((await iphone.store.getQuestion(q.id))?.explanation).toBe('iPhone');
  });

  it('Änderungen an verschiedenen Feldern werden automatisch zusammengeführt', async () => {
    const laptop = await openDevice('laptop', env.remote());
    const iphone = await openDevice('iphone', env.remote());
    const deck = await laptop.store.createDeck({ name: 'Merge', description: 'alt' });
    await laptop.sync.sync();
    await iphone.sync.sync();
    await laptop.store.updateDeck(deck.id, { name: 'Merge (neu)' });
    await iphone.store.updateDeck(deck.id, { description: 'neue Beschreibung' });
    await laptop.sync.sync();
    const report = await iphone.sync.sync();
    expect(report.conflicts).toBe(0);
    await laptop.sync.sync();
    for (const device of [laptop, iphone]) {
      expect(await device.store.getDeck(deck.id)).toMatchObject({ name: 'Merge (neu)', description: 'neue Beschreibung' });
    }
  });

  it('veraltetes Offline-Gerät stellt gelöschte Inhalte nicht wieder her', async () => {
    const laptop = await openDevice('laptop', env.remote());
    const iphone = await openDevice('iphone', env.remote());
    const deck = await laptop.store.createDeck({ name: 'Alt' });
    await laptop.store.addQuestions(deck.id, makeDrafts('Alt', 2));
    await laptop.sync.sync();
    await iphone.sync.sync();
    expect(await deckNames(iphone.store)).toEqual(['Alt']);

    iphone.online = false;
    await laptop.store.deleteDeck(deck.id);
    await laptop.sync.sync();
    // iPhone war offline, erstellt etwas anderes und kommt zurück
    const other = await iphone.store.createDeck({ name: 'Neu' });
    iphone.online = true;
    await iphone.sync.sync();
    await laptop.sync.sync();
    for (const device of [laptop, iphone]) expect(await deckNames(device.store)).toEqual(['Neu']);
    const serverDeck = (await env.serverRows('decks')).find((d) => d.id === deck.id);
    expect(serverDeck?.deleted).toBe(true);
    expect(other.id).toBeTruthy();
  });

  it('Löschung auf einem Gerät, Bearbeitung auf dem anderen: Konflikt statt stiller Verlust', async () => {
    const laptop = await openDevice('laptop', env.remote());
    const iphone = await openDevice('iphone', env.remote());
    const deck = await laptop.store.createDeck({ name: 'Löschen' });
    const [q] = await laptop.store.addQuestions(deck.id, makeDrafts('L', 1));
    await laptop.sync.sync();
    await iphone.sync.sync();
    await laptop.store.deleteQuestions([q.id]);
    await iphone.store.updateQuestion(q.id, { explanation: 'wichtige Ergänzung' });
    await laptop.sync.sync();
    await iphone.sync.sync();
    const [conflict] = await iphone.store.listConflicts();
    expect(conflict.reason).toBe('remote_deleted');
    expect(conflict.localData?.explanation).toBe('wichtige Ergänzung');
    expect(await iphone.store.listQuestions(deck.id)).toHaveLength(0);
    await iphone.store.resolveConflict(conflict.id, 'restore');
    await iphone.sync.sync();
    await laptop.sync.sync();
    expect((await laptop.store.listQuestions(deck.id)).map((x) => x.explanation)).toEqual(['wichtige Ergänzung']);
  });

  it('Löschung basierend auf veraltetem Stand wird nicht ausgeführt (neuere Änderung bleibt)', async () => {
    const laptop = await openDevice('laptop', env.remote());
    const iphone = await openDevice('iphone', env.remote());
    const deck = await laptop.store.createDeck({ name: 'Paket' });
    const [q] = await laptop.store.addQuestions(deck.id, makeDrafts('P', 1));
    await laptop.sync.sync();
    await iphone.sync.sync();
    await laptop.store.updateQuestion(q.id, { question: 'Neu formuliert?' });
    await laptop.sync.sync();
    await iphone.store.deleteQuestions([q.id]);
    await iphone.sync.sync();
    const [conflict] = await iphone.store.listConflicts();
    expect(conflict.reason).toBe('local_deleted');
    expect((await iphone.store.getQuestion(q.id))?.deleted).toBe(false);
    expect((await iphone.store.getQuestion(q.id))?.question).toBe('Neu formuliert?');
    await iphone.store.resolveConflict(conflict.id, 'delete_anyway');
    await iphone.sync.sync();
    await laptop.sync.sync();
    expect(await laptop.store.listQuestions(deck.id)).toHaveLength(0);
  });

  it('Fragen für ein anderswo gelöschtes Paket gehen nicht verloren (Paket wiederherstellbar)', async () => {
    const laptop = await openDevice('laptop', env.remote());
    const iphone = await openDevice('iphone', env.remote());
    const deck = await laptop.store.createDeck({ name: 'Geschichte' });
    await laptop.sync.sync();
    await iphone.sync.sync();
    await laptop.store.deleteDeck(deck.id);
    await laptop.sync.sync();
    await iphone.store.addQuestions(deck.id, makeDrafts('Neu', 2));
    const report = await iphone.sync.sync();
    expect(report.conflicts).toBe(2);
    const conflicts = await iphone.store.listConflicts();
    expect(conflicts.every((c) => c.reason === 'deck_deleted')).toBe(true);
    for (const c of conflicts) await iphone.store.resolveConflict(c.id, 'restore');
    await iphone.sync.sync();
    await laptop.sync.sync();
    expect(await deckNames(laptop.store)).toEqual(['Geschichte']);
    expect(await laptop.store.listQuestions(deck.id)).toHaveLength(2);
  });

  it('Paket wird nicht gelöscht, wenn ein anderes Gerät inzwischen Fragen hinzugefügt hat', async () => {
    const laptop = await openDevice('laptop', env.remote());
    const iphone = await openDevice('iphone', env.remote());
    const deck = await laptop.store.createDeck({ name: 'Physik' });
    await laptop.sync.sync();
    await iphone.sync.sync();
    await iphone.store.addQuestions(deck.id, makeDrafts('Neu', 3));
    await iphone.sync.sync();
    await laptop.store.deleteDeck(deck.id);
    const report = await laptop.sync.sync();
    expect(report.conflicts).toBe(1);
    const [conflict] = await laptop.store.listConflicts();
    expect(conflict.reason).toBe('deck_changed');
    expect(await deckNames(laptop.store)).toEqual(['Physik']);
    expect(await laptop.store.listQuestions(deck.id)).toHaveLength(3);
    await laptop.store.resolveConflict(conflict.id, 'delete_anyway');
    await laptop.sync.sync();
    await iphone.sync.sync();
    expect(await deckNames(iphone.store)).toEqual([]);
  });

  it('erstes Login: lokale Pakete werden sicher zusammengeführt, ohne Demodaten', async () => {
    // Laptop nutzt bereits das Konto
    const laptop = await openDevice('laptop', env.remote(), { seed: true });
    const java = await laptop.store.createDeck({ name: 'Java' });
    await laptop.store.addQuestions(java.id, makeDrafts('Java', 5));
    await laptop.sync.sync();

    // iPhone wurde zuerst im lokalen Modus benutzt
    const iphone = await openDevice('iphone', null, { seed: true });
    const local = await iphone.store.createDeck({ name: 'Arabisch' });
    await iphone.store.addQuestions(local.id, makeDrafts('Arabisch', 3));
    await iphone.store.updateSettings({ playerName: 'Sami' });

    // Anmeldung auf dem iPhone
    iphone.sync.setRemote(env.remote());
    const report = await iphone.sync.sync();
    expect(report.ok).toBe(true);
    await laptop.sync.sync();

    for (const device of [laptop, iphone]) {
      const decks = await device.store.listDecks();
      expect(decks.map((d) => d.name).sort()).toEqual(['Arabisch', 'Java']);
      expect(await device.store.listQuestions(java.id)).toHaveLength(5);
      expect(await device.store.listQuestions(local.id)).toHaveLength(3);
      expect((await device.store.getSettings()).playerName).toBe('Sami');
      expect(await device.store.listConflicts()).toHaveLength(0);
    }
    expect((await env.serverRows('decks')).length).toBe(2);
  });

  it('Lernfortschritt beider Geräte addiert sich (kein gegenseitiges Überschreiben)', async () => {
    const laptop = await openDevice('laptop', env.remote());
    const iphone = await openDevice('iphone', env.remote());
    const deck = await laptop.store.createDeck({ name: 'Fortschritt' });
    const [q1, q2] = await laptop.store.addQuestions(deck.id, makeDrafts('F', 2));
    await laptop.sync.sync();
    await iphone.sync.sync();
    const now = () => new Date().toISOString();
    await laptop.store.recordAnswer({ sessionId: 's1', deckId: deck.id, questionId: q1.id, outcome: 'correct', points: 150, responseMs: 500, answeredAt: now() });
    await laptop.store.recordSession({ deckId: deck.id, mode: 'normal', score: 150, rounds: 1, correctCount: 1, wrongCount: 0, maxStreak: 1, startedAt: now(), endedAt: now() });
    await iphone.store.recordAnswer({ sessionId: 's2', deckId: deck.id, questionId: q2.id, outcome: 'wrong', points: 0, responseMs: 800, answeredAt: now() });
    await iphone.store.recordSession({ deckId: deck.id, mode: 'normal', score: 980, rounds: 7, correctCount: 6, wrongCount: 1, maxStreak: 6, startedAt: now(), endedAt: now() });
    await laptop.sync.sync();
    await iphone.sync.sync();
    await laptop.sync.sync();
    for (const device of [laptop, iphone]) {
      const stats = computeStats({
        decks: await device.store.listDecks(),
        questions: await device.store.listAllQuestions(),
        sessions: await device.store.listSessions(),
        answers: await device.store.listAnswers(),
      });
      expect(stats.games).toBe(2);
      expect(stats.rounds).toBe(2);
      expect(stats.highscore).toBe(980);
      expect(stats.repeatQuestionIds).toEqual([q2.id]);
    }
  });

  it('Einstellungen werden synchronisiert und feldweise zusammengeführt', async () => {
    const laptop = await openDevice('laptop', env.remote(), { seed: true });
    const iphone = await openDevice('iphone', env.remote(), { seed: true });
    await laptop.sync.sync();
    await iphone.sync.sync();
    await laptop.store.updateSettings({ soundEnabled: false });
    await iphone.store.updateSettings({ speed: 'fast' });
    await laptop.sync.sync();
    await iphone.sync.sync();
    await laptop.sync.sync();
    for (const device of [laptop, iphone]) {
      expect(await device.store.getSettings()).toMatchObject({ soundEnabled: false, speed: 'fast' });
      expect(await device.store.listConflicts()).toHaveLength(0);
    }
  });
});
