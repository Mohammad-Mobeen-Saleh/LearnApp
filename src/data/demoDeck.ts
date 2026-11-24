import type { AnswerIndex, AnswerTriple, Deck, Difficulty, Question } from '../domain/types.ts';

/**
 * Demo-Lernpaket «Informatik-Grundlagen».
 * Feste UUIDs: Wird das Paket auf Laptop und iPhone lokal angelegt, erkennt die
 * Synchronisierung es als denselben Datensatz – es entstehen keine Duplikate.
 */

export const DEMO_DECK_ID = 'de300000-0000-4000-8000-000000000000';

type DemoQuestion = [string, AnswerTriple, AnswerIndex, string, Difficulty, string];

const DEMO_QUESTIONS: DemoQuestion[] = [
  [
    'Was beschreibt ein Algorithmus?',
    ['Eine Programmiersprache für Berechnungen', 'Eine eindeutige, endliche Folge von Anweisungen', 'Ein Hardwarebauteil zur Datenverarbeitung'],
    1,
    'Ein Algorithmus ist eine präzise, endliche Handlungsvorschrift zur Lösung eines Problems – unabhängig von der Programmiersprache.',
    1,
    'Grundlagen',
  ],
  [
    'Wie viele unterschiedliche Werte kann ein Byte (8 Bit) darstellen?',
    ['128', '255', '256'],
    2,
    '2⁸ = 256 Werte, zum Beispiel die Zahlen 0 bis 255.',
    1,
    'Grundlagen',
  ],
  [
    'Welcher Dezimalzahl entspricht die Binärzahl 1011?',
    ['11', '13', '9'],
    0,
    '1·8 + 0·4 + 1·2 + 1·1 = 11.',
    1,
    'Grundlagen',
  ],
  [
    'Nach welchem Prinzip arbeitet ein Stack (Stapel)?',
    ['First In, First Out (FIFO)', 'Last In, First Out (LIFO)', 'Zufälliger Zugriff auf alle Elemente'],
    1,
    'Das zuletzt abgelegte Element wird zuerst wieder entnommen (push/pop).',
    1,
    'Datenstrukturen',
  ],
  [
    'Welche Datenstruktur arbeitet nach dem FIFO-Prinzip?',
    ['Binärbaum', 'Stack', 'Queue (Warteschlange)'],
    2,
    'In einer Queue wird das zuerst eingefügte Element auch zuerst entnommen.',
    1,
    'Datenstrukturen',
  ],
  [
    'Welche Zeitkomplexität hat die binäre Suche in einem sortierten Array?',
    ['O(n)', 'O(log n)', 'O(n²)'],
    1,
    'Der Suchbereich wird in jedem Schritt halbiert – daher logarithmische Laufzeit.',
    2,
    'Algorithmen',
  ],
  [
    'Was ist eine Voraussetzung für die binäre Suche?',
    ['Die Daten müssen sortiert sein', 'Die Daten müssen Zahlen sein', 'Die Liste darf höchstens 1000 Elemente haben'],
    0,
    'Nur in sortierten Daten kann man anhand des mittleren Elements entscheiden, in welcher Hälfte weitergesucht wird.',
    2,
    'Algorithmen',
  ],
  [
    'Welche Komplexität hat der Zugriff auf ein Array-Element über seinen Index?',
    ['O(n)', 'O(log n)', 'O(1)'],
    2,
    'Die Speicheradresse lässt sich direkt aus dem Index berechnen – konstante Zeit.',
    2,
    'Algorithmen',
  ],
  [
    'Was versteht man unter Kapselung in der objektorientierten Programmierung?',
    [
      'Daten und Methoden werden gebündelt, der direkte Zugriff von aussen wird eingeschränkt',
      'Mehrere Klassen werden in einer Datei gespeichert',
      'Ein Programm wird in eine ausführbare Datei kompiliert',
    ],
    0,
    'Kapselung schützt den inneren Zustand eines Objekts; der Zugriff erfolgt über definierte Methoden.',
    2,
    'Objektorientierung',
  ],
  [
    'Was ermöglicht Vererbung?',
    [
      'Ein Objekt kopiert sich selbst in den Speicher',
      'Eine Klasse übernimmt Eigenschaften und Methoden einer anderen Klasse',
      'Variablen behalten ihren Wert nach Programmende',
    ],
    1,
    'Eine Unterklasse erbt von einer Oberklasse und kann deren Verhalten erweitern oder überschreiben.',
    1,
    'Objektorientierung',
  ],
  [
    'Was bedeutet Polymorphie?',
    [
      'Ein Programm läuft auf mehreren Betriebssystemen',
      'Eine Klasse darf nur ein einziges Objekt erzeugen',
      'Derselbe Methodenaufruf verhält sich je nach Objekttyp unterschiedlich',
    ],
    2,
    'Beispiel: zeichne() wird für Kreis und Rechteck jeweils passend ausgeführt.',
    2,
    'Objektorientierung',
  ],
  [
    'Wofür steht die Abkürzung SQL?',
    ['Structured Query Language', 'Simple Question Logic', 'System Quality Level'],
    0,
    'SQL ist die Standardsprache zum Abfragen und Bearbeiten relationaler Datenbanken.',
    1,
    'Datenbanken',
  ],
  [
    'Welche SQL-Anweisung liest Daten aus einer Tabelle?',
    ['UPDATE', 'SELECT', 'INSERT'],
    1,
    'SELECT liest Daten, INSERT fügt hinzu, UPDATE ändert bestehende Datensätze.',
    1,
    'Datenbanken',
  ],
  [
    'Was ist ein Primärschlüssel?',
    ['Das Passwort für den Datenbankzugriff', 'Die erste Spalte jeder Tabelle', 'Ein Attribut, das jeden Datensatz eindeutig identifiziert'],
    2,
    'Der Primärschlüssel ist eindeutig und darf nicht leer sein.',
    1,
    'Datenbanken',
  ],
  [
    'Was beschreibt ein Fremdschlüssel?',
    ['Einen Verweis auf den Primärschlüssel einer anderen Tabelle', 'Einen verschlüsselten Datensatz', 'Einen Zugangsschlüssel für externe Benutzer'],
    0,
    'Fremdschlüssel verknüpfen Tabellen und sichern die referenzielle Integrität.',
    2,
    'Datenbanken',
  ],
  [
    'Welches Protokoll übersetzt Domainnamen in IP-Adressen?',
    ['FTP', 'DNS', 'SMTP'],
    1,
    'Das Domain Name System (DNS) löst Namen wie example.com in IP-Adressen auf.',
    1,
    'Netzwerke',
  ],
  [
    'Welcher HTTP-Statuscode bedeutet «Nicht gefunden»?',
    ['200', '500', '404'],
    2,
    '200 = OK, 404 = Not Found, 500 = interner Serverfehler.',
    1,
    'Netzwerke',
  ],
  [
    'Wodurch unterscheidet sich HTTPS von HTTP?',
    ['Die Verbindung wird mit TLS verschlüsselt', 'HTTPS ist nur für Bilder gedacht', 'HTTPS funktioniert ohne Server'],
    0,
    'TLS verschlüsselt die Übertragung und bestätigt die Identität des Servers über ein Zertifikat.',
    1,
    'Netzwerke',
  ],
  [
    'Wie viele Bit hat eine IPv4-Adresse?',
    ['64', '32', '128'],
    1,
    'IPv4 nutzt 32 Bit (z. B. 192.168.1.10), IPv6 nutzt 128 Bit.',
    2,
    'Netzwerke',
  ],
  [
    'Wie sollten Passwörter in einer Datenbank gespeichert werden?',
    ['Im Klartext, damit der Support helfen kann', 'Base64-kodiert', 'Als Hash mit Salt, z. B. mit bcrypt oder Argon2'],
    2,
    'Langsame Hashverfahren mit Salt erschweren das Knacken gestohlener Passwortdaten erheblich.',
    2,
    'Sicherheit',
  ],
  [
    'Was ist SQL-Injection?',
    ['Einschleusen von SQL-Code über ungeprüfte Eingaben', 'Ein Werkzeug zur Datenbankoptimierung', 'Das automatische Erstellen von Tabellen'],
    0,
    'Schutz bieten parametrisierte Abfragen (Prepared Statements) statt zusammengesetzter SQL-Texte.',
    2,
    'Sicherheit',
  ],
  [
    'Was versteht man unter einer funktionalen Anforderung?',
    ['Eine Beschreibung einer Systemfunktion', 'Eine Vorgabe zur Hardwareleistung', 'Eine Beschreibung der Projektkosten'],
    0,
    'Funktionale Anforderungen beschreiben die Funktionen eines Systems.',
    1,
    'Requirements Engineering',
  ],
  [
    'Welche Aussage beschreibt eine nichtfunktionale Anforderung?',
    ['Der Kunde kann eine Bestellung stornieren', 'Die Suche antwortet in unter 2 Sekunden', 'Das System versendet Rechnungen per E-Mail'],
    1,
    'Nichtfunktionale Anforderungen beschreiben Qualitätseigenschaften wie Leistung, Sicherheit oder Bedienbarkeit.',
    2,
    'Requirements Engineering',
  ],
  [
    'Was ist ein Unit-Test?',
    ['Ein Test der gesamten Anwendung durch Endbenutzer', 'Ein automatisierter Test einer einzelnen Programmeinheit', 'Eine Messung der Bildschirmauflösung'],
    1,
    'Unit-Tests prüfen kleine, isolierte Einheiten wie Funktionen oder Klassen – schnell und automatisch.',
    1,
    'Software Engineering',
  ],
  [
    'Wofür wird Git hauptsächlich eingesetzt?',
    ['Kompilieren von Programmen', 'Verwalten von Datenbankbenutzern', 'Versionsverwaltung von Quellcode'],
    2,
    'Git speichert die Änderungsgeschichte, ermöglicht Branches und die Zusammenarbeit im Team.',
    1,
    'Software Engineering',
  ],
  [
    'Was ist Scrum?',
    ['Ein agiles Vorgehensmodell mit kurzen Iterationen (Sprints)', 'Ein Wasserfallmodell mit festen Phasen', 'Eine Programmiersprache für Webseiten'],
    0,
    'Scrum arbeitet in Sprints mit festen Rollen: Product Owner, Scrum Master und Entwicklungsteam.',
    1,
    'Software Engineering',
  ],
];

export function demoQuestionId(index: number): string {
  return `de300000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
}

export const DEMO_QUESTION_COUNT = DEMO_QUESTIONS.length;

/** Erstellt die Datensätze des Demo-Pakets (Version 0 = noch nicht synchronisiert). */
export function createDemoDeck(nowIso: string): { deck: Deck; questions: Question[] } {
  const deck: Deck = {
    id: DEMO_DECK_ID,
    name: 'Informatik-Grundlagen (Demo)',
    description: 'Fragen zu Algorithmen, Datenstrukturen, Datenbanken, Netzwerken, Sicherheit und Software Engineering.',
    deleted: false,
    version: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
    deviceId: null,
  };
  const questions: Question[] = DEMO_QUESTIONS.map(([question, answers, correctIndex, explanation, difficulty, category], i) => ({
    id: demoQuestionId(i),
    deckId: DEMO_DECK_ID,
    question,
    answers,
    correctIndex,
    explanation,
    difficulty,
    category,
    deleted: false,
    version: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
    deviceId: null,
  }));
  return { deck, questions };
}
