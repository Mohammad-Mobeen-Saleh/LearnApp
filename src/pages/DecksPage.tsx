import { useState } from 'react';
import { useLiveQuery, useServices, useSyncStatus } from '../app/ServicesContext.tsx';
import { navigate } from '../app/router.ts';
import { createDeckExport } from '../data/backup.ts';
import { computeStats } from '../domain/stats.ts';
import { LIMITS, type Deck } from '../domain/types.ts';
import { formatPercent, plural } from '../lib/text.ts';
import { Button, EmptyState, LinkButton, Modal, PageHeader, ProgressBar, slugify, useDownload, useFeedback } from '../ui/components.tsx';
import { Icon } from '../ui/Icon.tsx';

export function DeckForm({ deck, onClose }: { deck?: Deck; onClose: (saved?: Deck) => void }) {
  const { store } = useServices();
  const { toast } = useFeedback();
  const [name, setName] = useState(deck?.name ?? '');
  const [description, setDescription] = useState(deck?.description ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const saved = deck
        ? await store.updateDeck(deck.id, { name, description })
        : await store.createDeck({ name, description });
      toast(deck ? 'Lernpaket gespeichert.' : 'Lernpaket erstellt.', 'success');
      onClose(saved);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={deck ? 'Lernpaket bearbeiten' : 'Neues Lernpaket'}
      onClose={() => onClose()}
      actions={
        <>
          <Button onClick={() => onClose()}>Abbrechen</Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy || !name.trim()}>
            Speichern
          </Button>
        </>
      }
    >
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="field">
          <span>Name</span>
          <input data-autofocus value={name} maxLength={LIMITS.deckName} onChange={(e) => setName(e.target.value)} placeholder="z. B. Java" required />
        </label>
        <label className="field">
          <span>Beschreibung (optional)</span>
          <textarea value={description} maxLength={LIMITS.deckDescription} rows={3} onChange={(e) => setDescription(e.target.value)} />
        </label>
        {error ? <p className="error-text">{error}</p> : null}
      </form>
    </Modal>
  );
}

export function DecksPage() {
  const { store } = useServices();
  const { confirm, toast } = useFeedback();
  const download = useDownload();
  const status = useSyncStatus();
  const decks = useLiveQuery((s) => s.deckSummaries(), []);
  const stats = useLiveQuery(async (s) => {
    const [d, q, se, a] = await Promise.all([s.listDecks(), s.listAllQuestions(), s.listSessions(), s.listAnswers()]);
    return computeStats({ decks: d, questions: q, sessions: se, answers: a });
  }, []);
  const [editing, setEditing] = useState<Deck | 'new' | null>(null);
  const cloudActive = status.phase !== 'local_only' && status.phase !== 'signed_out';

  const remove = async (deck: Deck, count: number) => {
    const ok = await confirm({
      title: 'Lernpaket löschen?',
      message: (
        <>
          <p>
            «{deck.name}» mit {plural(count, 'Frage', 'Fragen')} wird gelöscht
            {cloudActive ? ', und zwar auf allen synchronisierten Geräten.' : '.'}
          </p>
          <p className="muted">
            Hat ein anderes Gerät das Paket inzwischen verändert, wird die Löschung nicht ausgeführt, sondern als Konflikt angezeigt.
          </p>
        </>
      ),
      confirmLabel: 'Endgültig löschen',
      danger: true,
    });
    if (!ok) return;
    await store.deleteDeck(deck.id);
    toast(`«${deck.name}» gelöscht.`, 'success');
  };

  const exportDeck = async (deck: Deck) => {
    const questions = await store.listQuestions(deck.id);
    await download(`lernarcade-${slugify(deck.name)}.json`, JSON.stringify(createDeckExport(deck, questions), null, 2));
  };

  return (
    <div className="page">
      <PageHeader
        title="Lernpakete"
        subtitle="Erstelle, bearbeite, importiere und exportiere deine Fragensammlungen."
        actions={
          <>
            <LinkButton to="/import" icon="import">
              Importieren
            </LinkButton>
            <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>
              Neues Lernpaket
            </Button>
          </>
        }
      />

      {decks && decks.length === 0 ? (
        <EmptyState icon="decks" title="Noch keine Lernpakete">
          <p className="muted">Lege ein Lernpaket an oder importiere vorbereitete Fragen.</p>
          <div className="row center">
            <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>
              Neues Lernpaket
            </Button>
            <LinkButton to="/import" icon="import">
              Fragen importieren
            </LinkButton>
          </div>
        </EmptyState>
      ) : null}

      <div className="deck-grid">
        {(decks ?? []).map(({ deck, questionCount, pending }) => {
          const p = stats?.decks.find((d) => d.deckId === deck.id);
          const mastered = p && p.total > 0 ? p.mastered / p.total : 0;
          return (
            <article key={deck.id} className="card deck-card">
              <a className="deck-card-main" href={`#/decks/${deck.id}`}>
                <div className="deck-card-head">
                  <h2>{deck.name}</h2>
                  <span className={pending ? 'pill pill-pending' : 'pill pill-ok'} title={pending ? 'Änderungen sind lokal gespeichert und noch nicht in der Cloud' : 'Mit der Cloud synchronisiert'}>
                    <Icon name={pending ? 'device' : 'cloudCheck'} size={14} />
                    {pending ? 'lokal' : cloudActive ? 'synchron' : 'gespeichert'}
                  </span>
                </div>
                {deck.description ? <p className="muted clamp-2">{deck.description}</p> : null}
                <div className="deck-card-meta">
                  <span>{plural(questionCount, 'Frage', 'Fragen')}</span>
                  {p ? <span>Gelernt {formatPercent(mastered)}</span> : null}
                  {p && p.toRepeat > 0 ? <span className="warning-text">{p.toRepeat} wiederholen</span> : null}
                </div>
                <ProgressBar value={mastered} tone="success" label="Lernfortschritt" />
              </a>
              <div className="deck-card-actions">
                <Button variant="primary" size="sm" icon="play" disabled={questionCount === 0} onClick={() => navigate(`/games?deck=${deck.id}`)}>
                  Spielen
                </Button>
                <Button size="sm" icon="edit" onClick={() => setEditing(deck)} ariaLabel={`«${deck.name}» bearbeiten`}>
                  Bearbeiten
                </Button>
                <Button size="sm" icon="export" onClick={() => void exportDeck(deck)} ariaLabel={`«${deck.name}» exportieren`}>
                  Export
                </Button>
                <Button size="sm" variant="ghost" icon="trash" onClick={() => void remove(deck, questionCount)} ariaLabel={`«${deck.name}» löschen`} />
              </div>
            </article>
          );
        })}
      </div>

      {editing ? (
        <DeckForm
          deck={editing === 'new' ? undefined : editing}
          onClose={(saved) => {
            const wasNew = editing === 'new';
            setEditing(null);
            if (saved && wasNew) navigate(`/decks/${saved.id}`);
          }}
        />
      ) : null}
    </div>
  );
}
