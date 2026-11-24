/**
 * Schlanke Promise-Hülle um die native IndexedDB-API (ohne Zusatzbibliothek).
 * Wichtig: Innerhalb einer Transaktion nur auf IndexedDB-Anfragen derselben
 * Transaktion warten – sonst schliesst der Browser die Transaktion automatisch.
 */

export const DB_VERSION = 1;

export const STORE_NAMES = [
  'decks',
  'questions',
  'user_settings',
  'sync_conflicts',
  'game_sessions',
  'answer_events',
  'outbox',
  'meta',
] as const;

export type StoreName = (typeof STORE_NAMES)[number];

export function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB-Fehler'));
  });
}

export function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB-Transaktion fehlgeschlagen'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB-Transaktion abgebrochen'));
  });
}

export function openDatabase(name: string, factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const ensure = (store: StoreName, keyPath: string) =>
        db.objectStoreNames.contains(store)
          ? req.transaction!.objectStore(store)
          : db.createObjectStore(store, { keyPath });
      ensure('decks', 'id');
      const questions = ensure('questions', 'id');
      if (!questions.indexNames.contains('deckId')) questions.createIndex('deckId', 'deckId');
      ensure('user_settings', 'id');
      ensure('sync_conflicts', 'id');
      ensure('game_sessions', 'id');
      const answers = ensure('answer_events', 'id');
      if (!answers.indexNames.contains('questionId')) answers.createIndex('questionId', 'questionId');
      const outbox = ensure('outbox', 'key');
      if (!outbox.indexNames.contains('seq')) outbox.createIndex('seq', 'seq');
      ensure('meta', 'key');
    };
    req.onsuccess = () => {
      const db = req.result;
      // Andere Tabs mit neuerer Version: Verbindung schliessen, damit das Upgrade nicht blockiert
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('Lokale Datenbank konnte nicht geöffnet werden'));
    req.onblocked = () => console.warn('IndexedDB-Upgrade wartet auf andere offene Tabs …');
  });
}

/** Kleine Helferklasse für Lese-/Schreibzugriffe innerhalb einer Transaktion. */
export class Tx {
  readonly raw: IDBTransaction;

  constructor(raw: IDBTransaction) {
    this.raw = raw;
  }

  get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
    return request(this.raw.objectStore(store).get(key)) as Promise<T | undefined>;
  }

  getAll<T>(store: StoreName): Promise<T[]> {
    return request(this.raw.objectStore(store).getAll()) as Promise<T[]>;
  }

  getAllByIndex<T>(store: StoreName, index: string, key: IDBValidKey): Promise<T[]> {
    return request(this.raw.objectStore(store).index(index).getAll(key)) as Promise<T[]>;
  }

  count(store: StoreName): Promise<number> {
    return request(this.raw.objectStore(store).count());
  }

  async put<T>(store: StoreName, value: T): Promise<void> {
    await request(this.raw.objectStore(store).put(value));
  }

  async delete(store: StoreName, key: IDBValidKey): Promise<void> {
    await request(this.raw.objectStore(store).delete(key));
  }

  async clear(store: StoreName): Promise<void> {
    await request(this.raw.objectStore(store).clear());
  }
}

export async function runTransaction<T>(
  db: IDBDatabase,
  stores: readonly StoreName[],
  mode: IDBTransactionMode,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const raw = db.transaction(stores as StoreName[], mode);
  const done = transactionDone(raw);
  try {
    const result = await fn(new Tx(raw));
    await done;
    return result;
  } catch (err) {
    try {
      raw.abort();
    } catch {
      /* Transaktion bereits beendet */
    }
    done.catch(() => undefined);
    throw err;
  }
}
