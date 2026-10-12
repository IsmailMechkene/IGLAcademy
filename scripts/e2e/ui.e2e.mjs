// User flows through the real UI: navigation, search shortcut, sidebar,
// dialogs, the player's right-hand course panel, practice-mode explanations,
// and an exam that survives the app being closed and reopened.
import { assert, launch, runChecks } from './harness.mjs';
import { makeWorkspace } from './fixtures.mjs';

/** Clicks a sidebar entry and waits for its page heading. */
async function nav(page, label, heading = label) {
  await page.run(async ({ label, heading }) => {
    await click('aside button', label, `sidebar "${label}"`);
    await waitFor(() => {
      const h1 = document.querySelector('main h1');
      return h1 && h1.textContent.includes(heading);
    }, `heading "${heading}"`);
  }, { label, heading });
}

/** From anywhere: Practice Exams → Cloud Practitioner → test #1 → mode picker. */
async function openExam(page) {
  await nav(page, 'Practice Exams');
  await page.run(async () => {
    await click('main button', 'Cloud Practitioner', 'certification card');
    const row = await waitFor(
      () => Array.from(document.querySelectorAll('main [class*="examRow"]')).find((r) => r.textContent.includes('Practice Test #1')),
      'test row',
    );
    const start = Array.from(row.querySelectorAll('button')).find((b) => /Start|Retake/.test(b.textContent));
    start.click();
    await waitFor(() => mainText().includes('Practice mode') && mainText().includes('Exam mode'), 'mode picker');
  });
}

