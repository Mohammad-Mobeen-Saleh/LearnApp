<p align="center">
  <img src="public/icons/icon-192.png" width="112" height="112" alt="LernArcade Logo">
</p>

<h1 align="center">LernArcade</h1>

<p align="center">Lernplattform mit Minispielen: Deine eigenen Lernpakete, gespielt in <b>Meteor Defense</b> und <b>Snake</b>.<br>
Eine einzige Progressive Web App für iPhone und Windows-Laptop, mit gemeinsamer, konfliktsicherer Synchronisierung.</p>

---

## Inhalt

- [Funktionsumfang](#funktionsumfang)
- [Technologie und Projektstruktur](#technologie-und-projektstruktur)
- [1. Entwicklungswerkzeuge unter Windows installieren](#1-entwicklungswerkzeuge-unter-windows-installieren)
- [2. Lokal starten](#2-lokal-starten)
- [3. Tests und Produktionsbuild](#3-tests-und-produktionsbuild)
- [4. Fragen importieren](#4-fragen-importieren)
- [5. Supabase einrichten](#5-supabase-einrichten)
- [6. Datenbankmigrationen](#6-datenbankmigrationen)
- [7. Sichere Synchronisierung](#7-sichere-synchronisierung)
- [8. Deployment auf Cloudflare Pages](#8-deployment-auf-cloudflare-pages)
- [9. Installation auf dem iPhone](#9-installation-auf-dem-iphone)
- [10. Installation als Desktop-App unter Windows](#10-installation-als-desktop-app-unter-windows)
- [11. Datensicherung und Wiederherstellung](#11-datensicherung-und-wiederherstellung)
- [Spiele der LernArcade](#spiele-der-lernarcade)
- [Spielregeln und Punkte](#spielregeln-und-punkte)
- [Logo und Icons](#logo-und-icons)
- [Fehlerbehebung](#fehlerbehebung)

---

## Funktionsumfang

| Bereich | Umsetzung |
|---|---|
| **Dashboard** | LernArcade-Logo, Begrüssung, Schnellstart der Spiele, «Lernpakete», «Fragen importieren», Lernstatistik, Highscore je Spiel, Synchronisierungsstatus, Schnelleinstellungen |
| **Spiele** | Spieleübersicht mit Spielkarten (Meteor Defense, Snake) und einer gemeinsamen Lernpaket-Auswahl, die beim Spielwechsel erhalten bleibt |
| **Snake** | Schlange zur Frucht mit der richtigen von drei Antworten steuern; falsche Frucht = Bombe, Wand oder eigener Körper beenden das Spiel. Kleine/grosse Karte, drei Geschwindigkeiten, Pfeiltasten/WASD, Wischen und Steuerkreuz |
| **Lernpakete** | erstellen, umbenennen, löschen (mit Bestätigung), importieren, als JSON exportieren, Anzeige «lokal gespeichert» / «synchron» |
| **Fragenverwaltung** | alle Fragen eines Pakets ansehen, durchsuchen, hinzufügen, korrigieren, löschen |
| **Abwehrmodus (Phaser 3)** | kontinuierlich: 3 Meteoriten mit je einer Antwort, richtige Antwort → Abschuss und sofort die nächste Frage; eine falsche Antwort beendet das Spiel. Endlos, das Paket wird automatisch neu gemischt. Tempo- und Serienbonus, Explosionen, Soundeffekte, Pause, Neustart, Ergebnis, per Touch, Maus und Tastatur (1/2/3, Esc) |
| **Tippmodus** | ein Meteorit fällt, die Antwort wird eingetippt und mit Enter bzw. der Senden-Taste der iPhone-Tastatur abgeschickt; eine vollständig richtige Antwort wird schon beim Tippen erkannt. Richtig → Abschuss, Punkte, nächster Meteorit sofort; falsch → −10 Punkte, der Meteorit fällt weiter; Einschlag → Game Over. Gross-/Kleinschreibung und Leerzeichen werden ignoriert, optionale weitere gültige Antworten |
| **Statistik** | richtig/falsch, Erfolgsquote, Spielrunden, Highscore, Fortschritt pro Fach, Fragen zum Wiederholen, letzte Spiele; für alle Spiele, je Spiel und je Meteor-Defense-Modus, dazu ein Vergleich der Spiele |
| **Import** | Textformat und JSON, Vorschau, Fehlererkennung, Duplikatprüfung, «ergänzen» (Standard) oder ausdrücklich «ersetzen» |
| **Synchronisierung** | Supabase (Auth + PostgreSQL), IndexedDB lokal, Warteschlange, Versionsprüfung, Konfliktzentrale, Tombstones, Offline-Betrieb |
| **PWA** | Service Worker (App-Shell offline), Manifest, eigenes Logo als App-Symbol (iPhone, Windows, Browser-Tab), iOS-Startbildschirme |
| **Datensicherung** | vollständiger JSON-Export und ergänzende Wiederherstellung |

Ohne Supabase-Konfiguration läuft die App vollständig im **lokalen Modus** und zeigt deutlich an, dass die geräteübergreifende Synchronisierung noch nicht aktiv ist.

## Technologie und Projektstruktur

React 19 + TypeScript · Vite 7 · Phaser 3 · IndexedDB (native API) · Supabase Auth + PostgreSQL · vite-plugin-pwa (Workbox) · Vitest · Playwright · Cloudflare Pages

```
meteor-defense/
├─ index.html                 Einstieg, Favicons, Apple-Touch-Icon, iOS-Startbilder
├─ public/                    Icons (PNG/ICO/SVG), Startbilder, _headers für Cloudflare
├─ branding/                  Logo-Quelldateien (SVG) und 1024-px-Version
├─ scripts/generate-icons.mjs Erzeugt alle Logo-/Icon-/Splash-Dateien aus der SVG-Definition
├─ supabase/migrations/       SQL-Migration (Tabellen, RLS, Sync-Funktionen)
├─ src/
│  ├─ domain/                 Datentypen, Spiellogik (GameController), Punkte, Statistik
│  ├─ import/                 Text-/JSON-Parser, Validierung, Duplikaterkennung
│  ├─ data/                   IndexedDB-Speicher (LocalStore), Demo-Paket, Sicherung
│  ├─ sync/                   Sync-Engine, Konfliktlogik, Supabase-Anbindung
│  ├─ auth/                   Supabase Auth
│  ├─ game/                   Phaser-Szene, Canvas-Einbettung, Spielansicht, Sounds
│  ├─ pages/  ui/  app/       Oberfläche, Komponenten, Router, PWA-Registrierung
│  └─ styles/global.css       Design (Dark Mode)
├─ tests/                     Vitest: Import, Validierung, Spiel, Speicher, Sync, SQL
└─ e2e/                       Playwright: Layout (iPhone/Desktop), Spiel, Import, PWA
```

---

## 1. Entwicklungswerkzeuge unter Windows installieren

1. **Node.js 22 LTS**: <https://nodejs.org> (Installer «LTS») oder in PowerShell:
   ```powershell
   winget install OpenJS.NodeJS.LTS
   ```
   Prüfen (neues Terminal öffnen): `node -v` (≥ 20.19, empfohlen 22) und `npm -v`.
2. **Git für Windows**: <https://git-scm.com/download/win> oder `winget install Git.Git`
3. **Editor (optional)**: Visual Studio Code: `winget install Microsoft.VisualStudioCode`
4. **Supabase CLI (optional)**: wird bei Bedarf über `npx supabase …` ohne Installation genutzt.

## 2. Lokal starten

```powershell
cd meteor-defense
npm install            # einmalig; erzeugt package-lock.json, bitte mit committen
copy .env.example .env.local   # optional, nur für die Cloud-Synchronisierung
npm run dev
```

Öffne <http://localhost:5173>. Das Demo-Paket ist sofort spielbar.

**Auf dem iPhone im WLAN testen:** `npm run dev:host` und die angezeigte Netzwerk-Adresse (z. B. `http://192.168.1.20:5173`) in Safari öffnen. Über `http://` funktionieren Spiel und lokale Speicherung, aber **kein Service Worker und keine Installation als App**: dafür braucht iOS HTTPS. Für den echten PWA-Test die App auf Cloudflare Pages veröffentlichen (Abschnitt 8).

## 3. Tests und Produktionsbuild

```powershell
npm run typecheck       # TypeScript (App, Tests, Konfiguration)
npm test                # Vitest: Unit- und Synchronisierungstests
npx playwright install  # einmalig: Testbrowser (Chromium, WebKit, Firefox)
npm run test:e2e        # Playwright: baut die App und testet iPhone- und Desktop-Ansichten
npm run build           # Produktionsbuild nach dist/
npm run preview         # Build lokal ansehen: http://localhost:4173
npm run check           # typecheck + test + build in einem Schritt
```

Was die Tests abdecken:

| Datei | Inhalt |
|---|---|
| `tests/import.test.ts` | Textimport (mehrere Fragen, Leerzeilen, Markdown, CRLF), JSON-Import, Fehlermeldungen, Validierung, Duplikaterkennung |
| `tests/game.test.ts` | richtige/falsche Antworten, Zeitablauf, Leben, Game Over, Punkteberechnung, Wiederholung, Statistik |
| `tests/localStore.test.ts` | lokale Speicherung, Warteschlange, Tombstones, Demo-Paket, Datensicherung |
| `tests/sync.test.ts` | Laptop erstellt Paket A, iPhone Paket B → beide haben A und B; Offline-Änderungen; verlorene Server-Antwort ohne Duplikat; Konflikte (Bearbeiten/Bearbeiten, Löschen/Bearbeiten in beide Richtungen, gelöschtes Paket); veraltetes Gerät stellt Gelöschtes nicht wieder her; erstes Login mit lokalen Daten; Fortschritt beider Geräte; Einstellungen |
| `tests/sql/migration.test.ts` | die **echte SQL-Migration** in PostgreSQL (PGlite): Row Level Security, Rechte, Versionsprüfung, Zähler, Idempotenz |
| `tests/modes.test.ts` | Abwehrmodus kontinuierlich (sofort nächste Frage, Fehler = Game Over, neu mischen), Tippmodus (Normalisierung, −10 Punkte, kein doppelter Abzug, Einschlag), akzeptierte Antworten im Import, Statistik je Modus |
| `tests/displayAndSpeed.test.ts` | Aufteilung arabisch/lateinischer Texte, Geschwindigkeit «Stillstand» in beiden Modi |
| `tests/lernarcade.test.ts` | Snake (Feld, Geschwindigkeiten, Früchte, richtige/falsche Frucht, Wand, Körper, keine Umkehr), Spiel-Registry, Statistik je Spiel, Synchronisierung der Snake-Daten |
| `tests/config.test.ts` | lokaler Modus ohne Konfiguration; geheime Schlüssel werden im Frontend abgelehnt |
| `e2e/app.spec.ts` | keine überlappenden Bedienelemente / kein horizontales Überlaufen auf iPhone 13 Pro Max (hoch/quer), iPhone SE und Laptop; Spiel per Klick und Tastatur; Import; Manifest und Icons |

Die Synchronisierungsszenarien laufen zweimal: gegen eine In-Memory-Nachbildung und gegen die echte Migration in PGlite.

## 4. Fragen importieren

Menü **Lernpakete → Importieren** (oder Dashboard → «Fragen importieren»).

### Textformat

```
Frage: Was versteht man unter einer funktionalen Anforderung?
A) Eine Beschreibung einer Systemfunktion
B) Eine Vorgabe zur Hardwareleistung
C) Eine Beschreibung der Projektkosten
Richtig: A
Erklärung: Funktionale Anforderungen beschreiben die Funktionen eines Systems.
Schwierigkeit: leicht        (optional: leicht | mittel | schwer)
Kategorie: Requirements      (optional)
Auch richtig: Systemfunktion; Funktion   (optional, nur Tippmodus, getrennt mit ; oder |)
```

- Beliebig viele Fragen hintereinander; Leerzeilen, `**Fettschrift**`, Aufzählungszeichen und Nummerierungen («Frage 3:») werden toleriert.
- `Richtig:` akzeptiert den Buchstaben (`A`, `b)`) oder den Antworttext.
- Mehrzeilige Fragen und Erklärungen sind erlaubt.

### JSON

```json
[
  {
    "id": "optional, UUID",
    "question": "Was ist ein Byte?",
    "answers": ["8 Bit", "4 Bit", "16 Bit"],
    "correctIndex": 0,
    "explanation": "Ein Byte besteht aus 8 Bit.",
    "difficulty": 1,
    "category": "Grundlagen"
  }
]
```

Optional für den Tippmodus: `"acceptedAnswers": ["Zaster", "Moneten"]` für weitere gültige Schreibweisen oder Übersetzungen. Die Hauptlösung ist immer `answers[correctIndex]`.

Auch `{ "name": "Java", "description": "…", "questions": [ … ] }` wird erkannt (so sieht der Export eines Lernpakets aus). `difficulty`: 1 bis 3 oder «leicht/mittel/schwer».

### Prüfung vor dem Import

- **Vorschau** jeder erkannten Frage mit Status *neu*, *Duplikat*, *ähnlich* oder *Fehler*.
- **Fehler** (nicht genau 3 Antworten, fehlende/ungültige Lösung, gleiche Antworten, leerer Fragetext, zu lange Texte) werden angezeigt und **nie übernommen**. Zeilen, die zu keiner Frage gehören, werden gemeldet.
- **Duplikate** (gleiche Frage mit gleichen Antworten, unabhängig von Gross-/Kleinschreibung und Satzzeichen) sind standardmässig abgewählt, *ähnliche* Fragen ebenfalls. Beides kann bewusst angewählt werden.
- Standard ist **«Neue Fragen ergänzen»**: Eine vorhandene Sammlung wird nie überschrieben. «Alle vorhandenen Fragen ersetzen» muss ausdrücklich gewählt und bestätigt werden.

## 5. Supabase einrichten

1. Konto auf <https://supabase.com> erstellen → **New project** (Region z. B. *Central EU (Frankfurt)* oder *Zurich*, falls verfügbar). Das Datenbank-Passwort sicher aufbewahren.
2. **Datenbank einrichten:** Migration ausführen (Abschnitt 6).
3. **Authentication → Sign In / Providers → Email** aktivieren («Confirm email» eingeschaltet lassen).
4. **Authentication → URL Configuration**
   - *Site URL*: deine Produktionsadresse, z. B. `https://meteor-defense.pages.dev`
   - *Redirect URLs*: zusätzlich `http://localhost:5173/**`, `http://localhost:4173/**` und bei Bedarf `https://*.meteor-defense.pages.dev/**` (Vorschau-Deployments).
5. **Schlüssel holen:** Dashboard → **Connect** (bzw. *Project Settings → API Keys*):
   - *Project URL* → `VITE_SUPABASE_URL`
   - **Publishable key** (`sb_publishable_…`) → `VITE_SUPABASE_PUBLISHABLE_KEY`
     (ältere Projekte: «anon public» → `VITE_SUPABASE_ANON_KEY`; Supabase stellt die alten anon-/service_role-Schlüssel laut [Migrationsleitfaden](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys) bis Ende 2026 um).
6. Werte in `.env.local` eintragen (lokal) bzw. als Umgebungsvariablen in Cloudflare Pages (Abschnitt 8). Danach `npm run dev` neu starten bzw. neu bauen.

> **Sicherheit:** Im Frontend steht ausschliesslich der öffentliche Schlüssel. Er ist dafür gedacht, im Browser ausgeliefert zu werden; geschützt werden die Daten durch Row Level Security. Den *Secret*-/*service_role*-Schlüssel nie ins Frontend, ins Repository oder in Cloudflare-Build-Variablen eintragen. Die App verweigert die Verwendung eines erkennbar geheimen Schlüssels.

Anmeldung in der App: **Einstellungen → Anmelden / Registrieren**. Nach der Registrierung kommt eine Bestätigungs-E-Mail; nach dem Klick auf den Link in der App mit E-Mail und Passwort anmelden. «Passwort vergessen?» sendet einen Link, über den ein neues Passwort gesetzt wird.

## 6. Datenbankmigrationen

Die Datenbank ist in drei Dateien beschrieben, die **in dieser Reihenfolge** ausgeführt werden:

1. **`supabase/migrations/20261123000000_meteor_defense_schema.sql`**: Tabellen, Indizes, Row Level Security, Rechte, Trigger und die RPC-Funktionen `push_changes` / `pull_changes`.
2. **`supabase/migrations/20261124000000_typing_mode.sql`**: Tippmodus: Spalte `accepted_answers` (Fragen) und `game_type` (Spiele). Bestehende Daten bleiben unverändert.
3. **`supabase/migrations/20261128000000_lernarcade_games.sql`**: LernArcade: erlaubt `game_type = 'snake'`. Keine neuen Tabellen oder Spalten; Snake-Einstellungen liegen im bestehenden Einstellungs-Datensatz.

Alle Migrationen sind wiederholbar. Wer Supabase bereits nutzt, führt nur die noch fehlende Datei aus. Ohne die dritte Migration werden Snake-Spiele lokal gespeichert, aber nicht in die Cloud übertragen (sie erscheinen in den Einstellungen unter «Nicht übertragbare Änderungen» und lassen sich nach der Migration erneut senden).

**Variante A (SQL Editor, einfach):** Supabase-Dashboard → **SQL Editor** → *New query* → Inhalt der ersten Datei einfügen → **Run**, danach dasselbe mit den weiteren Dateien. Erwartet: «Success. No rows returned».

**Variante B (Supabase CLI):**
```powershell
npx supabase login
npx supabase link --project-ref DEIN-PROJEKT-REF
npx supabase db push
```

**Kontrolle:** Im *Table Editor* erscheinen `decks`, `questions`, `user_settings`, `sync_conflicts`, `game_sessions`, `answer_events`, jeweils mit dem Hinweis «RLS enabled».

Spätere Änderungen am Schema immer als **neue** Datei in `supabase/migrations/` anlegen (Dateiname mit neuerem Zeitstempel), nie bestehende Migrationen ändern.

## 7. Sichere Synchronisierung

Ziel: Laptop und iPhone sehen dieselben Lernpakete, Fragen, Einstellungen und Fortschritte, **ohne dass je ein Gerät die Daten des anderen ersetzt**.

**Grundprinzip «local first»:** Jede Änderung wird zuerst in IndexedDB gespeichert und in derselben Transaktion in eine **Warteschlange (Outbox)** eingetragen. Die App funktioniert dadurch offline; nichts geht verloren, wenn die Verbindung abbricht oder die App geschlossen wird.

| Mechanismus | Wirkung |
|---|---|
| **UUID pro Datensatz** (auf dem Gerät erzeugt) | Pakete von Laptop und iPhone haben verschiedene IDs und werden zusammengeführt, nie ersetzt |
| **Einzelne Datensätze** statt Gesamtstand | Es wird nur übertragen, was sich geändert hat; Datensätze werden einzeln geprüft |
| **Versionsnummer** (optimistische Sperre) | Der Server übernimmt eine Änderung nur, wenn sie auf der aktuellen Version basiert. Sonst meldet er einen Konflikt und überschreibt nichts |
| **Server-Zähler** (`server_seq`, pro Benutzer streng fortlaufend) | Jedes Gerät holt «alles nach Zähler X», auch nach Wochen offline wird nichts verpasst |
| **Tombstones** (Löschmarker statt Löschen) | Gelöschte Inhalte bleiben als «gelöscht» bekannt. Ein Gerät mit alter Offline-Kopie kann sie nicht wiederherstellen |
| **Unveränderliche Spielereignisse** | Jede Antwort und jedes Spiel ist ein eigener Datensatz. Fortschritte beider Geräte addieren sich; Highscore und Statistik werden daraus berechnet |
| **Idempotenz** | Wird eine Änderung nach einem Verbindungsabbruch erneut gesendet, entsteht kein Duplikat |

**Konflikte** (beide Geräte ändern denselben Datensatz):
1. Gleicher Inhalt → automatisch erledigt.
2. Verschiedene Felder geändert (z. B. Name auf dem Laptop, Beschreibung auf dem iPhone) → automatischer Drei-Wege-Merge.
3. Dasselbe Feld unterschiedlich geändert, oder Löschen gegen Bearbeiten → **Konflikt**: Die Version des Geräts wird in einem eigenen, ebenfalls synchronisierten Konfliktdatensatz gesichert; der Benutzer entscheidet in der **Konfliktzentrale** («Diese Version verwenden», «Aktuelle behalten», «Beide behalten», «Wiederherstellen», «Trotzdem löschen»). Bis dahin sind **beide Versionen erhalten**.
4. Löschungen werden nur ausgeführt, wenn sie auf dem aktuellen Stand beruhen. Hat ein anderes Gerät inzwischen Fragen in einem Paket geändert, wird die Paket-Löschung nicht ausgeführt, sondern als Konflikt angezeigt. Fragen, die ein Gerät in ein anderswo gelöschtes Paket schreibt, landen ebenfalls im Konflikt und können mitsamt Paket wiederhergestellt werden.

**Auslöser:** App-Start, Anmeldung, jede lokale Änderung (nach 1,5 s), Rückkehr der Verbindung, Zurückkehren in die App und alle 60 Sekunden. Der Status ist oben rechts und auf dem Dashboard sichtbar (*Nur lokal*, *Nicht angemeldet*, *Offline · N lokal*, *Synchronisiere …*, *N ausstehend*, *Synchronisiert*, *Sync-Fehler*); bei jedem Lernpaket steht, ob es lokal oder bereits synchron ist.

**Erstes Login:** Bereits lokal angelegte Pakete werden ins Konto übernommen und mit den Paketen anderer Geräte zusammengeführt. Das Demo-Paket hat auf allen Geräten dieselben IDs und erscheint deshalb nicht doppelt.

**Abmelden:** Vorher wird synchronisiert. Sind Änderungen noch nicht übertragen (z. B. offline), warnt die App und empfiehlt eine Sicherung. Nach dem Abmelden werden die Kontodaten von diesem Gerät entfernt (sie bleiben in der Cloud). Meldet sich auf einem Gerät ein **anderes** Konto an, werden die lokalen Daten des alten Kontos erst nach Bestätigung entfernt. Konten vermischen sich nie.

**Row Level Security:** Jede Tabelle erlaubt Lesen/Schreiben nur für `auth.uid() = user_id`; direktes Löschen ist gesperrt, anonyme Zugriffe sind verboten.

## 8. Deployment auf Cloudflare Pages

**Voraussetzung:** Projekt in einem Git-Repository (z. B. GitHub) mit committeter `package-lock.json` (entsteht bei `npm install`).

```powershell
git init
git add .
git commit -m "LernArcade"
git remote add origin https://github.com/DEIN-NAME/meteor-defense.git
git push -u origin main
```

**Variante A (Git-Integration, empfohlen):**
1. Cloudflare-Dashboard → **Workers & Pages** → *Create* → *Pages* → **Connect to Git** → Repository wählen.
2. Build-Einstellungen:
   - Framework preset: **Vite** (oder «None»)
   - Build command: `npm run build`
   - Build output directory: `dist`
3. **Environment variables** (Production *und* Preview):
   - `VITE_SUPABASE_URL` = `https://DEIN-PROJEKT.supabase.co`
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = `sb_publishable_…`
   - optional `NODE_VERSION` = `22` (die Datei `.node-version` gibt bereits 22 vor)
4. **Save and Deploy.** Jeder Push auf `main` veröffentlicht automatisch eine neue Version.
5. Die erhaltene Adresse (z. B. `https://meteor-defense.pages.dev`) in Supabase als *Site URL* eintragen (Abschnitt 5).

**Variante B (direkt hochladen, ohne Git):**
```powershell
npm run build
npx wrangler pages deploy dist --project-name meteor-defense
```
Achtung: Die `VITE_…`-Variablen werden beim Bauen eingesetzt. Bei Variante B also vorher in `.env.local` bzw. `.env.production.local` eintragen.

Hinweise: Die App nutzt Hash-Routen (`#/decks`), daher sind keine Weiterleitungsregeln nötig. `public/_headers` sorgt dafür, dass `sw.js` und `index.html` nicht zwischengespeichert werden (Updates kommen sofort an), während Build-Dateien mit Hash lange gecacht werden. Cloudflare empfiehlt für neue Projekte inzwischen auch *Workers mit Static Assets*; diese App läuft dort ebenso, die Anleitung beschreibt wie gewünscht Pages.

## 9. Installation auf dem iPhone

1. Die veröffentlichte Adresse (HTTPS) in **Safari** öffnen.
2. **Teilen**-Symbol → **«Zum Home-Bildschirm»** → Name «LernArcade» → *Hinzufügen*.
3. LernArcade über das neue **App-Symbol** starten: Vollbild ohne Safari-Leiste, eigenes Logo und Startbildschirm.
4. In der App **Einstellungen → Anmelden** und mit demselben Konto wie auf dem Laptop anmelden.

Wichtig:
- Die installierte App hat auf iOS einen **eigenen Speicher, getrennt von Safari**. Wer sich vorher in Safari angemeldet hat, meldet sich in der App noch einmal an. Den Bestätigungslink aus der Registrierungs-E-Mail darf man in Safari öffnen; danach in der App anmelden.
- Nach dem ersten Laden funktioniert die App offline; Änderungen werden später automatisch übertragen.
- Die automatische Löschung von Website-Daten nach 7 Tagen ohne Nutzung betrifft auf iOS Websites in Safari, nicht zum Home-Bildschirm hinzugefügte Web-Apps. Die Cloud-Synchronisierung und der JSON-Export schützen zusätzlich vor Datenverlust.
- Optimiert für iPhone 13 Pro Max (hoch und quer); Startbilder liegen für alle aktuellen iPhone-Grössen bei.

## 10. Installation als Desktop-App unter Windows

- **Microsoft Edge:** Adresse öffnen → Symbol «App verfügbar» in der Adressleiste (oder Menü **… → Apps → Diese Website als App installieren**).
- **Google Chrome:** Installationssymbol rechts in der Adressleiste (oder Menü **⋮ → Streamen, speichern und teilen → Seite als App installieren**).
- In der App gibt es ausserdem **Einstellungen → Als App installieren**, sobald der Browser die Installation anbietet.
- Danach startet LernArcade aus dem Startmenü/der Taskleiste in einem eigenen Fenster mit eigenem Symbol.
- **Firefox:** Die App ist im Browser vollständig nutzbar; die Installation als eigene App hängt von der Firefox-Version ab.

## 11. Datensicherung und Wiederherstellung

- **Sicherung:** *Einstellungen → Datensicherung → Sicherung exportieren* erzeugt `meteor-defense-sicherung-JJJJ-MM-TT.json` mit allen Lernpaketen, Fragen, Einstellungen und dem Lernfortschritt. Auf dem iPhone öffnet sich das Teilen-Menü («In Dateien sichern»).
- **Einzelnes Lernpaket:** *Lernpakete → Export*. Die Datei kann auf jedem Gerät wieder importiert werden.
- **Wiederherstellung:** *Einstellungen → Datensicherung → Sicherung wiederherstellen* → Datei wählen → Vorschau prüfen → Pakete auswählen → *Wiederherstellen*.
  - Es wird nur **ergänzt**: Vorhandene Pakete und Fragen werden nie überschrieben, Duplikate übersprungen.
  - Gelöschte Inhalte werden nur zurückgeholt, wenn «Gelöschte Inhalte aus der Sicherung zurückholen» angehakt ist.
  - Wiederhergestellte Daten werden anschliessend normal synchronisiert.
- **Cloud-Sicherung:** Supabase sichert die Datenbank (je nach Plan täglich); zusätzlich ist ein regelmässiger JSON-Export empfehlenswert.

---

## Spiele der LernArcade

Alle Spiele nutzen **dieselben Lernpakete, Fragen, Benutzerkonten und Spielereignisse**. Es entstehen keine Kopien von Fragen. Unter **Spiele** wählst du einmal ein Lernpaket; es bleibt beim Wechsel zwischen den Spielen erhalten. «Spielen» in einem Lernpaket führt direkt zur Spielauswahl.

| Spiel | Adresse | Besonderheiten |
|---|---|---|
| Meteor Defense | `#/games/meteor-defense` | Weltraumdesign, Abwehr- und Tippmodus (siehe unten). Die alte Adresse `#/play` leitet hierher. |
| Snake | `#/games/snake` | Eigenes grünes Design, Konfigurationsbildschirm mit Kartengrösse und Geschwindigkeit |

**Snake**
- Oben steht die Frage, auf dem Feld liegen drei Früchte (Apfel, Orange, Traube) mit je einer Antwort. Die richtige Antwort liegt jedes Mal zufällig auf einer anderen Frucht.
- Richtige Frucht: Die Schlange wächst, du bekommst Punkte, die nächste Frage erscheint mit drei neuen Früchten.
- Falsche Frucht: Sie wird zur Bombe und explodiert, das Spiel endet. Das Ergebnis zeigt die richtige Antwort.
- Wand oder eigener Körper beenden das Spiel ebenfalls. Eine Umkehr um 180 Grad ist nicht möglich.
- Die Schlange startet erst nach der ersten Richtungseingabe, so bleibt Zeit, die erste Frage zu lesen.
- **Steuerung:** Windows mit Pfeiltasten oder WASD, Leertaste oder Esc für Pause. iPhone mit Wischen auf dem Spielfeld oder dem Steuerkreuz unter dem Feld. Die Seite scrollt dabei nicht.
- **Kartengrösse:** klein (11 Felder auf der kurzen Seite) oder gross (17 Felder); die lange Seite passt sich dem Bildschirm an.
- **Geschwindigkeit:** langsam (220 ms pro Schritt), mittel (155 ms), schnell (105 ms). Beides ist unabhängig wählbar und wird mit dem Konto synchronisiert.
- **Punkte:** wie in Meteor Defense nach Schwierigkeit und Serie; der Bonus richtet sich nach dem kürzesten Weg zur richtigen Frucht.
- Fragen ohne drei unterschiedliche Antworten werden übersprungen (mit Hinweis), es werden keine Antworten erfunden.
- Antworten mit arabischer Schrift und Umschrift werden wie in Meteor Defense mit getrennten Schreibrichtungen dargestellt.

**Ein weiteres Spiel ergänzen:** Eintrag in `src/games/registry.ts`, Seite unter `src/games/<spiel>/`, Route in `src/App.tsx` und eine neue Spielvariante für `game_sessions.game_type` (kleine Migration wie `20261128000000_lernarcade_games.sql`). Fragen laden über `src/games/questions.ts`, Runden und Antworten speichern über `useGameRecorder` aus `src/games/shared.tsx`.

## Spielregeln und Punkte

Die folgenden Regeln gelten für **Meteor Defense**.

Nach der Wahl eines Lernpakets wählst du den **Spielmodus** (der zuletzt gewählte wird gemerkt). Beide Modi nutzen dieselben Lernpakete, das Tempo aus den Einstellungen und denselben Fortschritt.

**Abwehrmodus**
- Eine Frage, drei Meteoriten mit je einer Antwort. Tippe/klicke in die Spalte des richtigen Meteoriten (grosse Trefferflächen) oder drücke **1/2/3** (bzw. A/B/C).
- Richtig: Der Meteorit explodiert und **die nächste Frage erscheint sofort**: ohne Zwischenbildschirm.
- **Eine falsche Antwort oder ein Einschlag beendet das Spiel.** Das Ergebnis zeigt die richtige Lösung mit Erklärung.
- Endlos: Ist das Paket durchgespielt, wird es neu gemischt; keine Frage kommt doppelt, bevor alle einmal dran waren.

**Tippmodus**
- Ein Meteorit fällt, die Frage steht oben. Antwort eintippen und mit **Enter** (Windows) bzw. der **Senden-Taste** der Bildschirmtastatur (iPhone) abschicken. Eine vollständig richtig eingetippte Antwort wird sofort als Treffer erkannt. Punkte werden nur beim ausdrücklichen Abschicken abgezogen, nie pro Tastendruck.
- Richtig (Gross-/Kleinschreibung, Leerzeichen am Rand und doppelte Leerzeichen egal): Abschuss, Punkte, nächster Meteorit sofort.
- Falsch: **−10 Punkte** (nie unter 0), das Feld wird geleert und bleibt aktiv, der Meteorit fällt weiter. Nur ausdrücklich abgeschickte Eingaben zählen.
- Erreicht der Meteorit den Schutzschild: Game Over. Die Fallzeit berücksichtigt die Länge der Frage und der Lösung.
- iPhone: Das Spielfeld passt sich der Bildschirmtastatur an; Antippen des Spielfelds schliesst die Tastatur nicht.
- In der Statistik zählt eine Frage im Tippmodus als richtig, wenn sie beim ersten Versuch stimmt.

**Tempo:** Gemütlich, Normal, Schnell oder **Stillstand (unbegrenzte Zeit)**. Bei Stillstand bleiben die Meteoriten stehen, es gibt keinen Zeitablauf und keinen Tempobonus; Fehler wirken wie gewohnt (Abwehrmodus: Game Over, Tippmodus: −10 Punkte). Über Pause → «Spiel beenden» erscheint das Ergebnis.

**Arabische und gemischte Texte:** Antwortbeschriftungen der Meteoriten sind HTML-Elemente über dem Spielfeld, die den Meteoriten folgen. Arabischer Text und lateinische Umschrift (z. B. «حَدِيقَة (ḥadīqa)») erhalten jeweils eine eigene, isolierte Schreibrichtung (RTL bzw. LTR), Vokalzeichen werden vollständig dargestellt, Wörter nicht getrennt; bei Platzmangel stehen Arabisch und Umschrift auf zwei Zeilen und die Schrift wird verkleinert. Die gespeicherten Fragen bleiben unverändert.

**Punkte (beide Modi):** Grundpunkte (leicht 80, mittel 100, schwer 130) + **Tempobonus** bis +50 % je nach Restzeit, multipliziert mit dem **Serienbonus** (+10 % pro Treffer in Folge, max. ×1,5). Highscores werden pro Modus geführt.

**Wiederholen:** «Fehlerhafte Fragen wiederholen» stellt jede falsch beantwortete Frage genau einmal. **Esc** pausiert; das Spiel pausiert auch automatisch, wenn die App in den Hintergrund geht.

## Logo und Icons

**LernArcade** (Plattform): vier leuchtende Spielkacheln für die verschiedenen Spiele. Definiert in `scripts/generate-icons.mjs`, Quellen in `branding/lernarcade/`.

| Datei | Zweck |
|---|---|
| `branding/lernarcade/lernarcade-logo.svg`, `…-square.svg`, `…-maskable.svg`, `…-1024.png` | Quelldateien |
| `public/icons/logo.svg` | Logo in der Kopfzeile und auf der Startseite |
| `public/favicon.ico` (16/32/48), `favicon-16.png`, `favicon-32.png`, `favicon.svg` | Browser-Tab |
| `public/apple-touch-icon.png` (180 × 180) | iPhone-Home-Bildschirm |
| `public/icons/icon-192.png`, `icon-512.png` | PWA-Manifest (Windows, Android) |
| `public/icons/maskable-192.png`, `maskable-512.png` | maskierbare Icons mit Sicherheitsabstand |
| `public/splash/apple-splash-*.png` | iOS-Startbildschirme (hoch und quer) |

**Spiellogos:** `public/games/meteor-defense/logo.svg` (das bisherige Meteor-Defense-Logo, unverändert; Quellen und Generator in `branding/meteor-defense/`) und `public/games/snake/logo.svg`.

Neu erzeugen nach Änderungen: `npx playwright install chromium` und `npm run icons`.

## Fehlerbehebung

| Problem | Lösung |
|---|---|
| «Nur lokal» obwohl Supabase eingerichtet | `.env.local` prüfen (Variablennamen mit `VITE_`), Dev-Server neu starten; auf Cloudflare Variablen setzen und **neu bauen** |
| «Datenbank ist noch nicht eingerichtet» | SQL-Migration ausführen (Abschnitt 6) |
| Bestätigungslink führt auf falsche Adresse | *Site URL* / *Redirect URLs* in Supabase anpassen |
| iPhone zeigt alte Version | App schliessen und neu öffnen; bei «Neue Version verfügbar» auf *Aktualisieren* tippen |
| Konflikt angezeigt | *Einstellungen → Konflikte lösen*. Beide Versionen sind gesichert |
| Änderung «konnte nicht übertragen werden» | *Einstellungen → Konto & Synchronisierung*: erneut versuchen oder verwerfen |
| `npm ci` schlägt auf Cloudflare fehl | `package-lock.json` lokal mit `npm install` neu erzeugen und committen; Build-System-Version auf v3 (Node 22) stellen |
