import { describe, expect, it } from 'vitest';
import { parsePracticeExamHtml, htmlToText, htmlToRichText } from '../electron/services/practiceExamParser';

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

  it('recovers intact questions from truncated files', () => {
    const full = makeFile({ quiz_title: 'Truncated', questions: [single, multi] });
    // cut mid-way through the second question's stem text, then append garbage
    const cutAt = full.indexOf('Select two valid statements');
    expect(cutAt).toBeGreaterThan(0);
    const truncated = `${full.slice(0, cutAt)}GARBAGE{{{`;
    const parsed = parsePracticeExamHtml(truncated);
    expect(parsed).not.toBeNull();
    expect(parsed!.title).toBe('Truncated');
    expect(parsed!.questions).toHaveLength(1);
    expect(parsed!.skipped).toBeGreaterThanOrEqual(1);
  });

  it('captures the per-question topic from the section field', () => {
    const parsed = parsePracticeExamHtml(
      makeFile({
        quiz_title: 'T',
        questions: [
          { ...single, section: 'Security' },
          { ...multi, section: '' },
        ],
      }),
    );
    expect(parsed!.questions[0].topic).toBe('Security');
    expect(parsed!.questions[1].topic).toBe('');
  });

  it('skips a garbled question but keeps the rest', () => {
    const good = makeFile({ quiz_title: 'T', questions: [single, multi] });
    // corrupt the first question object beyond repair
    const broken = good.replace('"assessment_type":"multiple-choice"', '"assessment_type":');
    const parsed = parsePracticeExamHtml(broken);
    expect(parsed).not.toBeNull();
    expect(parsed!.questions).toHaveLength(1);
    expect(parsed!.skipped).toBe(1);
  });

  it('builds the explanation from per-answer feedbacks (lecture quizzes)', () => {
    const lectureQuiz = {
      assessment_type: 'multiple-choice',
      prompt: {
        question: '<p>Which tool shows when permissions were last used?</p>',
        answers: ['<p>Credential checker</p>', '<p>Access viewer</p>', '', '<p>Policy log</p>'],
        // One per answer, including the empty one that gets dropped.
        feedbacks: ['Lists credentials, not usage.', 'It shows <strong>last access</strong>.', 'ignored', ''],
      },
      correct_response: ['b'],
    };
    const parsed = parsePracticeExamHtml(makeFile({ quiz_title: 'Lecture Quiz', questions: [lectureQuiz] }));
    expect(parsed!.questions[0].options).toEqual(['Credential checker', 'Access viewer', 'Policy log']);
    expect(parsed!.questions[0].explanation).toBe(
      [
        'Correct answer:',
        '**Access viewer**',
        'It shows **last access**.',
        'Incorrect options:',
        '**Credential checker**',
        'Lists credentials, not usage.',
      ].join('\n'),
    );
  });

  it('prefers a real explanation over feedbacks', () => {
    const both = { ...single, prompt: { ...single.prompt, feedbacks: ['a', 'b', 'c'] } };
    const parsed = parsePracticeExamHtml(makeFile({ quiz_title: 'T', questions: [both] }));
    expect(parsed!.questions[0].explanation).toBe('**Secrets Manager** - rotates credentials.');
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

describe('htmlToRichText', () => {
  it('keeps option names, code, links and diagrams as inert markers', () => {
    const html =
      '<p>Correct option:</p><p><strong>Use DAX</strong> - caches <code>GetItem</code> reads.</p>' +
      '<p>Overview:<img src="https://example.com/d.png">via - <a href="https://aws.amazon.com/dax/">https://aws.amazon.com/dax/</a></p>';
    expect(htmlToRichText(html)).toBe(
      'Correct option:\n**Use DAX** - caches `GetItem` reads.\nOverview:\n![diagram](https://example.com/d.png)\nvia - [https://aws.amazon.com/dax/](https://aws.amazon.com/dax/)',
    );
  });

  it('drops unsafe links and images, never passing HTML through', () => {
    const out = htmlToRichText('<p><a href="javascript:alert(1)">click</a><img src="file:///c:/x.png"><script>x</script></p>');
    expect(out).toBe('clickx');
    expect(out).not.toMatch(/[<>]/);
  });

  it('turns list items into bullet lines', () => {
    expect(htmlToRichText('<ul><li>One</li><li>Two</li></ul>')).toBe('• One\n• Two');
  });
});
