import { expect, test, type Page } from '@playwright/test';
import { collectHiddenUnderTabBar, collectLayoutIssues } from './layoutCheck.ts';

/**
 * End-to-End-Tests gegen den Produktionsbuild (vite preview):
 *  - responsives Layout ohne überlappende Bedienelemente (iPhone hoch/quer, Desktop)
 *  - Spiel mit eigenem importiertem Testpaket per Klick/Touch und Tastatur bedienbar
 *  - Fragenimport mit Vorschau
 *  - PWA-Manifest und eigene Icons
 */

const ROUTES = ['/', '/decks', '/import', '/play', '/stats', '/settings', '/account', '/conflicts'];

async function openApp(page: Page, route = '/') {
  await page.goto(`/#${route}`);
  await expect(page.locator('.app')).toBeVisible();
}

/** Im neuen Projekt gibt es absichtlich keine automatisch angelegten Lernpakete. */
async function ensureTestDeck(page: Page) {
  await openApp(page, '/decks');
  if (await page.locator('.deck-card').count()) return;
  await openApp(page, '/import');
  await page.getByLabel('Fragen im Textformat').fill([
    'Frage: Wie viel ist 2 + 3?\nA) 5\nB) 4\nC) 8\nRichtig: A',
    'Frage: Wie viel ist 3 + 4?\nA) 5\nB) 7\nC) 8\nRichtig: B',
    'Frage: Wie viel ist 4 + 5?\nA) 5\nB) 7\nC) 9\nRichtig: C',
  ].join('\n\n'));
  await page.getByRole('button', { name: 'Vorschau erstellen' }).click();
  await page.getByLabel('Name des neuen Lernpakets').fill('E2E Testfragen');
  await page.getByRole('button', { name: /3 Fragen importieren/ }).click();
  await expect(page.getByText('Import abgeschlossen')).toBeVisible();
}

async function layoutIssues(page: Page) {
  const minTarget = (page.viewportSize()?.width ?? 1000) < 900 ? 40 : 0;
  const issues = await page.evaluate(collectLayoutIssues, { minTarget });
  const hidden = await page.evaluate(collectHiddenUnderTabBar);
  return [...issues, ...hidden];
}

test.describe('Responsives Layout', () => {
  for (const route of ROUTES) {
    test(`keine Überlappungen auf ${route}`, async ({ page }) => {
      await openApp(page, route);
      await page.waitForTimeout(300);
      expect(await layoutIssues(page)).toEqual([]);
    });
  }

  test('Import-Vorschau und Spielansicht ohne Überlappungen', async ({ page }) => {
    await openApp(page, '/import');
    await page.getByRole('button', { name: 'Beispiel einfügen' }).click();
    await page.getByRole('button', { name: 'Vorschau erstellen' }).click();
    await expect(page.locator('.preview-item')).toHaveCount(2);
    expect(await layoutIssues(page)).toEqual([]);

    await ensureTestDeck(page);
    await openApp(page, '/play');
    await page.locator('.pick-card:not(.pick-repeat)').first().click();
    await expect(page.locator('.ready-card')).toBeVisible();
    expect(await layoutIssues(page)).toEqual([]);
    await page.getByRole('button', { name: 'Start' }).click();
    await page.waitForTimeout(500);
    expect(await layoutIssues(page)).toEqual([]);
    // Tippmodus
    await openApp(page, '/play');
    await page.locator('.pick-card:not(.pick-repeat)').first().click();
    await page.getByRole('radio', { name: 'Tippmodus' }).click();
    await page.getByRole('button', { name: 'Start' }).click();
    await page.waitForTimeout(500);
    expect(await layoutIssues(page)).toEqual([]);
  });
});

async function startGame(page: Page, type: 'Abwehrmodus' | 'Tippmodus') {
  await ensureTestDeck(page);
  await openApp(page, '/play');
  await page.locator('.pick-card:not(.pick-repeat)').first().click();
  await page.getByRole('radio', { name: type }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  await page.waitForTimeout(400);
}

/** Testzugriff, den die App nur im Entwicklungsmodus bereitstellt (nicht im Produktionsbuild). */
type Hook = {
  bridge: { elapsed(): number };
  controller(): { current: { solution: string } | null };
};
const hook = (page: Page) => page.evaluate(() => !!(window as unknown as { __meteorDefense?: Hook }).__meteorDefense);

test.describe('Abwehrmodus (kontinuierlich)', () => {
  test('Klick auf einen Meteoriten: richtig → sofort nächste Frage, falsch → Game Over, kein Zwischenbildschirm', async ({ page }) => {
    await startGame(page, 'Abwehrmodus');
    const canvas = page.locator('.game-canvas canvas');
    await expect(canvas).toBeVisible();
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.35);
    await expect
      .poll(async () => (await page.locator('.results').count()) > 0 || (await page.locator('.hud-round strong').textContent()) === '2', { timeout: 5000 })
      .toBe(true);
    await expect(page.getByRole('button', { name: 'Weiter' })).toHaveCount(0);
    if ((await page.locator('.results').count()) === 0) {
      await page.keyboard.press('Escape');
      await expect(page.getByRole('heading', { name: 'Pause' })).toBeVisible();
      await page.getByRole('button', { name: 'Weiterspielen' }).click();
      await page.keyboard.press('2');
    }
  });
});

