import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery, useServices } from '../app/ServicesContext.tsx';
import { navigate } from '../app/router.ts';
import { classifyDuplicates, type DuplicateInfo } from '../import/duplicates.ts';
import { parseQuestionJson } from '../import/jsonParser.ts';
import { parseQuestionText, SAMPLE_IMPORT_TEXT, type ParsedItem } from '../import/textParser.ts';
import { ANSWER_LETTERS, type DraftQuestion } from '../domain/types.ts';
import { plural } from '../lib/text.ts';
import { Button, LinkButton, PageHeader, useFeedback } from '../ui/components.tsx';
import { Icon } from '../ui/Icon.tsx';

type Source = 'text' | 'file';
type Mode = 'append' | 'replace';

interface Preview {
  items: ParsedItem[];
  duplicates: (DuplicateInfo | null)[];
  suggestedName: string | null;
  suggestedDescription: string | null;
  fatal: string | null;
  backup: boolean;
}

function buildPreview(
  items: ParsedItem[],
  name: string | null,
  description: string | null,
  against: ReadonlyArray<Pick<DraftQuestion, 'question' | 'answers' | 'correctIndex'> & { id: string }>,
): Preview {
  const valid = items.filter((i): i is ParsedItem & { draft: DraftQuestion } => i.draft !== null);
  const infos = classifyDuplicates(
    valid.map((i) => i.draft),
    against,
  );
  const byIndex = new Map(valid.map((v, k) => [v.index, infos[k]]));
  return {
    items,
    duplicates: items.map((i) => byIndex.get(i.index) ?? null),
    suggestedName: name,
    suggestedDescription: description,
    fatal: items.length === 0 ? 'Es wurden keine Fragen erkannt. Prüfe das Format (siehe Beispiel).' : null,
    backup: false,
  };
}

