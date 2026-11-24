import { afterEach, describe, expect, it } from 'vitest';
import { closeAllDevices, makeDrafts, openDevice } from './helpers/devices.ts';
import { DEMO_DECK_ID, DEMO_QUESTION_COUNT } from '../src/data/demoDeck.ts';
import { SETTINGS_ID } from '../src/domain/types.ts';
import { createBackup, parseBackup, previewRestore, restoreBackup } from '../src/data/backup.ts';

afterEach(() => closeAllDevices());

describe('Lokale Speicherung (IndexedDB)', () => {
  it('speichert Lernpakete und Fragen dauerhaft und trägt sie in die Warteschlange ein', async () => {
    const { store } = await openDevice('laptop', null);
    const deck = await store.createDeck({ name: '  Java  ', description: 'Grundlagen' });
    expect(deck.name).toBe('Java');
    expect(deck.version).toBe(0);
    await store.addQuestions(deck.id, makeDrafts('Java', 3));
    expect(await store.listQuestions(deck.id)).toHaveLength(3);
    const outbox = await store.listOutbox();
    expect(outbox.map((e) => e.collection)).toEqual(['decks', 'questions', 'questions', 'questions']);
    expect((await store.deckSummaries())[0]).toMatchObject({ questionCount: 3, pending: true });
  });

  it('fasst mehrere Änderungen am selben Datensatz zu einem Warteschlangeneintrag zusammen', async () => {
    const { store } = await openDevice('laptop', null);
    const deck = await store.createDeck({ name: 'A' });
    await store.updateDeck(deck.id, { name: 'B' });
    await store.updateDeck(deck.id, { description: 'neu' });
    const outbox = await store.listOutbox();
    expect(outbox).toHaveLength(1);
    expect(outbox[0].rev).toBe(3);
    expect((await store.getDeck(deck.id))?.name).toBe('B');
  });

  it('löscht per Löschmarker (Tombstone) statt physisch', async () => {
    const { store } = await openDevice('laptop', null);
    const deck = await store.createDeck({ name: 'Weg damit' });
    const [q] = await store.addQuestions(deck.id, makeDrafts('X', 1));
    await store.deleteQuestions([q.id]);
    expect(await store.listQuestions(deck.id)).toHaveLength(0);
    expect((await store.getQuestion(q.id))?.deleted).toBe(true);
    await store.deleteDeck(deck.id);
    expect(await store.listDecks()).toHaveLength(0);
    expect((await store.getDeck(deck.id))?.deleted).toBe(true);
  });

  it('verhindert ungültige Fragen und Änderungen', async () => {
    const { store } = await openDevice('laptop', null);
    const deck = await store.createDeck({ name: 'Test' });
    await expect(store.addQuestions(deck.id, [{ ...makeDrafts('X', 1)[0], answers: ['a', 'a', 'b'] }])).rejects.toThrow(/unterscheiden/);
    const [q] = await store.addQuestions(deck.id, makeDrafts('X', 1));
    await expect(store.updateQuestion(q.id, { question: '  ' })).rejects.toThrow(/Fragetext/);
    await expect(store.createDeck({ name: ' ' })).rejects.toThrow(/Namen/);
  });

  it('legt beim ersten Start das Demo-Paket (mind. 20 Fragen) und Einstellungen an – nur einmal', async () => {
    const { store } = await openDevice('laptop', null, { seed: true });
    expect(await store.seedIfNeeded()).toBe(false);
    const decks = await store.listDecks();
    expect(decks.map((d) => d.id)).toEqual([DEMO_DECK_ID]);
    expect(DEMO_QUESTION_COUNT).toBeGreaterThanOrEqual(20);
    expect(await store.listQuestions(DEMO_DECK_ID)).toHaveLength(DEMO_QUESTION_COUNT);
    expect((await store.getSettings()).id).toBe(SETTINGS_ID);
  });

  it('ersetzt Fragen nur bei ausdrücklicher Auswahl und behält sonst alles', async () => {
    const { store } = await openDevice('laptop', null);
    const deck = await store.createDeck({ name: 'Mathe' });
    await store.addQuestions(deck.id, makeDrafts('Alt', 3));
    await store.addQuestions(deck.id, makeDrafts('Neu', 2));
    expect(await store.listQuestions(deck.id)).toHaveLength(5);
    await store.replaceQuestions(deck.id, makeDrafts('Ersatz', 1));
    const remaining = await store.listQuestions(deck.id);
    expect(remaining.map((q) => q.category)).toEqual(['Ersatz']);
  });

  it('speichert Spielereignisse unveränderlich und Einstellungen', async () => {
    const { store } = await openDevice('laptop', null);
    await store.recordAnswer({ sessionId: 's', deckId: 'd', questionId: 'q', outcome: 'correct', points: 150, responseMs: 900, answeredAt: new Date().toISOString() });
    await store.recordSession({ deckId: 'd', mode: 'normal', score: 150, rounds: 1, correctCount: 1, wrongCount: 0, maxStreak: 1, startedAt: new Date().toISOString(), endedAt: new Date().toISOString() });
    expect(await store.listAnswers()).toHaveLength(1);
    expect(await store.listSessions()).toHaveLength(1);
    await store.updateSettings({ soundEnabled: false, playerName: 'Lea' });
    expect(await store.getSettings()).toMatchObject({ soundEnabled: false, playerName: 'Lea' });
  });
});

