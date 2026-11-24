import { useSyncExternalStore } from 'react';

/**
 * Minimaler Hash-Router (#/pfad?parameter). Hash-Routing funktioniert ohne
 * Server-Konfiguration auf Cloudflare Pages und offline im Service Worker.
 * Fremde Hashes (z. B. Supabase-Anmeldelinks #access_token=…) gelten als Startseite.
 */

export interface Route {
  path: string;
  segments: string[];
  params: URLSearchParams;
}

export function parseHash(hash: string): Route {
  const raw = hash.startsWith('#/') ? hash.slice(1) : '/';
  const [pathPart, query = ''] = raw.split('?');
  const path = pathPart.replace(/\/+$/, '') || '/';
  return { path, segments: path.split('/').filter(Boolean), params: new URLSearchParams(query) };
}

let cachedHash: string | null = null;
let cachedRoute: Route = parseHash('');

function snapshot(): Route {
  const hash = window.location.hash;
  if (hash !== cachedHash) {
    cachedHash = hash;
    cachedRoute = parseHash(hash);
  }
  return cachedRoute;
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('hashchange', cb);
      return () => window.removeEventListener('hashchange', cb);
    },
    snapshot,
  );
}

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  const target = to.startsWith('#') ? to : `#${to.startsWith('/') ? to : `/${to}`}`;
  if (options.replace) {
    window.history.replaceState(null, '', target);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = target;
  }
}

export function href(to: string): string {
  return `#${to.startsWith('/') ? to : `/${to}`}`;
}

export function goBack(fallback = '/'): void {
  if (window.history.length > 1) window.history.back();
  else navigate(fallback);
}
