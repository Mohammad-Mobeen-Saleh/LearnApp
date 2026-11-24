import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Services, AccountPrompt } from './services.ts';
import type { LocalStore } from '../data/localStore.ts';
import type { SyncStatus } from '../sync/engine.ts';
import type { AuthState } from '../auth/authService.ts';
import type { Settings } from '../domain/types.ts';

const ServicesContext = createContext<Services | null>(null);

export function ServicesProvider({ services, children }: { services: Services; children: ReactNode }) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  const s = useContext(ServicesContext);
  if (!s) throw new Error('ServicesProvider fehlt');
  return s;
}

/**
 * Führt eine Abfrage auf dem lokalen Speicher aus und wiederholt sie automatisch,
 * sobald sich Daten ändern (lokal, durch Synchronisierung oder in einem anderen Tab).
 */
export function useLiveQuery<T>(query: (store: LocalStore) => Promise<T>, deps: readonly unknown[]): T | undefined {
  const { store } = useServices();
  const [value, setValue] = useState<T | undefined>(undefined);
  const queryRef = useRef(query);
  queryRef.current = query;
  useEffect(() => {
    let active = true;
    let run = 0;
    const execute = () => {
      const current = ++run;
      queryRef
        .current(store)
        .then((result) => {
          if (active && current === run) setValue(result);
        })
        .catch((err) => console.error('Abfrage fehlgeschlagen', err));
    };
    execute();
    const unsubscribe = store.subscribe(execute);
    return () => {
      active = false;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, ...deps]);
  return value;
}

/** Wie useLiveQuery, aber nur einmal pro Änderung der Abhängigkeiten (ohne automatisches Nachladen). */
export function useQueryOnce<T>(query: (store: LocalStore) => Promise<T>, deps: readonly unknown[]): T | undefined {
  const { store } = useServices();
  const [value, setValue] = useState<T | undefined>(undefined);
  const queryRef = useRef(query);
  queryRef.current = query;
  useEffect(() => {
    let active = true;
    setValue(undefined);
    queryRef
      .current(store)
      .then((result) => {
        if (active) setValue(result);
      })
      .catch((err) => console.error('Abfrage fehlgeschlagen', err));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, ...deps]);
  return value;
}

export function useSyncStatus(): SyncStatus {
  const { sync } = useServices();
  return useSyncExternalStore(
    (cb) => sync.subscribe(cb),
    () => sync.getStatus(),
  );
}

export function useAuthState(): AuthState {
  const { auth } = useServices();
  return useSyncExternalStore(
    (cb) => auth.subscribe(cb),
    () => auth.getState(),
  );
}

export function useAccountPrompt(): AccountPrompt {
  const { account } = useServices();
  return useSyncExternalStore(
    (cb) => account.subscribe(cb),
    () => account.getPrompt(),
  );
}

export function useSettings(): Settings | undefined {
  return useLiveQuery((store) => store.getSettings(), []);
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('online', cb);
      window.addEventListener('offline', cb);
      return () => {
        window.removeEventListener('online', cb);
        window.removeEventListener('offline', cb);
      };
    },
    () => navigator.onLine,
  );
}