export function ImportPage({ targetDeckId }: { targetDeckId: string | null }) {
  const { store } = useServices();
  const { confirm, toast } = useFeedback();
  const decks = useLiveQuery((s) => s.listDecks(), []);
  const [source, setSource] = useState<Source>('text');
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [raw, setRaw] = useState<{ kind: 'text' | 'json'; content: string } | null>(null);
  const [target, setTarget] = useState<string>(targetDeckId ?? 'new');
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [mode, setMode] = useState<Mode>('append');
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ deckId: string; added: number; skipped: number; replaced: boolean } | null>(null);

  useEffect(() => {
    if (targetDeckId) setTarget(targetDeckId);
  }, [targetDeckId]);

  const existing = useLiveQuery(
    async (s) => (target === 'new' ? [] : await s.listQuestions(target)),
    [target],
  );

  const preview: Preview | null = useMemo(() => {
    if (!raw) return null;
    const against = mode === 'replace' || target === 'new' ? [] : existing ?? [];
    if (raw.kind === 'json') {
      const result = parseQuestionJson(raw.content);
      if (result.kind === 'backup') {
        return { items: [], duplicates: [], suggestedName: null, suggestedDescription: null, fatal: null, backup: true };
      }
      if (result.kind === 'invalid') {
        return { items: [], duplicates: [], suggestedName: null, suggestedDescription: null, fatal: result.error, backup: false };
      }
      return buildPreview(result.items, result.deckName, result.deckDescription, against);
    }
    return buildPreview(parseQuestionText(raw.content), null, null, against);
  }, [raw, existing, mode, target]);

  // Standardauswahl: neue Fragen ja, Duplikate/ähnliche/fehlerhafte nein
  useEffect(() => {
    if (!preview) return;
    const next: Record<number, boolean> = {};
    preview.items.forEach((item, k) => {
      const dup = preview.duplicates[k];
      next[item.index] = !!item.draft && dup?.status === 'new';
    });
    setSelected(next);
    if (preview.suggestedName && !newName) setNewName(preview.suggestedName);
    if (preview.suggestedDescription && !newDescription) setNewDescription(preview.suggestedDescription);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview]);

  const counts = useMemo(() => {
    const c = { total: 0, valid: 0, errors: 0, duplicates: 0, similar: 0, selected: 0 };
    if (!preview) return c;
    preview.items.forEach((item, k) => {
      c.total += 1;
      if (!item.draft) c.errors += 1;
      else c.valid += 1;
      const d = preview.duplicates[k];
      if (d?.status === 'duplicate') c.duplicates += 1;
      if (d?.status === 'similar') c.similar += 1;
      if (item.draft && selected[item.index]) c.selected += 1;
    });
    return c;
  }, [preview, selected]);

  const loadFile = async (file: File) => {
    const content = await file.text();
    setFileName(file.name);
    const isJson = /\.json$/i.test(file.name) || content.trim().startsWith('{') || content.trim().startsWith('[');
    setRaw({ kind: isJson ? 'json' : 'text', content });
    setDone(null);
  };

  const runImport = async () => {
    if (!preview) return;
    const drafts = preview.items.filter((i) => i.draft && selected[i.index]).map((i) => i.draft!) as DraftQuestion[];
    if (drafts.length === 0) return;
    if (target === 'new' && !newName.trim()) {
      toast('Bitte einen Namen für das neue Lernpaket eingeben.', 'warning');
      return;
    }
    if (mode === 'replace' && target !== 'new') {
      const ok = await confirm({
        title: 'Vorhandene Fragen ersetzen?',
        message: (
          <p>
            Alle {plural(existing?.length ?? 0, 'vorhandene Frage', 'vorhandenen Fragen')} dieses Lernpakets werden gelöscht und durch{' '}
            {plural(drafts.length, 'neue Frage', 'neue Fragen')} ersetzt. Der bisherige Lernfortschritt dieser Fragen wird nicht mehr angezeigt.
          </p>
        ),
        confirmLabel: 'Ersetzen',
        danger: true,
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      let deckId = target;
      if (target === 'new') deckId = (await store.createDeck({ name: newName, description: newDescription })).id;
      if (mode === 'replace' && target !== 'new') await store.replaceQuestions(deckId, drafts);
      else await store.addQuestions(deckId, drafts);
      setDone({ deckId, added: drafts.length, skipped: counts.total - drafts.length, replaced: mode === 'replace' && target !== 'new' });
      toast(`${plural(drafts.length, 'Frage', 'Fragen')} importiert.`, 'success');
      setRaw(null);
      setText('');
      setFileName(null);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader back="/decks" title="Fragen importieren" subtitle="Text einfügen oder JSON-Datei laden. Vor dem Import siehst du eine Vorschau mit Fehler- und Duplikatprüfung." />

      {done ? (
        <div className="card success-card">
          <Icon name="check" size={28} />
          <div>
            <h2>Import abgeschlossen</h2>
            <p>
              {plural(done.added, 'Frage wurde', 'Fragen wurden')} {done.replaced ? 'übernommen (vorherige Fragen ersetzt)' : 'hinzugefügt'}.
              {done.skipped > 0 ? ` ${plural(done.skipped, 'Eintrag wurde', 'Einträge wurden')} nicht übernommen.` : ''}
            </p>
            <div className="row">
              <Button variant="primary" icon="play" onClick={() => navigate(`/play?deck=${done.deckId}`)}>
                Jetzt spielen
              </Button>
              <LinkButton to={`/decks/${done.deckId}`} icon="decks">
                Fragen ansehen
              </LinkButton>
              <Button variant="ghost" onClick={() => setDone(null)}>
                Weitere importieren
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="import-layout">
        <section className="card">
          <div className="segmented" role="tablist" aria-label="Importquelle">
            <button type="button" role="tab" aria-selected={source === 'text'} className={source === 'text' ? 'active' : undefined} onClick={() => setSource('text')}>
              Text einfügen
            </button>
            <button type="button" role="tab" aria-selected={source === 'file'} className={source === 'file' ? 'active' : undefined} onClick={() => setSource('file')}>
              Datei (JSON/Text)
            </button>
          </div>

          {source === 'text' ? (
            <>
              <label className="field">
                <span>Fragen im Textformat</span>
                <textarea
                  className="mono"
                  rows={12}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={'Frage: …\nA) …\nB) …\nC) …\nRichtig: A\nErklärung: …'}
                  spellCheck={false}
                />
              </label>
              <div className="row">
                <Button variant="primary" icon="search" disabled={!text.trim()} onClick={() => { setRaw({ kind: 'text', content: text }); setDone(null); }}>
                  Vorschau erstellen
                </Button>
                <Button variant="ghost" onClick={() => setText(SAMPLE_IMPORT_TEXT)}>
                  Beispiel einfügen
                </Button>
              </div>
              <details className="format-help">
                <summary>Unterstütztes Textformat</summary>
                <pre className="mono">{SAMPLE_IMPORT_TEXT}</pre>
                <p className="muted small">
                  Jede Frage beginnt mit «Frage:». Genau drei Antworten A), B), C). «Richtig:» nennt den Buchstaben oder den Antworttext.
                  Optional: «Erklärung:», «Schwierigkeit: leicht|mittel|schwer», «Kategorie:».
                </p>
              </details>
            </>
          ) : (
            <>
              <label className="file-drop">
                <Icon name="import" size={28} />
                <span>{fileName ?? 'JSON- oder Textdatei auswählen'}</span>
                <input type="file" accept=".json,.txt,application/json,text/plain" onChange={(e) => e.target.files?.[0] && void loadFile(e.target.files[0])} />
              </label>
              <details className="format-help">
                <summary>JSON-Datenmodell</summary>
                <pre className="mono">{`[
  {
    "id": "optional, UUID",
    "question": "Was ist ein Byte?",
    "answers": ["8 Bit", "4 Bit", "16 Bit"],
    "correctIndex": 0,
    "explanation": "Ein Byte besteht aus 8 Bit.",
    "difficulty": 1,
    "category": "Grundlagen"
  }
]`}</pre>
                <p className="muted small">Auch möglich: {'{ "name": "Java", "description": "…", "questions": [ … ] }'}. So sieht der Export eines Lernpakets aus.</p>
              </details>
            </>
          )}
        </section>

        <section className="card">
          <h2>Ziel</h2>
          <label className="field">
            <span>Lernpaket</span>
            <select value={target} onChange={(e) => { setTarget(e.target.value); setMode('append'); }}>
              <option value="new">Neues Lernpaket erstellen</option>
              {(decks ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          {target === 'new' ? (
            <>
              <label className="field">
                <span>Name des neuen Lernpakets</span>
                <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="z. B. Java" maxLength={200} />
              </label>
              <label className="field">
                <span>Beschreibung (optional)</span>
                <input value={newDescription} onChange={(e) => setNewDescription(e.target.value)} maxLength={2000} />
              </label>
            </>
          ) : (
            <fieldset className="choice-group">
              <legend>Vorhandene Fragen ({existing?.length ?? 0})</legend>
              <label className="choice">
                <input type="radio" name="mode" checked={mode === 'append'} onChange={() => setMode('append')} />
                <span>
                  <strong>Neue Fragen ergänzen</strong>
                  <small className="muted">Vorhandene Fragen bleiben unverändert, Duplikate werden übersprungen.</small>
                </span>
              </label>
              <label className="choice">
                <input type="radio" name="mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />
                <span>
                  <strong>Alle vorhandenen Fragen ersetzen</strong>
                  <small className="muted">Nur wählen, wenn die Sammlung bewusst neu aufgebaut werden soll.</small>
                </span>
              </label>
            </fieldset>
          )}
        </section>
      </div>

      {preview?.backup ? (
        <div className="card banner-warning">
          <p>
            Diese Datei ist eine vollständige Datensicherung. Sie wird unter <a href="#/settings">Einstellungen → Datensicherung</a> wiederhergestellt.
          </p>
        </div>
      ) : null}
      {preview?.fatal ? <div className="card error-card">{preview.fatal}</div> : null}

      {preview && preview.items.length > 0 ? (
        <section className="card import-preview">
          <div className="preview-head">
            <h2>Vorschau</h2>
            <div className="preview-counts">
              <span className="pill pill-ok">{counts.valid} gültig</span>
              {counts.errors ? <span className="pill pill-error">{counts.errors} mit Fehlern</span> : null}
              {counts.duplicates ? <span className="pill pill-warning">{counts.duplicates} Duplikate</span> : null}
              {counts.similar ? <span className="pill pill-pending">{counts.similar} ähnlich</span> : null}
            </div>
          </div>
          <ol className="preview-list">
            {preview.items.map((item, k) => {
              const dup = preview.duplicates[k];
              const status = !item.draft ? 'error' : dup?.status ?? 'new';
              return (
                <li key={item.index} className={`preview-item preview-${status}`}>
                  <label className="preview-check">
                    <input
                      type="checkbox"
                      disabled={!item.draft}
                      checked={!!item.draft && !!selected[item.index]}
                      onChange={(e) => setSelected({ ...selected, [item.index]: e.target.checked })}
                      aria-label={`Frage ${item.index} importieren`}
                    />
                  </label>
                  <div className="preview-body">
                    <div className="preview-title">
                      <span className="muted small">{raw?.kind === 'json' ? `Eintrag ${item.line}` : `Zeile ${item.line}`}</span>
                      <span className={`pill pill-${status === 'error' ? 'error' : status === 'duplicate' ? 'warning' : status === 'similar' ? 'pending' : 'ok'}`}>
                        {status === 'error' ? 'Fehler' : status === 'duplicate' ? 'Duplikat' : status === 'similar' ? 'ähnlich' : 'neu'}
                      </span>
                    </div>
                    <strong>{item.draft?.question ?? item.preview}</strong>
                    {item.draft ? (
                      <ul className="answer-list compact">
                        {item.draft.answers.map((a, i) => (
                          <li key={i} className={i === item.draft!.correctIndex ? 'correct' : undefined}>
                            <span className="letter">{ANSWER_LETTERS[i]}</span>
                            <span>{a}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {item.errors.length ? (
                      <ul className="error-list">
                        {item.errors.map((e) => (
                          <li key={e}>{e}</li>
                        ))}
                      </ul>
                    ) : null}
                    {dup?.reason ? <p className="warning-text small">{dup.reason}</p> : null}
                    {item.warnings.length ? (
                      <ul className="warning-list">
                        {item.warnings.map((w) => (
                          <li key={w}>{w}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="preview-footer">
            <p className="muted small">
              Fehlerhafte Einträge werden nicht übernommen. Korrigiere sie im Text und erstelle die Vorschau neu.
            </p>
            <Button variant="primary" size="lg" icon="import" disabled={busy || counts.selected === 0} onClick={() => void runImport()}>
              {counts.selected === 0 ? 'Keine Fragen ausgewählt' : `${plural(counts.selected, 'Frage', 'Fragen')} importieren`}
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