describe('Datensicherung', () => {
  it('exportiert alles als JSON und stellt es auf einem leeren Gerät wieder her', async () => {
    const laptop = await openDevice('laptop', null);
    const deck = await laptop.store.createDeck({ name: 'Java', description: 'OOP' });
    await laptop.store.addQuestions(deck.id, makeDrafts('Java', 4));
    await laptop.store.recordSession({ deckId: deck.id, mode: 'normal', score: 500, rounds: 4, correctCount: 4, wrongCount: 0, maxStreak: 4, startedAt: new Date().toISOString(), endedAt: new Date().toISOString() });
    const file = JSON.parse(JSON.stringify(await createBackup(laptop.store)));

    const fresh = await openDevice('neu', null);
    const { backup, errors } = parseBackup(file);
    expect(errors).toEqual([]);
    const preview = await previewRestore(fresh.store, backup!);
    expect(preview.decks[0]).toMatchObject({ status: 'new', newQuestions: 4 });
    const report = await restoreBackup(fresh.store, backup!, { deckIds: [deck.id], includeProgress: true, restoreDeleted: false });
    expect(report).toMatchObject({ decksAdded: 1, questionsAdded: 4, sessionsAdded: 1 });
    expect(await fresh.store.listQuestions(deck.id)).toHaveLength(4);

    // Zweite Wiederherstellung ergänzt nichts doppelt
    const again = await restoreBackup(fresh.store, backup!, { deckIds: [deck.id], includeProgress: true, restoreDeleted: false });
    expect(again).toMatchObject({ decksAdded: 0, questionsAdded: 0, sessionsAdded: 0, questionsSkipped: 4 });
  });

  it('holt gelöschte Inhalte nur auf ausdrücklichen Wunsch zurück', async () => {
    const { store } = await openDevice('laptop', null);
    const deck = await store.createDeck({ name: 'Bio' });
    const [q] = await store.addQuestions(deck.id, makeDrafts('Bio', 1));
    const backup = parseBackup(JSON.parse(JSON.stringify(await createBackup(store)))).backup!;
    await store.deleteQuestions([q.id]);
    const skipped = await restoreBackup(store, backup, { deckIds: [deck.id], includeProgress: false, restoreDeleted: false });
    expect(skipped.questionsRestored).toBe(0);
    expect(await store.listQuestions(deck.id)).toHaveLength(0);
    const restored = await restoreBackup(store, backup, { deckIds: [deck.id], includeProgress: false, restoreDeleted: true });
    expect(restored.questionsRestored).toBe(1);
    expect(await store.listQuestions(deck.id)).toHaveLength(1);
  });
});

describe('Bestehende Daten nach dem Update (Tippmodus-Erweiterung)', () => {
  it('ältere Fragen ohne acceptedAnswers bleiben erhalten, lassen sich bearbeiten und im Tippmodus spielen', async () => {
    const { store } = await openDevice('laptop', null);
    const deck = await store.createDeck({ name: 'Alt' });
    const [q] = await store.addQuestions(deck.id, makeDrafts('Alt', 1));
    // Datensatz wie vor dem Update speichern (ohne das neue Feld)
    const raw = { ...(await store.getQuestion(q.id))! } as Record<string, unknown>;
    delete raw.acceptedAnswers;
    await new Promise<void>((resolve, reject) => {
      const tx = store.db.transaction('questions', 'readwrite');
      tx.objectStore('questions').put(raw);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    const loaded = (await store.listQuestions(deck.id))[0];
    expect(loaded.acceptedAnswers).toBeUndefined();
    const { TypingController } = await import('../src/domain/typing.ts');
    const game = new TypingController({ questions: [loaded] });
    game.start();
    expect(game.submit(loaded.answers[loaded.correctIndex].toUpperCase(), 0).kind).toBe('correct');
    const updated = await store.updateQuestion(q.id, { acceptedAnswers: ['Alternative'] });
    expect(updated.acceptedAnswers).toEqual(['Alternative']);
    expect(updated.question).toBe(loaded.question);
  });
});
