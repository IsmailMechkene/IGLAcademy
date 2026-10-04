import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { QuizDetail, QuizQuestionInput } from '../../types';
import { api } from '../../services/api';
import Modal from '../Modal/Modal';
import styles from './Quiz.module.css';

interface Props {
  courseId: number;
  quiz: QuizDetail | null; // null = create new
  onClose: () => void;
}

interface QuestionDraft {
  key: number;
  question: string;
  options: string[];
  correctIndices: number[];
  explanation: string;
}

let draftKey = 0;
const newDraft = (): QuestionDraft => ({
  key: ++draftKey,
  question: '',
  options: ['', '', '', ''],
  correctIndices: [0],
  explanation: '',
});

export default function QuizEditor({ courseId, quiz, onClose }: Props) {
  const [title, setTitle] = useState(quiz?.title ?? '');
  const [description, setDescription] = useState(quiz?.description ?? '');
  const [questions, setQuestions] = useState<QuestionDraft[]>(
    quiz
      ? quiz.questions.map((q) => ({
          key: ++draftKey,
          question: q.question,
          options: [...q.options],
          correctIndices: [...q.correctIndices],
          explanation: q.explanation,
        }))
      : [newDraft()],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const updateQuestion = (key: number, patch: Partial<QuestionDraft>) => {
    setQuestions((prev) => prev.map((q) => (q.key === key ? { ...q, ...patch } : q)));
  };

  const updateOption = (key: number, index: number, value: string) => {
    setQuestions((prev) =>
      prev.map((q) => {
        if (q.key !== key) return q;
        const options = [...q.options];
        options[index] = value;
        return { ...q, options };
      }),
    );
  };

  const addOption = (key: number) => {
    setQuestions((prev) =>
      prev.map((q) => (q.key === key && q.options.length < 6 ? { ...q, options: [...q.options, ''] } : q)),
    );
  };

  const toggleCorrect = (key: number, index: number) => {
    setQuestions((prev) =>
      prev.map((q) => {
        if (q.key !== key) return q;
        const has = q.correctIndices.includes(index);
        const correctIndices = has
          ? q.correctIndices.filter((i) => i !== index)
          : [...q.correctIndices, index].sort((a, b) => a - b);
        return { ...q, correctIndices };
      }),
    );
  };

  const removeOption = (key: number, index: number) => {
    setQuestions((prev) =>
      prev.map((q) => {
        if (q.key !== key || q.options.length <= 2) return q;
        const options = q.options.filter((_, i) => i !== index);
        const correctIndices = q.correctIndices
          .filter((i) => i !== index)
          .map((i) => (i > index ? i - 1 : i));
        return { ...q, options, correctIndices };
      }),
    );
  };

  const handleSave = async () => {
    setError('');
    if (!title.trim()) {
      setError('Please enter a quiz title.');
      return;
    }
    const validQuestions: QuizQuestionInput[] = [];
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.question.trim()) {
        setError(`Question ${i + 1} is missing its text.`);
        return;
      }
      const options = q.options.map((o) => o.trim());
      if (options.some((o) => !o)) {
        setError(`Question ${i + 1} has empty answer options.`);
        return;
      }
      if (q.correctIndices.length === 0) {
        setError(`Question ${i + 1} needs at least one correct answer.`);
        return;
      }
      validQuestions.push({
        question: q.question.trim(),
        options,
        correctIndex: q.correctIndices[0],
        correctIndices: [...q.correctIndices],
        explanation: q.explanation.trim(),
      });
    }

    setSaving(true);
    try {
      const input = {
        courseId,
        title: title.trim(),
        description: description.trim(),
        questions: validQuestions,
      };
      if (quiz) {
        await api().quizzes.update(quiz.id, input);
      } else {
        await api().quizzes.create(input);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save quiz');
      setSaving(false);
    }
  };

  return (
    <Modal label={quiz ? 'Edit quiz' : 'Create a quiz'} onClose={onClose} wide>
      <h2>{quiz ? 'Edit quiz' : 'Create a quiz'}</h2>
      <div className={styles.editorScroll}>
          <div className={styles.field}>
            <label>Quiz title</label>
            <input
              className="input"
              value={title}
              placeholder="e.g. Module 1 Checkpoint"
              onChange={(e) => setTitle(e.target.value)}
              data-autofocus
            />
          </div>
          <div className={styles.field}>
            <label>Description (optional)</label>
            <input
              className="input"
              value={description}
              placeholder="What does this quiz cover?"
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className={styles.questionsList}>
            {questions.map((q, qi) => (
              <div key={q.key} className={`card ${styles.questionCard}`}>
                <div className={styles.questionHeader}>
                  <span className={styles.questionNumber}>Question {qi + 1}</span>
                  {questions.length > 1 && (
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => setQuestions((prev) => prev.filter((x) => x.key !== q.key))}
                    >
                      <Trash2 size={13} /> Remove
                    </button>
                  )}
                </div>
                <div className={styles.field}>
                  <label>Question</label>
                  <input
                    className="input"
                    value={q.question}
                    placeholder="What is the question?"
                    onChange={(e) => updateQuestion(q.key, { question: e.target.value })}
                  />
                </div>
                <div className={styles.field}>
                  <label>Answer options — check all correct answers</label>
                  <div className={styles.optionsList}>
                    {q.options.map((opt, oi) => (
                      <div key={oi} className={styles.optionRow}>
                        <input
                          type="checkbox"
                          className={styles.radio}
                          checked={q.correctIndices.includes(oi)}
                          onChange={() => toggleCorrect(q.key, oi)}
                          title="Mark as correct answer"
                          aria-label={`Option ${oi + 1} is correct`}
                        />
                        <input
                          className="input"
                          value={opt}
                          placeholder={`Option ${oi + 1}`}
                          onChange={(e) => updateOption(q.key, oi, e.target.value)}
                        />
                        {q.options.length > 2 && (
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => removeOption(q.key, oi)}
                            title="Remove option"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  {q.options.length < 6 && (
                    <button className="btn btn-ghost btn-sm" onClick={() => addOption(q.key)}>
                      <Plus size={13} /> Add option
                    </button>
                  )}
                </div>
                <div className={styles.field}>
                  <label>Explanation (optional)</label>
                  <input
                    className="input"
                    value={q.explanation}
                    placeholder="Why is the correct answer correct?"
                    onChange={(e) => updateQuestion(q.key, { explanation: e.target.value })}
                  />
                </div>
              </div>
            ))}
          </div>

          <button
            className="btn btn-ghost"
            onClick={() => setQuestions((prev) => [...prev, newDraft()])}
          >
            <Plus size={15} /> Add question
          </button>
        </div>

        {error && (
          <div style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</div>
        )}

        <div className={styles.dialogActions}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : quiz ? 'Save changes' : 'Create quiz'}
          </button>
        </div>
    </Modal>
  );
}
