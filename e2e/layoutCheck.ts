/**
 * Prüft im Browser, dass sichtbare Bedienelemente sich nicht überlappen und die Seite
 * nicht horizontal überläuft. Wird von den Playwright-Tests im Browser ausgeführt.
 */
export interface LayoutIssue {
  kind: 'overlap' | 'overflow' | 'offscreen' | 'hidden-under-bar' | 'small-target';
  detail: string;
}

export function collectLayoutIssues(options: { minTarget?: number } = {}): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  const minTarget = options.minTarget ?? 0;
  const vw = window.innerWidth;
  const describe = (el: Element) => {
    const text = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''} «${text}»`;
  };
  const isVisible = (el: Element) => {
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    // verdeckte Datei-Inputs (über einem Button) und Elemente in geschlossenen <details> ignorieren
    if (el instanceof HTMLInputElement && el.type === 'file') return false;
    if (el.closest('details:not([open])') && !el.closest('summary')) return false;
    return true;
  };
  const fixedAncestor = (el: Element) => {
    for (let n: Element | null = el; n; n = n.parentElement) {
      const pos = getComputedStyle(n).position;
      if (pos === 'fixed' || pos === 'sticky') return n;
    }
    return null;
  };

  if (document.documentElement.scrollWidth > vw + 1) {
    issues.push({ kind: 'overflow', detail: `Seitenbreite ${document.documentElement.scrollWidth}px > Viewport ${vw}px` });
  }

  const selector = 'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], summary';
  const all = [...document.querySelectorAll(selector)].filter(isVisible);
  // Modale Dialoge/Overlays: nur deren Inhalt prüfen (der Rest liegt bewusst darunter)
  const modal = document.querySelector('.modal-backdrop, .game-overlay');
  const elements = modal ? all.filter((el) => modal.contains(el) || el.closest('.game-hud')) : all;

  for (const el of elements) {
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 || r.left < -1) issues.push({ kind: 'offscreen', detail: `${describe(el)} ragt seitlich aus dem Bildschirm (${Math.round(r.left)}–${Math.round(r.right)})` });
    if (minTarget && el.matches('button, a.btn, .tab-bar a, .hud-btn') && (r.height < minTarget - 0.5 || r.width < minTarget - 0.5)) {
      issues.push({ kind: 'small-target', detail: `${describe(el)} ist kleiner als ${minTarget}px (${Math.round(r.width)}×${Math.round(r.height)})` });
    }
  }

  for (let i = 0; i < elements.length; i++) {
    for (let j = i + 1; j < elements.length; j++) {
      const a = elements[i];
      const b = elements[j];
      if (a.contains(b) || b.contains(a)) continue;
      // label > input usw.: gleiche klickbare Einheit
      if (a.closest('label') && a.closest('label') === b.closest('label')) continue;
      const fa = fixedAncestor(a);
      const fb = fixedAncestor(b);
      // Scrollender Inhalt unter fixierten Leisten ist gewollt (wird separat geprüft)
      if ((fa === null) !== (fb === null)) continue;
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (w > 1 && h > 1) issues.push({ kind: 'overlap', detail: `${describe(a)} überlappt ${describe(b)} (${Math.round(w)}×${Math.round(h)}px)` });
    }
  }
  return issues;
}

/** Nach dem Scrollen ans Seitenende darf kein Element unter der unteren Tab-Leiste verschwinden. */
export function collectHiddenUnderTabBar(): LayoutIssue[] {
  const bar = document.querySelector('.tab-bar');
  if (!bar || getComputedStyle(bar).display === 'none') return [];
  window.scrollTo(0, document.documentElement.scrollHeight);
  const barTop = bar.getBoundingClientRect().top;
  const issues: LayoutIssue[] = [];
  const main = document.querySelector('.app-main');
  if (!main) return issues;
  const last = [...main.querySelectorAll('button, a[href], input, select, textarea')].filter((el) => {
    const r = el.getBoundingClientRect();
    // Dialoge liegen über der Tab-Leiste und werden hier nicht geprüft
    if (el.closest('.modal-backdrop, .game-overlay')) return false;
    return r.width > 0 && r.height > 0 && !(el instanceof HTMLInputElement && el.type === 'file');
  });
  for (const el of last) {
    const r = el.getBoundingClientRect();
    if (r.bottom > barTop + 1 && r.top < window.innerHeight) {
      issues.push({ kind: 'hidden-under-bar', detail: `«${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40)}» liegt unter der Tab-Leiste` });
    }
  }
  window.scrollTo(0, 0);
  return issues;
}
