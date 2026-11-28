import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon.tsx';
import { navigate } from '../app/router.ts';
import { formatRelative } from '../lib/text.ts';
import type { SyncStatus } from '../sync/engine.ts';

// ------------------------------------------------------------------ Logo

export function Logo({ size = 40, className }: { size?: number; className?: string }) {
  return <img className={className ? `logo ${className}` : 'logo'} src="/icons/logo.svg" width={size} height={size} alt="LernArcade" draggable={false} />;
}

// ------------------------------------------------------------------ Buttons & Layout

export function Button({
  children,
  onClick,
  variant = 'secondary',
  icon,
  type = 'button',
  disabled,
  size,
  title,
  className,
  ariaLabel,
}: {
  children?: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: IconName;
  type?: 'button' | 'submit';
  disabled?: boolean;
  size?: 'sm' | 'lg';
  title?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const classes = ['btn', `btn-${variant}`, size ? `btn-${size}` : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <button type={type} className={classes} onClick={onClick} disabled={disabled} title={title} aria-label={ariaLabel}>
      {icon ? <Icon name={icon} size={size === 'lg' ? 22 : 18} /> : null}
      {children ? <span>{children}</span> : null}
    </button>
  );
}

export function LinkButton({ to, children, variant = 'secondary', icon, size, className }: {
  to: string;
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost';
  icon?: IconName;
  size?: 'sm' | 'lg';
  className?: string;
}) {
  const classes = ['btn', `btn-${variant}`, size ? `btn-${size}` : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <a className={classes} href={`#${to}`}>
      {icon ? <Icon name={icon} size={size === 'lg' ? 22 : 18} /> : null}
      <span>{children}</span>
    </a>
  );
}

export function PageHeader({ title, subtitle, back, actions }: { title: string; subtitle?: ReactNode; back?: string; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div className="page-header-main">
        {back ? (
          <a className="btn btn-ghost btn-icon" href={`#${back}`} aria-label="Zurück">
            <Icon name="back" />
          </a>
        ) : null}
        <div>
          <h1>{title}</h1>
          {subtitle ? <p className="muted">{subtitle}</p> : null}
        </div>
      </div>
      {actions ? <div className="page-header-actions">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="empty card">
      <Icon name={icon} size={36} />
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function ProgressBar({ value, label, tone = 'accent' }: { value: number; label?: string; tone?: 'accent' | 'success' | 'warning' }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className={`progress progress-${tone}`} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Stat({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: ReactNode; icon?: IconName }) {
  return (
    <div className="stat card">
      <div className="stat-label">
        {icon ? <Icon name={icon} size={16} /> : null}
        {label}
      </div>
      <div className="stat-value">{value}</div>
      {hint ? <div className="stat-hint">{hint}</div> : null}
    </div>
  );
}

// ------------------------------------------------------------------ Dialog

export function Modal({ title, children, onClose, actions, wide }: {
  title: string;
  children: ReactNode;
  onClose?: () => void;
  actions?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Aufrufer übergeben onClose meist als neue Inline-Funktion bei jedem Rendern.
  // Über eine Ref bleibt der Effekt unten davon unabhängig.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Fokus nur EINMAL beim Öffnen setzen und beim Schliessen zurückgeben.
  // (Früher lief dieser Effekt bei jedem Tastendruck erneut und setzte den Fokus auf das X.)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const preferred = node?.querySelector<HTMLElement>('[data-autofocus]');
    const fallback = node?.querySelector<HTMLElement>('.modal-body input, .modal-body select, .modal-body textarea, .modal-actions button');
    (preferred ?? fallback)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onCloseRef.current) {
        e.preventDefault();
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={wide ? 'modal card modal-wide' : 'modal card'} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head">
          <h2>{title}</h2>
          {onClose ? (
            <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Schliessen">
              <Icon name="close" />
            </button>
          ) : null}
        </div>
        <div className="modal-body">{children}</div>
        {actions ? <div className="modal-actions">{actions}</div> : null}
      </div>
    </div>
  );
}

interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface Feedback {
  confirm(options: ConfirmOptions): Promise<boolean>;
  toast(message: string, tone?: 'info' | 'success' | 'warning' | 'error'): void;
}

const FeedbackContext = createContext<Feedback | null>(null);

interface ToastItem {
  id: number;
  message: string;
  tone: 'info' | 'success' | 'warning' | 'error';
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setDialog({ ...options, resolve })),
    [],
  );
  const toast = useCallback((message: string, tone: ToastItem['tone'] = 'info') => {
    const id = nextId.current++;
    setToasts((list) => [...list.slice(-3), { id, message, tone }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), tone === 'error' ? 7000 : 4000);
  }, []);

  const close = (value: boolean) => {
    dialog?.resolve(value);
    setDialog(null);
  };

  return (
    <FeedbackContext.Provider value={{ confirm, toast }}>
      {children}
      {dialog ? (
        <Modal
          title={dialog.title}
          onClose={() => close(false)}
          actions={
            <>
              <Button onClick={() => close(false)}>{dialog.cancelLabel ?? 'Abbrechen'}</Button>
              <Button variant={dialog.danger ? 'danger' : 'primary'} onClick={() => close(true)}>
                {dialog.confirmLabel ?? 'OK'}
              </Button>
            </>
          }
        >
          <div className="confirm-message">{dialog.message}</div>
        </Modal>
      ) : null}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`} role={t.tone === 'error' ? 'alert' : 'status'}>
            {t.message}
          </div>
        ))}
      </div>
    </FeedbackContext.Provider>
  );
}

export function useFeedback(): Feedback {
  const f = useContext(FeedbackContext);
  if (!f) throw new Error('FeedbackProvider fehlt');
  return f;
}

// ------------------------------------------------------------------ Synchronisierungsstatus

export interface SyncView {
  icon: IconName;
  label: string;
  detail: string;
  tone: 'ok' | 'pending' | 'warning' | 'error' | 'neutral';
  spinning?: boolean;
}

export function describeSync(status: SyncStatus): SyncView {
  const pending = status.pending;
  switch (status.phase) {
    case 'local_only':
      return {
        icon: 'cloudOff',
        label: 'Nur lokal',
        detail: 'Cloud nicht eingerichtet. Die geräteübergreifende Synchronisierung ist noch nicht aktiv. Alle Daten bleiben auf diesem Gerät.',
        tone: 'neutral',
      };
    case 'signed_out':
      return {
        icon: 'cloudOff',
        label: 'Nicht angemeldet',
        detail: pending
          ? `${pending} Änderung(en) sind nur auf diesem Gerät gespeichert. Melde dich an, um sie mit deinen anderen Geräten zu synchronisieren.`
          : 'Melde dich an, um Lernpakete und Fortschritt mit deinen anderen Geräten zu synchronisieren.',
        tone: 'neutral',
      };
    case 'offline':
      return {
        icon: 'cloudOff',
        label: pending ? `Offline · ${pending} lokal` : 'Offline',
        detail: pending
          ? `${pending} Änderung(en) sind lokal gespeichert und werden automatisch übertragen, sobald wieder eine Verbindung besteht.`
          : 'Keine Internetverbindung. Du kannst weiterspielen, Änderungen werden lokal gespeichert.',
        tone: 'warning',
      };
    case 'syncing':
      return { icon: 'sync', label: 'Synchronisiere …', detail: 'Änderungen werden mit der Cloud abgeglichen.', tone: 'pending', spinning: true };
    case 'error':
      return {
        icon: 'alert',
        label: 'Sync-Fehler',
        detail: `${status.lastError ?? 'Unbekannter Fehler'}. Änderungen bleiben lokal gespeichert, es wird automatisch erneut versucht.`,
        tone: 'error',
      };
    default:
      if (pending > 0)
        return {
          icon: 'cloud',
          label: `${pending} ausstehend`,
          detail: `${pending} Änderung(en) sind lokal gespeichert und werden gleich übertragen.`,
          tone: 'pending',
        };
      return {
        icon: 'cloudCheck',
        label: 'Synchronisiert',
        detail: `Alle Änderungen sind in der Cloud gesichert (zuletzt ${formatRelative(status.lastSyncAt)}).`,
        tone: 'ok',
      };
  }
}

export function SyncBadge({ status, compact }: { status: SyncStatus; compact?: boolean }) {
  const view = describeSync(status);
  return (
    <button
      type="button"
      className={`sync-badge sync-${view.tone}`}
      onClick={() => navigate('/settings')}
      title={view.detail}
      aria-label={`Synchronisierung: ${view.label}. ${view.detail}`}
    >
      <Icon name={view.icon} size={16} className={view.spinning ? 'spin' : undefined} />
      {compact ? null : <span>{view.label}</span>}
      {status.conflicts > 0 ? <span className="badge-count" title="Konflikte">{status.conflicts}</span> : null}
    </button>
  );
}

/** Hinweis bei offenen Konflikten (beide Versionen sind gesichert). */
export function ConflictBanner({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <a className="banner banner-warning" href="#/conflicts">
      <Icon name="conflict" />
      <span>
        {count === 1 ? '1 Synchronisierungskonflikt' : `${count} Synchronisierungskonflikte`}. Beide Versionen sind gesichert. Jetzt entscheiden
      </span>
      <Icon name="chevron" />
    </a>
  );
}

export function useDownload() {
  return useCallback(async (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'application/json' });
    const file = typeof File !== 'undefined' ? new File([blob], filename, { type: 'application/json' }) : null;
    const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
    const standaloneIos =
      (navigator as Navigator & { standalone?: boolean }).standalone === true && /iPhone|iPad/.test(navigator.userAgent);
    // In der iPhone-App: Teilen-Dialog («In Dateien sichern»), sonst klassischer Download
    if (standaloneIos && file && nav.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename });
        return;
      } catch {
        /* abgebrochen – auf Download zurückfallen */
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }, []);
}

export function slugify(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 40) || 'lernpaket'
  );
}
