import { useState } from 'react';
import { useLiveQuery } from '../app/ServicesContext.tsx';
import { computeStats, sessionGameType } from '../domain/stats.ts';
import { formatDateTime, formatNumber, formatPercent, plural } from '../lib/text.ts';
import { EmptyState, LinkButton, PageHeader, Stat } from '../ui/components.tsx';
import { ANSWER_LETTERS, GAME_TYPE_LABELS, type GameType } from '../domain/types.ts';

type Filter = 'all' | GameType;
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Alle Modi' },
  { value: 'defense', label: GAME_TYPE_LABELS.defense },
  { value: 'typing', label: GAME_TYPE_LABELS.typing },
];

export function StatsPage() {
  const [filter, setFilter] = useState<Filter>('all');
  const data = useLiveQuery(
    async (s) => {
      const [decks, questions, sessions, answers] = await Promise.all([s.listDecks(), s.listAllQuestions(), s.listSessions(), s.listAnswers()]);
      const stats = computeStats({ decks, questions, sessions, answers }, filter === 'all' ? {} : { gameType: filter });
      return { stats, questions, decks };
    },
    [filter],
  );
  if (!data) return <div className="loading">Lade Statistik …</div>;
  const { stats, questions, decks } = data;
  const deckName = (id: string | null) => decks.find((d) => d.id === id)?.name ?? (id ? 'Gelöschtes Paket' : 'Wiederholung');
  const repeatQuestions = questions.filter((q) => stats.repeatQuestionIds.includes(q.id));

  return (
    <div className="page">
      <PageHeader title="Statistik" subtitle="Lernfortschritt aller Geräte, die mit deinem Konto synchronisiert sind." />

      <div className="segmented stats-filter" role="tablist" aria-label="Spielmodus">
        {FILTERS.map((f) => (
          <button key={f.value} type="button" role="tab" aria-selected={filter === f.value} className={filter === f.value ? 'active' : undefined} onClick={() => setFilter(f.value)}>
            {f.label}
          </button>
        ))}
      </div>
      {filter === 'typing' ? (
        <p className="muted small">
          Tippmodus: Eine Frage zählt als richtig, wenn sie beim ersten Versuch richtig eingetippt wurde. Fehlversuche und Einschläge markieren sie zum
          Wiederholen.
        </p>
      ) : null}

      <section className="stats-grid">
        <Stat icon="trophy" label="Highscore" value={formatNumber(stats.highscore)} hint={`beste Serie: ${stats.bestStreak}`} />
        <Stat icon="check" label="Erfolgsquote" value={formatPercent(stats.successRate)} hint={`${stats.rounds} Antworten`} />
        <Stat icon="check" label="Richtig" value={formatNumber(stats.correct)} />
        <Stat icon="alert" label="Falsch" value={formatNumber(stats.wrong)} hint={stats.timeouts ? `davon ${stats.timeouts} Zeit abgelaufen` : undefined} />
        <Stat icon="play" label="Spielrunden" value={formatNumber(stats.games)} hint={stats.lastPlayedAt ? `zuletzt ${formatDateTime(stats.lastPlayedAt)}` : 'noch nicht gespielt'} />
        <Stat icon="repeat" label="Zu wiederholen" value={stats.repeatQuestionIds.length} />
      </section>

      <section className="card">
        <h2>Lernfortschritt pro Fach</h2>
        {stats.decks.length === 0 ? <p className="muted">Noch keine Lernpakete.</p> : null}
        <div className="progress-table">
          {stats.decks.map((d) => (
            <div key={d.deckId} className="progress-row">
              <div className="progress-row-head">
                <a href={`#/decks/${d.deckId}`}>
                  <strong>{d.name}</strong>
                </a>
                <span className="muted small">
                  {d.mastered}/{d.total} gelernt · {d.toRepeat} wiederholen · {d.unseen} neu · Quote {formatPercent(d.successRate)} · Highscore {formatNumber(d.highscore)}
                </span>
              </div>
              <div className="stacked-bar" aria-label={`${d.name}: ${d.mastered} gelernt, ${d.toRepeat} zu wiederholen, ${d.unseen} neu`}>
                <span className="seg seg-ok" style={{ flexGrow: d.mastered }} />
                <span className="seg seg-warning" style={{ flexGrow: d.toRepeat }} />
                <span className="seg seg-muted" style={{ flexGrow: d.unseen || (d.total === 0 ? 1 : 0) }} />
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid-2">
        <section className="card">
          <div className="card-title">
            <h2>Fragen zum Wiederholen</h2>
            {repeatQuestions.length ? (
              <LinkButton to="/play?mode=repeat" variant="primary" size="sm" icon="repeat">
                Wiederholen
              </LinkButton>
            ) : null}
          </div>
          {repeatQuestions.length === 0 ? (
            <p className="muted">Keine. Alle zuletzt beantworteten Fragen waren richtig.</p>
          ) : (
            <ul className="repeat-list">
              {repeatQuestions.slice(0, 30).map((q) => (
                <li key={q.id}>
                  <strong>{q.question}</strong>
                  <span className="muted small">
                    Richtig: {ANSWER_LETTERS[q.correctIndex]}) {q.answers[q.correctIndex]} · {deckName(q.deckId)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h2>Letzte Spiele</h2>
          {stats.recentSessions.length === 0 ? (
            <EmptyState icon="play" title="Noch keine Spiele">
              <LinkButton to="/play" variant="primary" icon="play">
                Erstes Spiel starten
              </LinkButton>
            </EmptyState>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Paket</th>
                  {filter === 'all' ? <th>Modus</th> : null}
                  <th className="num">Punkte</th>
                  <th className="num">Richtig</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentSessions.map((s) => (
                  <tr key={s.id}>
                    <td>{formatDateTime(s.endedAt)}</td>
                    <td>{deckName(s.deckId)}</td>
                    {filter === 'all' ? <td>{sessionGameType(s) === 'typing' ? 'Tippen' : 'Abwehr'}</td> : null}
                    <td className="num">{formatNumber(s.score)}</td>
                    <td className="num">
                      {s.correctCount}/{s.rounds}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted small">{plural(stats.games, 'Spiel', 'Spiele')} insgesamt.</p>
        </section>
      </div>
    </div>
  );
}
