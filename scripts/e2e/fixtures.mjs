// Builds everything the end-to-end tests need inside a temp folder: a small
// course (videos made from the bundled synthetic clip, a subtitle sidecar, a
// Markdown resource, an HTML practice lesson) and a practice-exam folder in
// the same format as downloaded Udemy tests. No network, no personal files.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** 4-second 320x180 test pattern + tone, generated (no third-party content). */
const SAMPLE_VIDEO = path.join(__dirname, 'fixtures', 'sample.mp4');

const explanation = (correct, incorrect, extra = '') =>
  `<p>Correct option:</p><p><strong>${correct}</strong></p>` +
  `<p>This is the right choice because it matches the requirement. Use <code>DelaySeconds</code> when needed.</p>` +
  '<p>Incorrect options:</p>' +
  incorrect.map((o) => `<p><strong>${o}</strong> - This does not meet the requirement.</p>`).join('') +
  extra +
  '<p>References:</p><p><a href="https://docs.aws.amazon.com/example">https://docs.aws.amazon.com/example</a></p>';

/** Five questions, one multi-select, Udemy-style explanations. */
export const EXAM_QUESTIONS = [
  { q: 'Which service stores objects?', answers: ['Amazon S3', 'Amazon EC2', 'AWS Lambda', 'Amazon VPC'], correct: ['a'] },
  { q: 'Which service runs containers without servers?', answers: ['Amazon EC2', 'AWS Fargate', 'Amazon S3', 'Amazon RDS'], correct: ['b'] },
  { q: 'Select TWO managed databases.', answers: ['Amazon RDS', 'Amazon S3', 'Amazon DynamoDB', 'AWS IAM'], correct: ['a', 'c'] },
  { q: 'Which service provides a CDN?', answers: ['Amazon Route 53', 'Amazon CloudFront', 'AWS Shield', 'Amazon SQS'], correct: ['b'] },
  { q: 'Which service manages identities?', answers: ['AWS IAM', 'Amazon SNS', 'AWS Glue', 'Amazon EMR'], correct: ['a'] },
];

/** `feedbacks`: lecture-quiz style, one note per answer instead of an explanation. */
function examHtml(title, { feedbacks = false } = {}) {
  return `<!doctype html><html><head><title>${title}</title></head><body><script>const quizData = ${JSON.stringify({
    quiz_title: title,
    questions: EXAM_QUESTIONS.map((x) => {
      const letters = ['a', 'b', 'c', 'd'];
      const correctNames = x.correct.map((c) => x.answers[letters.indexOf(c)]);
      const incorrectNames = x.answers.filter((a) => !correctNames.includes(a));
      return {
        assessment_type: x.correct.length > 1 ? 'multi-select' : 'multiple-choice',
        prompt: {
          question: `<p>${x.q}</p>`,
          answers: x.answers.map((a) => `<p>${a}</p>`),
          ...(feedbacks
            ? { feedbacks: x.answers.map((a) => (correctNames.includes(a) ? `${a} is right for this.` : `${a} does something else.`)) }
            : { explanation: explanation(correctNames.join(' and '), incorrectNames) }),
        },
        correct_response: x.correct,
        section: 'Core services',
      };
    }),
  })};</script></body></html>`;
}

export function makeWorkspace() {
  if (!fs.existsSync(SAMPLE_VIDEO)) throw new Error(`missing fixture ${SAMPLE_VIDEO}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ismalearn-e2e-'));
  const course = path.join(dir, 'E2E Cloud Course');
  const lessons = {
    '01 - Getting Started': ['01 - Welcome', '02 - How this course works'],
    '02 - Storage': ['01 - Buckets', '02 - Versioning', '03 - Lifecycle rules'],
  };
  for (const [section, names] of Object.entries(lessons)) {
    fs.mkdirSync(path.join(course, section), { recursive: true });
    for (const name of names) fs.copyFileSync(SAMPLE_VIDEO, path.join(course, section, `${name}.mp4`));
  }
  fs.writeFileSync(
    path.join(course, '01 - Getting Started', '01 - Welcome.srt'),
    '1\n00:00:00,000 --> 00:00:02,000\nHello from SRT\n\n2\n00:00:02,000 --> 00:00:04,000\nSecond cue\n',
  );
  fs.writeFileSync(path.join(course, '02 - Storage', 'Storage cheat sheet.md'), '# Storage\n\n- S3\n- EBS\n');
  fs.writeFileSync(path.join(course, '02 - Storage', '04 - Practice Test #1.html'), examHtml('Storage quiz', { feedbacks: true }));

  const exams = path.join(dir, 'Practice Exams AWS Certified Cloud Practitioner CLF-C02');
  fs.mkdirSync(exams, { recursive: true });
  const examFile = path.join(exams, '1.1 Practice Test #1 - AWS Certified Cloud Practitioner.html');
  fs.writeFileSync(examFile, examHtml('Practice Test #1 - AWS Certified Cloud Practitioner'));
  fs.writeFileSync(
    path.join(exams, '2.2 Practice Test #2 - AWS Certified Cloud Practitioner.html'),
    examHtml('Practice Test #2 - AWS Certified Cloud Practitioner'),
  );

  return {
    dir,
    course,
    examsDir: exams,
    examFile,
    profile: path.join(dir, 'profile'),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}
