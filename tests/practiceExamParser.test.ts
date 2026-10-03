import { describe, expect, it } from 'vitest';
import { parsePracticeExamHtml, htmlToText } from '../electron/services/practiceExamParser';

function makeFile(payload: object, prefix = '<!doctype html><html><body>'): string {
  return `${prefix}<script>const quizData = ${JSON.stringify(payload)};</script></body></html>`;
}

const single = {
  assessment_type: 'multiple-choice',
  prompt: {
    question: '<p>Which service stores secrets?</p>',
    answers: ['<p>Secrets Manager</p>', '<p>EC2</p>', '<p>S3</p>'],
    explanation: '<p><strong>Secrets Manager</strong> - rotates credentials.</p>',
  },
  correct_response: ['a'],
};

const multi = {
  assessment_type: 'multi-select',
  prompt: {
    question: '<p>Select two valid statements. (Select two)</p>',
    answers: ['<p>First</p>', '<p>Second</p>', '<p>Third</p>', '<p>Fourth</p>'],
    explanation: '',
  },
  correct_response: ['b', 'e'],
};

describe('parsePracticeExamHtml', () => {
  it('extracts single-choice and multi-select questions', () => {
    const parsed = parsePracticeExamHtml(
      makeFile({ quiz_title: 'Practice Test #1', questions: [single, multi] }),
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.title).toBe('Practice Test #1');
    expect(parsed!.skipped).toBe(0);
    expect(parsed!.questions).toHaveLength(2);

    expect(parsed!.questions[0].question).toBe('Which service stores secrets?');
    expect(parsed!.questions[0].options).toEqual(['Secrets Manager', 'EC2', 'S3']);
    expect(parsed!.questions[0].correctIndices).toEqual([0]);
    expect(parsed!.questions[0].explanation).toContain('Secrets Manager');

    // 'e' is out of range for 4 options -> dropped, 'b' kept
    expect(parsed!.questions[1].correctIndices).toEqual([1]);
  });

  it('maps all valid letters for multi-select', () => {
    const parsed = parsePracticeExamHtml(
      makeFile({
        quiz_title: 'T',
        questions: [{ ...multi, correct_response: ['a', 'c'] }],
      }),
    );
    expect(parsed!.questions[0].correctIndices).toEqual([0, 2]);
  });

  it('falls back to question_plain when prompt.question is missing', () => {
    const q = {
      ...single,
      prompt: { answers: single.prompt.answers, explanation: '' },
      question_plain: 'Plain stem here',
    };
    const parsed = parsePracticeExamHtml(makeFile({ quiz_title: 'T', questions: [q] }));
    expect(parsed!.questions[0].question).toBe('Plain stem here');
  });

  it('skips unknown types and malformed questions, counting them', () => {
    const parsed = parsePracticeExamHtml(
      makeFile({
        quiz_title: 'T',
        questions: [
          single,
          { assessment_type: 'fill-in-the-blank' },
          { assessment_type: 'multiple-choice' }, // no prompt
          { ...single, correct_response: ['z'] }, // invalid letter
          { ...single, correct_response: ['a', 'b'] }, // multi answers on single-choice
        ],
      }),
    );
    expect(parsed!.questions).toHaveLength(1);
    expect(parsed!.skipped).toBe(4);
  });

  it('returns null for files without quiz data', () => {
    expect(parsePracticeExamHtml('<html><body>hello</body></html>')).toBeNull();
    expect(parsePracticeExamHtml('')).toBeNull();
    expect(parsePracticeExamHtml('<script>const quizData = {oops;</script>')).toBeNull();
  });

  it('tolerates raw control characters inside strings (as in real dumps)', () => {
    const payload = { quiz_title: 'T', questions: [{ ...single }] };
    const raw = makeFile(payload).replace('Secrets Manager', 'Secrets\tManager');
    const parsed = parsePracticeExamHtml(raw);
    expect(parsed!.questions[0].options[0]).toBe('Secrets Manager');
  });
});

describe('htmlToText', () => {
  it('strips tags and decodes entities', () => {
    expect(htmlToText('<p>Use <code>MessageRetentionPeriod</code> &amp; friends</p>')).toBe(
      'Use MessageRetentionPeriod & friends',
    );
    expect(htmlToText('<p>Line one</p><p>Line two</p>')).toBe('Line one\nLine two');
  });
});
