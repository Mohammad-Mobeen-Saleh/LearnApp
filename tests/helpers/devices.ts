import { LocalStore } from '../../src/data/localStore.ts';
import { SyncEngine } from '../../src/sync/engine.ts';
import type { SyncRemote } from '../../src/sync/types.ts';
import { uuid } from '../../src/lib/uuid.ts';
import type { DraftQuestion } from '../../src/domain/types.ts';

/** Simuliertes Gerät: eigene IndexedDB + eigene Sync-Engine, gemeinsamer Server. */
export interface TestDevice {
  name: string;
  store: LocalStore;
  sync: SyncEngine;
  online: boolean;
  close(): void;
}

const openStores: LocalStore[] = [];

export async function openDevice(name: string, remote: SyncRemote | null, options: { seed?: boolean } = {}): Promise<TestDevice> {
  const store = await LocalStore.open(`test-${name}-${uuid()}`, { deviceLabel: name });
  openStores.push(store);
  if (options.seed) await store.seedIfNeeded();
  const device: TestDevice = {
    name,
    store,
    online: true,
    sync: undefined as unknown as SyncEngine,
    close: () => store.close(),
  };
  device.sync = new SyncEngine(store, { isOnline: () => device.online, debounceMs: 0 });
  if (remote) device.sync.setRemote(remote);
  return device;
}

export function closeAllDevices(): void {
  for (const s of openStores.splice(0)) {
    try {
      s.close();
    } catch {
      /* bereits geschlossen */
    }
  }
}

export function makeDrafts(prefix: string, count: number): DraftQuestion[] {
  return Array.from({ length: count }, (_, i) => ({
    question: `${prefix} Frage ${i + 1}?`,
    answers: [`${prefix} Antwort A${i + 1}`, `${prefix} Antwort B${i + 1}`, `${prefix} Antwort C${i + 1}`],
    correctIndex: (i % 3) as 0 | 1 | 2,
    explanation: `Erklärung ${i + 1}`,
    difficulty: 2,
    category: prefix,
  }));
}

export async function deckNames(store: LocalStore): Promise<string[]> {
  return (await store.listDecks()).map((d) => d.name).sort();
}
