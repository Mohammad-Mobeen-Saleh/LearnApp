import { useMemo, useState } from 'react';
import { useServices } from '../app/ServicesContext.tsx';
import { splitAcceptedAnswers, validateDraft } from '../import/validate.ts';
import { ANSWER_LETTERS, DIFFICULTY_LABELS, LIMITS, type AnswerIndex, type Difficulty, type DraftQuestion, type Question } from '../domain/types.ts';
import { Button, Modal, useFeedback } from '../ui/components.tsx';

/** Formular zum Anlegen und Korrigieren einer Frage. */
export function QuestionEditor({ deckId, question, onClose }: { deckId: string; question?: Question; onClose: () => void }) {
  const { store } = useServices();
  const { toast } = useFeedback();
  const [draft, setDraft] = useState<DraftQuestion>(() =>
    question
      ? {
          question: question.question,
          answers: [...question.answers] as DraftQuestion['answers'],
          correctIndex: question.correctIndex,
          explanation: question.explanation,
          difficulty: question.difficulty,
          category: question.category,
          acceptedAnswers: question.acceptedAnswers ?? [],
        }
      : { question: '', answers: ['', '', ''], correctIndex: 0, explanation: '', difficulty: 2, category: '', acceptedAnswers: [] },
  );
  // Freitext «Geld; Zaster» – wird beim Speichern in einzelne Lösungen zerlegt
  const [acceptedText, setAcceptedText] = useState(() => (question?.acceptedAnswers ?? []).join('; '));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const full = useMemo(() => ({ ...draft, acceptedAnswers: splitAcceptedAnswers(acceptedText) }), [draft, acceptedText]);
  const validation = useMemo(() => validateDraft(full), [full]);

  const setAnswer = (i: number, value: string) => {
    const answers = [...draft.answers] as DraftQuestion['answers'];
    answers[i] = value;
    setDraft({ ...draft, answers });
  };

  const save = async () => {
    setTouched(true);
    if (validation.errors.length) return;
    setBusy(true);
    try {
      if (question) await store.updateQuestion(question.id, full);
      else await store.addQuestions(deckId, [full]);
      toast(question ? 'Frage gespeichert.' : 'Frage hinzugefügt.', 'success');
      onClose();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      wide
      title={question ? 'Frage bearbeiten' : 'Neue Frage'}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy}>
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
          <span>Frage</span>
          <textarea data-autofocus rows={3} maxLength={LIMITS.question} value={draft.question} onChange={(e) => setDraft({ ...draft, question: e.target.value })} />
        </label>
        <fieldset className="answers-editor">
          <legend>Antworten – richtige Antwort auswählen</legend>
          {draft.answers.map((a, i) => (
            <div key={i} className={draft.correctIndex === i ? 'answer-row correct' : 'answer-row'}>
              <label className="answer-radio" title="Richtige Antwort">
                <input
                  type="radio"
                  name="correct"
                  checked={draft.correctIndex === i}
                  onChange={() => setDraft({ ...draft, correctIndex: i as AnswerIndex })}
                  aria-label={`Antwort ${ANSWER_LETTERS[i]} ist richtig`}
                />
                <span>{ANSWER_LETTERS[i]}</span>
              </label>
              <input value={a} maxLength={LIMITS.answer} onChange={(e) => setAnswer(i, e.target.value)} aria-label={`Antwort ${ANSWER_LETTERS[i]}`} placeholder={`Antwort ${ANSWER_LETTERS[i]}`} />
            </div>
          ))}
        </fieldset>
        <label className="field">
          <span>Weitere akzeptierte Antworten für den Tippmodus (optional, mit ; trennen)</span>
          <input value={acceptedText} onChange={(e) => setAcceptedText(e.target.value)} placeholder="z. B. Zaster; Moneten" />
        </label>
        <label className="field">
          <span>Erklärung (optional)</span>
          <textarea rows={2} maxLength={LIMITS.explanation} value={draft.explanation} onChange={(e) => setDraft({ ...draft, explanation: e.target.value })} />
        </label>
        <div className="grid-2 tight">
          <label className="field">
            <span>Schwierigkeit</span>
            <select value={draft.difficulty} onChange={(e) => setDraft({ ...draft, difficulty: Number(e.target.value) as Difficulty })}>
              {([1, 2, 3] as Difficulty[]).map((d) => (
                <option key={d} value={d}>
                  {DIFFICULTY_LABELS[d]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Kategorie (optional)</span>
            <input value={draft.category} maxLength={LIMITS.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} />
          </label>
        </div>
        {touched && validation.errors.length ? (
          <ul className="error-list">
            {validation.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        ) : null}
        {validation.warnings.length ? (
          <ul className="warning-list">
            {validation.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : null}
      </form>
    </Modal>
  );
}
