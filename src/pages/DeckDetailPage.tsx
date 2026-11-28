import { useMemo, useState } from 'react';
import { useLiveQuery, useServices } from '../app/ServicesContext.tsx';
import { navigate } from '../app/router.ts';
import { createDeckExport } from '../data/backup.ts';
import { computeQuestionProgress } from '../domain/stats.ts';
import { ANSWER_LETTERS, DIFFICULTY_LABELS, type Question } from '../domain/types.ts';
import { normalizeText, plural } from '../lib/text.ts';
import { Button, EmptyState, LinkButton, PageHeader, slugify, useDownload, useFeedback } from '../ui/components.tsx';
import { Icon } from '../ui/Icon.tsx';
import { DeckForm } from './DecksPage.tsx';
import { QuestionEditor } from './QuestionEditor.tsx';

export function DeckDetailPage({ deckId }: { deckId: string }) {
  const { store } = useServices();
  const { confirm, toast } = useFeedback();
  const download = useDownload();
  const deck = useLiveQuery((s) => s.getDeck(deckId), [deckId]);
  const questions = useLiveQuery((s) => s.listQuestions(deckId), [deckId]);
  const pendingIds = useLiveQuery(async (s) => new Set((await s.listOutbox()).map((e) => e.id)), []);
  const progress = useLiveQuery(async (s) => computeQuestionProgress(await s.listAnswers()), []);
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<Question | 'new' | null>(null);
  const [editDeck, setEditDeck] = useState(false);

  const visible = useMemo(() => {
    const f = normalizeText(filter);
    if (!f) return questions ?? [];
    return (questions ?? []).filter((q) =>
      normalizeText(`${q.question} ${q.answers.join(' ')} ${q.category} ${q.explanation}`).includes(f),
    );
  }, [questions, filter]);

  if (deck === undefined && questions === undefined) return <div className="loading">Lade …</div>;
  if (!deck || deck.deleted) {
    return (
      <EmptyState icon="decks" title="Lernpaket nicht gefunden">
        <p className="muted">Es wurde gelöscht oder ist auf diesem Gerät noch nicht vorhanden.</p>
        <LinkButton to="/decks">Zu den Lernpaketen</LinkButton>
      </EmptyState>
    );
  }

  const removeQuestion = async (q: Question) => {
    const ok = await confirm({
      title: 'Frage löschen?',
      message: <p>«{q.question}» wird gelöscht. Diese Aktion wird auf alle synchronisierten Geräte übertragen.</p>,
      confirmLabel: 'Löschen',
      danger: true,
    });
    if (!ok) return;
    await store.deleteQuestions([q.id]);
    toast('Frage gelöscht.', 'success');
  };

  return (
    <div className="page">
      <PageHeader
        back="/decks"
        title={deck.name}
        subtitle={deck.description || plural(questions?.length ?? 0, 'Frage', 'Fragen')}
        actions={
          <>
            <Button variant="primary" icon="play" disabled={!questions?.length} onClick={() => navigate(`/games?deck=${deck.id}`)}>
              Spielen
            </Button>
            <LinkButton to={`/import?deck=${deck.id}`} icon="import">
              Importieren
            </LinkButton>
            <Button
              icon="export"
              onClick={() => void download(`lernarcade-${slugify(deck.name)}.json`, JSON.stringify(createDeckExport(deck, questions ?? []), null, 2))}
            >
              Export
            </Button>
            <Button icon="edit" onClick={() => setEditDeck(true)}>
              Umbenennen
            </Button>
          </>
        }
      />

      <div className="toolbar">
        <label className="search">
          <Icon name="search" size={18} />
          <input type="search" placeholder="Fragen durchsuchen" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Fragen durchsuchen" />
        </label>
        <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>
          Frage hinzufügen
        </Button>
      </div>

      {questions && questions.length === 0 ? (
        <EmptyState icon="import" title="Noch keine Fragen">
          <p className="muted">Füge Fragen einzeln hinzu oder importiere mehrere auf einmal.</p>
          <LinkButton to={`/import?deck=${deck.id}`} variant="primary" icon="import">
            Fragen importieren
          </LinkButton>
        </EmptyState>
      ) : null}

      <ol className="question-list">
        {visible.map((q) => {
          const p = progress?.get(q.id);
          return (
            <li key={q.id} className="card question-item">
              <div className="question-item-head">
                <h3>{q.question}</h3>
                <div className="question-item-tags">
                  {q.category ? <span className="pill">{q.category}</span> : null}
                  <span className="pill">{DIFFICULTY_LABELS[q.difficulty]}</span>
                  {p ? (
                    <span className={p.status === 'repeat' ? 'pill pill-warning' : 'pill pill-ok'}>
                      {p.status === 'repeat' ? 'wiederholen' : 'gelernt'} · {p.correct}/{p.attempts}
                    </span>
                  ) : null}
                  {pendingIds?.has(q.id) ? (
                    <span className="pill pill-pending" title="Lokal gespeichert, noch nicht synchronisiert">
                      lokal
                    </span>
                  ) : null}
                </div>
              </div>
              <ul className="answer-list">
                {q.answers.map((a, i) => (
                  <li key={i} className={i === q.correctIndex ? 'correct' : undefined}>
                    <span className="letter">{ANSWER_LETTERS[i]}</span>
                    <span>{a}</span>
                    {i === q.correctIndex ? <Icon name="check" size={16} title="richtig" /> : null}
                  </li>
                ))}
              </ul>
              {q.acceptedAnswers?.length ? <p className="muted small">Tippmodus akzeptiert auch: {q.acceptedAnswers.join(' · ')}</p> : null}
              {q.explanation ? <p className="explanation">{q.explanation}</p> : null}
              <div className="row end">
                <Button size="sm" icon="edit" onClick={() => setEditing(q)}>
                  Bearbeiten
                </Button>
                <Button size="sm" variant="ghost" icon="trash" onClick={() => void removeQuestion(q)} ariaLabel="Frage löschen">
                  Löschen
                </Button>
              </div>
            </li>
          );
        })}
      </ol>

      {editing ? <QuestionEditor deckId={deck.id} question={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} /> : null}
      {editDeck ? <DeckForm deck={deck} onClose={() => setEditDeck(false)} /> : null}
    </div>
  );
}