test.describe('Tippmodus', () => {
  test('falsche Eingabe: Fokus bleibt, kein Game Over; richtige Eingabe: nächste Frage; Einschlag: Game Over', async ({ page }) => {
    await page.goto('/#/settings');
    await page.getByLabel(/Tempo der Meteoriten/).selectOption('fast');
    await startGame(page, 'Tippmodus');
    const input = page.getByLabel('Deine Antwort');
    await expect(input).toBeFocused();
    await input.pressSequentially('sicher falsch');
    await page.keyboard.press('Enter');
    await expect(input).toHaveValue('');
    await expect(input).toBeFocused();
    await expect(page.locator('.typing-feedback.wrong')).toBeVisible();
    await expect(page.locator('.results')).toHaveCount(0);
    await expect(page.locator('.hud-round strong')).toHaveText('1');
    if (await hook(page)) {
      const elapsed = () => page.evaluate(() => (window as unknown as { __meteorDefense: Hook }).__meteorDefense.bridge.elapsed());
      const t1 = await elapsed();
      await page.waitForTimeout(600);
      expect(await elapsed()).toBeGreaterThan(t1); // der Meteorit fällt weiter
      const solution = await page.evaluate(() => (window as unknown as { __meteorDefense: Hook }).__meteorDefense.controller().current!.solution);
      await input.pressSequentially(`  ${solution.toUpperCase()} `);
      await page.keyboard.press('Enter');
      await expect(page.locator('.hud-round strong')).toHaveText('2', { timeout: 3000 });
      await expect(input).toBeFocused();
    }
    // Meteorit bis zum Schutzschild fallen lassen (Tempo «Schnell»)
    await expect(page.locator('.results')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole('heading', { name: 'Game Over' })).toBeVisible();
    await expect(page.locator('.decisive')).toContainText('Richtig wäre');
    await page.goto('/#/settings');
    await page.getByLabel(/Tempo der Meteoriten/).selectOption('normal');
  });
});

test.describe('Lernpaket bearbeiten', () => {
  test('Fokus bleibt beim Tippen im Namens- und Beschreibungsfeld', async ({ page }) => {
    await ensureTestDeck(page);
    await openApp(page, '/decks');
    await page.locator('.deck-card').first().getByRole('button', { name: /bearbeiten/i }).click();
    const name = page.locator('.modal input').first();
    await name.click();
    await name.press('End');
    await page.keyboard.type(' – überarbeitet');
    await expect(name).toBeFocused();
    await expect(name).toHaveValue(/ – überarbeitet$/);
    const desc = page.locator('.modal textarea');
    await desc.click();
    await desc.press('ControlOrMeta+A');
    await page.keyboard.type('Lange Beschreibung, die ohne Unterbrechung eingegeben wird.');
    await page.keyboard.press('Backspace');
    await page.keyboard.insertText(' Eingefügt.');
    await expect(desc).toBeFocused();
    await expect(desc).toHaveValue('Lange Beschreibung, die ohne Unterbrechung eingegeben wird Eingefügt.');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.locator('.modal')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.deck-card').first()).toContainText('überarbeitet');
  });
});

test.describe('Fragenimport', () => {
  test('Textimport legt ein neues Lernpaket an', async ({ page }) => {
    await openApp(page, '/import');
    await page.locator('textarea').fill(
      'Frage: Was ist 2 + 3?\nA) 4\nB) 5\nC) 6\nRichtig: B\nErklärung: 2 + 3 = 5\n\nFrage: Fehlerhaft?\nA) nur eine Antwort\nRichtig: A',
    );
    await page.getByRole('button', { name: 'Vorschau erstellen' }).click();
    await expect(page.locator('.preview-item')).toHaveCount(2);
    await expect(page.locator('.preview-error')).toHaveCount(1);
    await page.getByLabel('Name des neuen Lernpakets').fill('E2E Mathe');
    await page.getByRole('button', { name: /1 Frage importieren/ }).click();
    await expect(page.getByText('Import abgeschlossen')).toBeVisible();
    await openApp(page, '/decks');
    await expect(page.getByRole('heading', { name: 'E2E Mathe' })).toBeVisible();
  });
});

test.describe('PWA und Logo', () => {
  test('Manifest verweist auf eigene Icons, Favicon und Apple-Touch-Icon sind gültige Bilder', async ({ page, request }) => {
    await openApp(page);
    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(manifestHref).toBeTruthy();
    const manifest = await (await request.get(manifestHref!)).json();
    expect(manifest.name).toBe('Meteor Defense');
    expect(manifest.display).toBe('standalone');
    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
    for (const icon of ['/favicon.ico', '/favicon-32.png', '/apple-touch-icon.png', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png']) {
      const res = await request.get(icon);
      expect(res.ok(), icon).toBe(true);
      const body = await res.body();
      expect(body.length, icon).toBeGreaterThan(100);
    }
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/apple-touch-icon.png');
    await expect(page.locator('.app-header img.logo')).toHaveAttribute('src', '/icons/logo.svg');
  });
});
