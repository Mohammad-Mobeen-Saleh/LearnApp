import { registerSW } from 'virtual:pwa-register';

/**
 * Service-Worker-Registrierung (vite-plugin-pwa) und Installationshinweise.
 * Neue Versionen werden erst nach Bestätigung aktiviert, damit kein Spiel unterbrochen wird.
 */

type Listener = () => void;

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const state = {
  needRefresh: false,
  offlineReady: false,
  installEvent: null as BeforeInstallPromptEvent | null,
};
const listeners = new Set<Listener>();
let updateServiceWorker: ((reloadPage?: boolean) => Promise<void>) | null = null;

function emit() {
  for (const l of [...listeners]) l();
}

export function subscribePwa(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPwaState() {
  return state;
}

export function registerPwa(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    state.installEvent = event as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    state.installEvent = null;
    emit();
  });
  if (!('serviceWorker' in navigator)) return;
  updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh() {
      state.needRefresh = true;
      emit();
    },
    onOfflineReady() {
      state.offlineReady = true;
      emit();
    },
    onRegisteredSW(_url, registration) {
      // Stündlich nach Updates suchen (wichtig für lange geöffnete Desktop-PWAs)
      if (registration) setInterval(() => void registration.update().catch(() => undefined), 60 * 60 * 1000);
    },
  });
}

export async function applyUpdate(): Promise<void> {
  state.needRefresh = false;
  emit();
  await updateServiceWorker?.(true);
}

export function dismissOfflineReady(): void {
  state.offlineReady = false;
  emit();
}

export async function promptInstall(): Promise<boolean> {
  const event = state.installEvent;
  if (!event) return false;
  await event.prompt();
  const choice = await event.userChoice;
  state.installEvent = null;
  emit();
  return choice.outcome === 'accepted';
}

export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}