export async function run() {
  const ws = makeWorkspace();
  let app = await launch(ws.profile);
  let timerBefore = '';

  try {
    await app.page.run(async ({ course, exams }) => {
      await api.courses.importPath(course);
      await api.practice.addFolderPath(exams);
      location.reload();
    }, { course: ws.course, exams: ws.examsDir }).catch(() => undefined); // reload ends the evaluation
    await new Promise((r) => setTimeout(r, 1500));

    return await runChecks('ui', [
      ['sidebar navigation updates the page and the breadcrumb', async () => {
        await nav(app.page, 'Courses');
        const r = await app.page.run(async () => {
          // Tabs render once the course list has loaded.
          await waitFor(() => document.querySelectorAll('main [role="tab"]').length > 0, 'course tabs');
          return {
            crumb: document.querySelector('header [aria-current="page"]')?.textContent,
            hasImport: !!byText('main button', 'Import course'),
            tabs: Array.from(document.querySelectorAll('main [role="tab"]')).map((t) => t.textContent),
          };
        });
        assert(r.crumb === 'Courses', `breadcrumb "${r.crumb}"`);
        assert(r.hasImport, 'Import course button missing on Courses');
        assert(r.tabs.length === 3, `tabs ${JSON.stringify(r.tabs)}`);
      }],

      ['Ctrl+K focuses the search box', async () => {
        const label = await app.page.run(async () => {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
          await sleep(100);
          return document.activeElement?.getAttribute('aria-label');
        });
        assert(label === 'Search courses', `focused: ${label}`);
      }],

      ['the sidebar collapses to a rail and expands again', async () => {
        const widths = await app.page.run(async () => {
          const aside = document.querySelector('aside');
          await click('aside button[aria-label="Collapse sidebar"]');
          await sleep(400);
          const collapsed = aside.getBoundingClientRect().width;
          await click('aside button[aria-label="Expand sidebar"]');
          await sleep(400);
          return [collapsed, aside.getBoundingClientRect().width];
        });
        assert(widths[0] < 100 && widths[1] > 200, `widths ${JSON.stringify(widths)}`);
      }],

      ['course dialogs cover the whole window', async () => {
        const r = await app.page.run(async () => {
          await click('[aria-label^="Actions for"]');
          await click('[role="menuitem"]', 'Rename', 'Rename menu item');
          const dialog = await waitFor(() => document.querySelector('[role="dialog"]'), 'rename dialog');
          await sleep(300);
          const o = dialog.parentElement.getBoundingClientRect();
          const d = dialog.getBoundingClientRect();
          const out = {
            overlay: [o.left, o.top, o.width, o.height],
            centred: Math.abs(d.left + d.width / 2 - innerWidth / 2) < 2,
            viewport: [innerWidth, innerHeight],
          };
          await click('[role="dialog"] button', 'Cancel');
          return out;
        });
        assert(
          r.overlay[0] === 0 && r.overlay[1] === 0 && r.overlay[2] === r.viewport[0] && r.overlay[3] === r.viewport[1],
          `overlay ${JSON.stringify(r.overlay)} vs viewport ${JSON.stringify(r.viewport)}`,
        );
        assert(r.centred, 'dialog is not centred');
      }],

      ['the player lists course content on the right and switches lessons from it', async () => {
        const r = await app.page.run(async () => {
          await click('[aria-label^="Open course:"]');
          await click('main button', 'How this course works', 'lesson row');
          const panel = await waitFor(() => document.querySelector('aside[aria-label="Course content and notes"]'), 'side panel');
          const onRight = panel.getBoundingClientRect().left > innerWidth / 2;
          const appSidebarHidden = !document.querySelector('nav[aria-label="Main"]');
          const before = document.querySelector('h1').textContent;
          await click('aside[aria-label="Course content and notes"] button', 'Storage', 'section header');
          await click('aside[aria-label="Course content and notes"] button', 'Versioning', 'lesson in panel');
          await waitFor(() => document.querySelector('h1').textContent === 'Versioning', 'lesson switch');
          await click('button[aria-label="Hide side panel"]');
          await sleep(200);
          const hidden = !document.querySelector('aside[aria-label="Course content and notes"]');
          await click('button[aria-label="Show course content"]');
          await click('button[aria-label="Back to course"]');
          await waitFor(() => document.querySelector('nav[aria-label="Main"]'), 'app chrome back');
          return { onRight, appSidebarHidden, before, hidden };
        });
        assert(r.onRight, 'course panel is not on the right');
        assert(r.appSidebarHidden, 'app sidebar visible in focus mode');
        assert(r.before === 'How this course works', `first lesson "${r.before}"`);
        assert(r.hidden, 'panel did not hide');
      }],

      ['practice mode shows a verdict and a structured explanation', async () => {
        await openExam(app.page);
        const r = await app.page.run(async () => {
          await click('main button', 'Practice mode');
          await click('main button[aria-pressed]', 'Amazon S3', 'first option');
          const verdict = await waitFor(() => document.querySelector('[role="status"]'), 'verdict');
          const text = mainText();
          const out = {
            verdict: verdict.textContent,
            correctSection: text.includes('WHY THIS ANSWER IS CORRECT') || text.includes('Why this answer is correct'),
            wrongSection: text.includes('WHY THE OTHER OPTIONS ARE WRONG') || text.includes('Why the other options are wrong'),
            code: !!document.querySelector('main code'),
            reference: !!document.querySelector('main a[href^="https://docs.aws.amazon.com"]'),
          };
          await click('main button', 'Exit');
          await waitFor(() => mainText().includes('practice run in progress'), 'resume card for practice');
          await click('main button', 'Discard');
          await waitFor(() => !mainText().includes('in progress'), 'resume card gone');
          return out;
        });
        assert(r.verdict.includes('Correct'), `verdict "${r.verdict}"`);
        assert(r.correctSection && r.wrongSection, 'explanation sections missing');
        assert(r.code && r.reference, 'inline code or reference link missing');
      }],

      ['an exam in progress is offered for resuming', async () => {
        const r = await app.page.run(async () => {
          await click('main button', 'Exam mode');
          await click('main button[aria-pressed]', 'Amazon S3', 'Q1 option');
          await click('main button', 'Next');
          await click('main button[aria-pressed]', 'AWS Fargate', 'Q2 option');
          await click('main button', 'Flag');
          await sleep(300);
          const timer = document.querySelector('[role="timer"]').textContent;
          await click('main button', 'Exit');
          await waitFor(() => mainText().includes('exam in progress'), 'resume card');
          const card = mainText().includes('2 of 5 answered');
          // Starting a new run must not silently discard the saved one.
          await click('main button', 'Exam mode');
          const confirm = await waitFor(() => document.querySelector('[role="dialog"]'), 'start-over dialog');
          const asked = confirm.textContent.includes('Start over?');
          await click('[role="dialog"] button', 'Cancel');
          await sleep(300);
          return { timer, card, asked, kept: mainText().includes('exam in progress') };
        });
        timerBefore = r.timer;
        assert(r.card, 'resume card does not show 2 of 5 answered');
        assert(r.asked && r.kept, 'starting a new exam did not ask before discarding the saved one');
      }],

      ['the exam survives closing and reopening the app, then submits', async () => {
        await app.stop();
        app = await launch(ws.profile);
        await openExam(app.page);
        const r = await app.page.run(async () => {
          await waitFor(() => mainText().includes('exam in progress'), 'resume card after restart');
          const card = mainText().includes('2 of 5 answered');
          await click('main button', 'Resume');
          await waitFor(() => document.querySelector('[role="timer"]'), 'timer');
          const answered = document.querySelectorAll('[aria-label*=", answered"]').length;
          const flagged = document.querySelectorAll('[aria-label*=", flagged"]').length;
          const timer = document.querySelector('[role="timer"]').textContent;
          // Finish the remaining questions and submit.
          await click('[aria-label^="Question 3"]');
          await click('main button[aria-pressed]', 'Amazon RDS');
          await click('main button[aria-pressed]', 'Amazon DynamoDB');
          await click('[aria-label^="Question 4"]');
          await click('main button[aria-pressed]', 'Amazon CloudFront');
          await click('[aria-label^="Question 5"]');
          await click('main button[aria-pressed]', 'AWS IAM');
          await click('main button', 'Submit');
          await waitFor(() => mainText().includes('100%'), 'result screen');
          await click('main button', 'Back');
          await waitFor(() => mainText().includes('Exam mode'), 'mode picker');
          await sleep(500);
          return { card, answered, flagged, timer, stillOffered: mainText().includes('in progress') };
        });
        assert(r.card, 'resume card lost across restart');
        assert(r.answered === 2 && r.flagged === 1, `answered ${r.answered}, flagged ${r.flagged}`);
        const secs = (t) => t.split(':').map(Number).reduce((a, b) => a * 60 + b, 0);
        assert(secs(r.timer) <= secs(timerBefore), `timer went back up: ${timerBefore} → ${r.timer}`);
        assert(!r.stillOffered, 'a submitted exam is still offered for resuming');
      }],

      ['wrong exam answers become a flashcard deck you can study', async () => {
        const submitted = await app.page.run(async (file) => {
          const exam = await api.practice.load(file);
          // Q1 and Q4 wrong, the rest right
          const picks = exam.questions.map((q, i) => (i === 0 || i === 3 ? [q.correctIndices[0] === 0 ? 1 : 0] : q.correctIndices));
          const attempt = await api.practice.submit(
            file,
            picks.map((selected, questionIndex) => ({ questionIndex, selected, seconds: 1 })),
            [],
            exam.contentHash,
          );
          return { added: attempt.mistakesAdded, percent: attempt.percent };
        }, ws.examFile);
        assert(submitted.added === 2 && submitted.percent === 60, `added ${submitted.added}, percent ${submitted.percent}`);

        await nav(app.page, 'Review');
        const r = await app.page.run(async () => {
          const row = await waitFor(
            () => Array.from(document.querySelectorAll('main [class*="row"]')).find((el) => el.textContent.includes('From your exam mistakes')),
            'mistakes deck row',
          );
          const title = row.textContent.includes('Mistakes · Practice Test #1');
          Array.from(row.querySelectorAll('button')).find((b) => b.textContent.includes('Review')).click();
          const dialog = await waitFor(() => document.querySelector('[role="dialog"]'), 'study dialog');
          const options = await waitFor(() => dialog.querySelectorAll('ol li').length || null, 'options on the card front');
          await click('[role="dialog"] button', 'Show answer');
          await waitFor(() => dialog.textContent.includes('Correct answer'), 'answer side');
          const answerShown = dialog.textContent.includes('A. Amazon S3') || dialog.textContent.includes('B. Amazon CloudFront');
          const explained = dialog.textContent.includes('Why the other options are wrong') || dialog.textContent.includes('WHY THE OTHER OPTIONS ARE WRONG');
          await click('[role="dialog"] button', 'End session');
          return { title, options, answerShown, explained };
        });
        assert(r.title, 'deck title missing');
        assert(r.options === 4, `card front shows ${r.options} options`);
        assert(r.answerShown && r.explained, 'card back missing the answer or the explanation');
      }],
    ]);
  } finally {
    await app.stop();
    ws.cleanup();
  }
}
