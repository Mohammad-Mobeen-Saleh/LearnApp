import { useState } from 'react';
import { useLiveQuery, useServices } from '../app/ServicesContext.tsx';
import { ANSWER_LETTERS, DIFFICULTY_LABELS, SPEED_LABELS, type ConflictRecord, type ConflictResolution, type Difficulty, type SpeedSetting } from '../domain/types.ts';
import { formatDateTime } from '../lib/text.ts';
import { Button, EmptyState, PageHeader, useFeedback } from '../ui/components.tsx';

/**
 * Konfliktzentrale: Beide Versionen sind gesichert (auch in der Cloud).
 * Der Benutzer entscheidet, welche gilt – oder behält beide.
 */

const REASON_TEXT: Record<ConflictRecord['reason'], string> = {
  edit_edit: 'Auf zwei Geräten gleichzeitig geändert',
  remote_deleted: 'Auf einem anderen Gerät gelöscht, hier aber geändert',
  local_deleted: 'Hier gelöscht, auf einem anderen Gerät aber inzwischen geändert. Die Löschung wurde nicht ausgeführt',
  deck_deleted: 'Das Lernpaket wurde auf einem anderen Gerät gelöscht, hier aber ergänzt',
  deck_changed: 'Die Löschung wurde nicht ausgeführt, weil ein anderes Gerät inzwischen Fragen in diesem Lernpaket geändert hat',
};

const COLLECTION_TEXT: Record<ConflictRecord['collection'], string> = {
  decks: 'Lernpaket',
  questions: 'Frage',
  user_settings: 'Einstellungen',
};

function Version({ collection, data, title }: { collection: ConflictRecord['collection']; data: Record<string, unknown> | null; title: string }) {
  if (!data) {
    return (
      <div className="version card">
        <h4>{title}</h4>
        <p className="muted">nicht vorhanden</p>
      </div>
    );
  }
  if (data.deleted === true) {
    return (
      <div className="version card version-deleted">
        <h4>{title}</h4>
        <p>
          <strong>gelöscht</strong>
        </p>
        {collection === 'questions' && typeof data.question === 'string' ? <p className="muted">{data.question}</p> : null}
        {collection === 'decks' && typeof data.name === 'string' ? <p className="muted">{data.name}</p> : null}
      </div>
    );
  }
  if (collection === 'questions') {
    const answers = Array.isArray(data.answers) ? (data.answers as string[]) : [];
    return (
      <div className="version card">
        <h4>{title}</h4>
        <p>
          <strong>{String(data.question ?? '')}</strong>
        </p>
        <ul className="answer-list compact">
          {answers.map((a, i) => (
            <li key={i} className={i === data.correctIndex ? 'correct' : undefined}>
              <span className="letter">{ANSWER_LETTERS[i]}</span>
              <span>{a}</span>
            </li>
          ))}
        </ul>
        {data.explanation ? <p className="explanation">{String(data.explanation)}</p> : null}
        <p className="muted small">
          {DIFFICULTY_LABELS[(data.difficulty as Difficulty) ?? 2]}
          {data.category ? ` · ${String(data.category)}` : ''}
        </p>
      </div>
    );
  }
  if (collection === 'decks') {
    return (
      <div className="version card">
        <h4>{title}</h4>
        <p>
          <strong>{String(data.name ?? '')}</strong>
        </p>
        <p className="muted">{String(data.description ?? '') || 'ohne Beschreibung'}</p>
      </div>
    );
  }
  return (
    <div className="version card">
      <h4>{title}</h4>
      <ul className="plain-list">
        <li>Name: {String(data.playerName ?? '') || 'kein Name'}</li>
        <li>Sound: {data.soundEnabled ? 'an' : 'aus'}</li>
        <li>Tempo: {SPEED_LABELS[(data.speed as SpeedSetting) ?? 'normal']}</li>
        <li>Fragen pro Spiel: {Number(data.questionsPerGame) || 'alle'}</li>
      </ul>
    </div>
  );
}

function actionsFor(c: ConflictRecord): { resolution: ConflictResolution; label: string; primary?: boolean }[] {
  switch (c.reason) {
    case 'edit_edit':
      return [
        { resolution: 'use_local', label: `Version von «${c.deviceLabel || 'diesem Gerät'}» verwenden` },
        { resolution: 'keep_remote', label: 'Aktuelle Version behalten', primary: c.collection !== 'questions' },
        ...(c.collection === 'questions' ? [{ resolution: 'keep_both' as const, label: 'Beide behalten', primary: true }] : []),
      ];
    case 'remote_deleted':
    case 'deck_deleted':
      return [
        { resolution: 'restore', label: 'Wiederherstellen', primary: true },
        { resolution: 'keep_remote', label: 'Löschung akzeptieren' },
      ];
    case 'local_deleted':
    case 'deck_changed':
      return [
        { resolution: 'keep_remote', label: 'Behalten', primary: true },
        { resolution: 'delete_anyway', label: 'Trotzdem löschen' },
      ];
  }
}

export function ConflictsPage() {
  const { store } = useServices();
  const { toast } = useFeedback();
  const conflicts = useLiveQuery((s) => s.listConflicts(), []);
  const deckNames = useLiveQuery(async (s) => new Map((await s.listDecks({ includeDeleted: true })).map((d) => [d.id, d.name])), []);
  const [busy, setBusy] = useState<string | null>(null);

  const resolve = async (c: ConflictRecord, resolution: ConflictResolution) => {
    setBusy(c.id);
    try {
      await store.resolveConflict(c.id, resolution);
      toast('Konflikt gelöst.', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page">
      <PageHeader
        back="/settings"
        title="Synchronisierungskonflikte"
        subtitle="Beide Versionen sind sicher gespeichert. Entscheide, welche gelten soll."
      />
      {conflicts && conflicts.length === 0 ? (
        <EmptyState icon="check" title="Keine offenen Konflikte">
          <p className="muted">Alle Geräte sind auf demselben Stand.</p>
        </EmptyState>
      ) : null}
      <div className="conflict-list">
        {(conflicts ?? []).map((c) => {
          const deckId = c.collection === 'decks' ? c.recordId : (c.localData?.deckId as string | undefined);
          return (
            <article key={c.id} className="card conflict">
              <header>
                <span className="pill pill-warning">{COLLECTION_TEXT[c.collection]}</span>
                {deckId && deckNames?.get(deckId) ? <span className="muted small">Lernpaket «{deckNames.get(deckId)}»</span> : null}
                <span className="muted small">erkannt {formatDateTime(c.createdAt)} auf {c.deviceLabel || 'einem Gerät'}</span>
              </header>
              <p>
                <strong>{REASON_TEXT[c.reason]}.</strong>
              </p>
              <div className="versions">
                <Version collection={c.collection} data={c.localData} title={`Version von «${c.deviceLabel || 'diesem Gerät'}»`} />
                <Version collection={c.collection} data={c.remoteData} title="Aktuelle Version (Cloud)" />
              </div>
              <div className="row end">
                {actionsFor(c).map((a) => (
                  <Button key={a.resolution} variant={a.primary ? 'primary' : 'secondary'} disabled={busy === c.id} onClick={() => void resolve(c, a.resolution)}>
                    {a.label}
                  </Button>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
