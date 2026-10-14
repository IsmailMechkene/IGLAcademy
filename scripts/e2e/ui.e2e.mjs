// User flows through the real UI: navigation, search shortcut, sidebar,
// dialogs, the player's right-hand course panel, practice-mode explanations,
// and an exam that survives the app being closed and reopened.
import fs from 'node:fs';
import path from 'node:path';
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

      ['Ctrl+K searches lessons, notes and exams and opens the result', async () => {
        const r = await app.page.run(async () => {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
          const input = await waitFor(() => document.querySelector('input[aria-label="Search everything"]'), 'palette');
          const focused = document.activeElement === input;
          const type = (text) => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, text);
            input.dispatchEvent(new Event('input', { bubbles: true }));
          };
          // An exam title and a lesson title, both found by one box.
          type('practice test #2');
          await waitFor(() => byText('[role="option"]', 'Practice Test #2'), 'exam result');
          type('versioning');
          const option = await waitFor(() => byText('[role="option"]', 'Versioning'), 'lesson result');
          const group = option.parentElement.textContent.includes('Lessons') || !!byText('[class*="group"]', 'Lessons');
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          await waitFor(() => document.querySelector('h1')?.textContent === 'Versioning', 'player opened on the lesson');
          const closed = !document.querySelector('input[aria-label="Search everything"]');
          await click('button[aria-label="Back to course"]');

          // A section name finds the section, and opening it starts at its
          // first unfinished lesson.
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
          const input2 = await waitFor(() => document.querySelector('input[aria-label="Search everything"]'), 'palette again');
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input2, 'storage');
          input2.dispatchEvent(new Event('input', { bubbles: true }));
          await waitFor(() => byText('[class*="group"]', 'Sections'), 'Sections group');
          const sectionOption = await waitFor(
            () => Array.from(document.querySelectorAll('[role="option"]')).find((o) => o.textContent.startsWith('Storage')),
            'Storage section result',
          );
          sectionOption.click();
          await waitFor(() => document.querySelector('h1')?.textContent === 'Buckets', 'player on the first lesson of Storage');
          await click('button[aria-label="Back to course"]');
          return { focused, group, closed };
        });
        assert(r.focused, 'palette input not focused');
        assert(r.group, 'results not grouped under Lessons');
        assert(r.closed, 'palette did not close after opening a result');
        await nav(app.page, 'Courses');
      }],

      ['the sidebar collapses to a rail and expands again', async () => {
        const widths = await app.page.run(async () => {
          const aside = document.querySelector('aside');
          const width = () => aside.getBoundingClientRect().width;
          const isCollapsed = () => /collapsed/.test(aside.className);
          // Wait for the width animation to settle (an unfocused window can
          // run it slowly) rather than sleeping a fixed time.
          await click('aside button[aria-label="Collapse sidebar"]');
          await waitFor(() => isCollapsed() && width() < 100, 'collapsed sidebar', 5000).catch(() => null);
          const collapsed = [isCollapsed(), width()];
          await click('aside button[aria-label="Expand sidebar"]');
          await waitFor(() => !isCollapsed() && width() > 200, 'expanded sidebar', 5000).catch(() => null);
          return [collapsed[1], width(), collapsed[0], isCollapsed()];
        });
        assert(widths[2] === true && widths[3] === false, `collapsed state ${JSON.stringify(widths)}`);
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
          const before = await waitFor(() => {
            const t = document.querySelector('h1')?.textContent;
            return t && !t.startsWith('Loading') ? t : null;
          }, 'lesson title');
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

      ['a quiz lesson inside a course runs natively and completes the lesson', async () => {
        await nav(app.page, 'Courses');
        const r = await app.page.run(async () => {
          await click('[aria-label^="Open course:"]');
          await sleep(300);
          if (!byText('main button', 'Practice Test #1')) await click('main button', 'Storage', 'Storage section');
          await click('main button', 'Practice Test #1', 'quiz lesson');
          await waitFor(() => /question 1 of 5/i.test(mainText()), 'native quiz');
          const iframe = !!document.querySelector('main iframe');
          // Answer the first question wrong: the per-answer feedback explains it.
          const option = (text) => Array.from(document.querySelectorAll('main button[class*="optionBtn"]')).find((b) => b.textContent.includes(text));
          option('Amazon EC2').click();
          await waitFor(() => mainText().includes('Not quite'), 'verdict');
          const feedback = mainText().includes('Amazon S3 is right for this.') && mainText().includes('Amazon EC2 does something else.');
          // Skip the rest, then finish. Buttons are re-enabled a render after
          // each answer, so wait for an enabled one before clicking.
          const press = async (text) => {
            const buttons = () => Array.from(document.querySelectorAll('main [class*="takerNav"] button'));
            const b = await waitFor(
              () => buttons().find((el) => el.textContent.includes(text) && !el.disabled),
              `quiz button "${text}"`,
            ).catch((err) => {
              const shown = buttons().map((el) => el.textContent.trim() + (el.disabled ? ' (disabled)' : '')).join(', ');
              throw new Error(`${err.message}; on ${(mainText().match(/question \d of 5/i) || ['?'])[0]} with [${shown}]`);
            });
            b.click();
          };
          for (let i = 1; i < 5; i++) {
            await press('Next');
            await waitFor(() => new RegExp(`question ${i + 1} of 5`, 'i').test(mainText()), `question ${i + 1}`);
            await press('Skip');
          }
          await press('See results');
          await waitFor(() => /0 of 5 questions correctly/.test(mainText()), 'results');
          const lessonId = (await api.courses.list().then((cs) => api.courses.get(cs[0].id)))
            .sections.flatMap((s) => s.lessons).find((l) => l.title.includes('Practice Test #1'));
          await click('button[aria-label="Back to course"]');
          await waitFor(() => document.querySelector('nav[aria-label="Main"]'), 'app chrome back');
          return { iframe, feedback, completed: lessonId?.completed };
        });
        assert(!r.iframe, 'quiz lesson still shown as a page preview');
        assert(r.feedback, 'per-answer feedback missing from the explanation');
        assert(r.completed === true, 'finishing the quiz did not complete the lesson');
      }],

      ['real playback time is recorded and shown on Home', async () => {
        await nav(app.page, 'Courses');
        const r = await app.page.run(async () => {
          const before = (await api.progress.studyStats()).today.studiedSeconds;
          await click('[aria-label^="Open course:"]');
          await click('main button', 'Welcome', 'lesson row');
          const video = await waitFor(() => document.querySelector('video'), 'video');
          // Dismiss a resume prompt if one appears.
          const startOver = byText('[role="dialog"] button', 'Start over');
          if (startOver) startOver.click();
          video.muted = true;
          video.currentTime = 0;
          await video.play();
          await sleep(3200); // the clip is 4 s long
          video.pause();
          await click('button[aria-label="Back to course"]'); // leaving the player flushes
          await sleep(500);
          const after = (await api.progress.studyStats()).today.studiedSeconds;
          await click('aside button', 'Home');
          const card = await waitFor(() => document.querySelector('section[aria-label="Your study"]'), 'study card');
          return { before, after, card: card.textContent };
        });
        const gained = r.after - r.before;
        assert(gained >= 2 && gained <= 5, `recorded ${gained}s for ~3s of playback`);
        assert(r.card.includes('Streak') && r.card.includes('Last 7 days'), 'study card incomplete');
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

      ['a 1,500-lesson course stays light: the player list renders only what is in view', async () => {
        // Generated here: one section, 1,500 lessons (empty files; only the
        // list is under test).
        const big = path.join(ws.dir, 'Huge Course');
        fs.mkdirSync(path.join(big, '01 - Everything'), { recursive: true });
        for (let i = 1; i <= 1500; i++) {
          fs.writeFileSync(path.join(big, '01 - Everything', `${String(i).padStart(4, '0')} - Topic ${i}.mp4`), '');
        }
        const r = await app.page.run(async (dir) => {
          const imp = await api.courses.importPath(dir);
          const detail = await api.courses.get(imp.courseId);
          await click('aside button', 'Courses');
          await click('[aria-label="Open course: Huge Course"]');
          const showAll = await waitFor(() => byText('main button', 'Show all 1500 lessons'), 'show-all button');
          const coursePageRows = document.querySelectorAll('main [class*="lessonRow"]').length;
          showAll.click();
          await click('main button', 'Topic 1', 'first lesson');
          const panel = await waitFor(() => document.querySelector('aside[aria-label="Course content and notes"] [data-windowed="true"]'), 'windowed list');
          const rendered = panel.querySelectorAll('button[title]').length;
          panel.scrollTop = panel.scrollHeight;
          const last = await waitFor(() => byText('aside button[title]', 'Topic 1500'), 'last lesson rendered after scrolling');
          last.click();
          await waitFor(() => document.querySelector('h1')?.textContent === 'Topic 1500', 'switched to the last lesson');
          await click('button[aria-label="Back to course"]');
          await click('aside button', 'Courses');
          return { lessons: detail.lessonCount, coursePageRows, rendered };
        }, big);
        assert(r.lessons === 1500, `imported ${r.lessons} lessons`);
        assert(r.coursePageRows === 200, `course page rendered ${r.coursePageRows} rows before "Show all"`);
        assert(r.rendered > 5 && r.rendered < 100, `player list rendered ${r.rendered} rows`);
      }],

      ['a course quiz resumes where you left off and turns mistakes into flashcards', async () => {
        await nav(app.page, 'Courses');
        const r = await app.page.run(async () => {
          const course = (await api.courses.list())[0];
          await api.quizzes.create({
            courseId: course.id,
            title: 'Storage check',
            description: '',
            questions: [
              { question: 'Which service stores objects?', options: ['Amazon S3', 'Amazon EC2'], correctIndex: 0, correctIndices: [0], explanation: 'S3 is object storage.' },
              { question: 'Which service is a CDN?', options: ['Amazon SQS', 'Amazon CloudFront'], correctIndex: 1, correctIndices: [1], explanation: '' },
            ],
          });
          await click('[aria-label^="Open course:"]');
          await click('main [role="tab"]', 'Quizzes');
          await click('main button', 'Take');
          await click('main button[aria-pressed]', 'Amazon EC2', 'wrong answer to Q1');
          await click('main button', 'Exit');
          const badge = await waitFor(() => byText('main [class*="quizTitle"]', 'In progress'), 'In progress badge');
          await click('main button', 'Take');
          await waitFor(() => document.querySelector('[role="dialog"]')?.textContent.includes('Resume this quiz?'), 'resume prompt');
          await click('[role="dialog"] button', 'Resume');
          const kept = await waitFor(() => byText('main button[aria-pressed="true"]', 'Amazon EC2'), 'saved answer restored');
          await click('main button', 'Next');
          await click('main button[aria-pressed]', 'Amazon CloudFront');
          await click('main button', 'Submit');
          const notice = await waitFor(() => byText('main [role="status"]', 'added to your mistakes deck'), 'mistakes notice');
          const text = notice.textContent;
          await click('main button', 'Back');
          await waitFor(() => byText('main button', 'Take'), 'quiz list');
          await sleep(300);
          return { badge: !!badge, kept: !!kept, notice: text, stillInProgress: !!byText('main [class*="quizTitle"]', 'In progress') };
        });
        assert(r.badge && r.kept, 'saved quiz run was not offered or not restored');
        assert(r.notice.includes('1 question added'), `notice "${r.notice}"`);
        assert(!r.stillInProgress, 'a submitted quiz still shows as in progress');
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
