// Media and data paths through the real app: import, playback + seeking,
// subtitles, the HTML practice lesson, resource preview, the media:// fetch
// lockdown, and scoring a file-based practice exam.
import { assert, launch, runChecks } from './harness.mjs';
import { EXAM_QUESTIONS, makeWorkspace } from './fixtures.mjs';

export async function run() {
  const ws = makeWorkspace();
  const app = await launch(ws.profile);
  const { page } = app;
  let courseId = 0;

  try {
    return await runChecks('media', [
      ['imports a course folder into sections and lessons', async () => {
        const r = await page.run(async (dir) => {
          const imp = await api.courses.importPath(dir);
          const detail = imp.courseId ? await api.courses.get(imp.courseId) : null;
          return { status: imp.status, courseId: imp.courseId, sections: detail?.sections.map((s) => s.lessons.length) };
        }, ws.course);
        assert(r.status === 'imported', `import status ${r.status}`);
        assert(JSON.stringify(r.sections) === '[2,4]', `unexpected sections ${JSON.stringify(r.sections)}`);
        courseId = r.courseId;
      }],

      ['plays and seeks a lesson video', async () => {
        const r = await page.run(async (id) => {
          const detail = await api.courses.get(id);
          const lesson = detail.sections[0].lessons[0];
          const v = document.createElement('video');
          v.muted = true;
          document.body.appendChild(v);
          v.src = await api.media.getUrl(lesson.id);
          await new Promise((res, rej) => {
            v.addEventListener('loadedmetadata', res, { once: true });
            v.addEventListener('error', () => rej(new Error('video error ' + (v.error && v.error.message))), { once: true });
          });
          const duration = v.duration;
          v.currentTime = 2;
          await new Promise((res) => v.addEventListener('seeked', res, { once: true }));
          const out = { duration, currentTime: v.currentTime, width: v.videoWidth };
          v.remove();
          return out;
        }, courseId);
        assert(Math.abs(r.duration - 4) < 0.3, `duration ${r.duration}`);
        assert(Math.abs(r.currentTime - 2) < 0.3, `seek landed at ${r.currentTime}`);
        assert(r.width === 320, `video width ${r.width}`);
      }],

      ['delivers SRT subtitles as a WebVTT track', async () => {
        const r = await page.run(async (id) => {
          const detail = await api.courses.get(id);
          const lesson = detail.sections[0].lessons[0];
          const tracks = await api.media.subtitles(lesson.id);
          const vtt = await api.media.subtitleText(lesson.id, tracks[0].index);
          const v = document.createElement('video');
          v.muted = true;
          v.src = await api.media.getUrl(lesson.id);
          const t = document.createElement('track');
          t.kind = 'subtitles';
          t.default = true;
          t.src = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
          v.appendChild(t);
          document.body.appendChild(v);
          v.textTracks[0].mode = 'showing';
          await waitFor(() => v.textTracks[0].cues && v.textTracks[0].cues.length > 0, 'cues');
          const out = { tracks: tracks.length, vttHead: vtt.slice(0, 6), cues: v.textTracks[0].cues.length, first: v.textTracks[0].cues[0].text };
          v.remove();
          return out;
        }, courseId);
        assert(r.tracks === 1 && r.vttHead === 'WEBVTT', `tracks ${r.tracks}, head ${r.vttHead}`);
        assert(r.cues === 2 && r.first === 'Hello from SRT', `cues ${r.cues} "${r.first}"`);
      }],

      ['renders a real cover from the first video with the OS thumbnailer', async () => {
        const r = await page.run(async (id) => {
          const url = await api.courses.thumbnailUrl(id);
          if (!url) return { url };
          const img = new Image();
          img.src = url;
          await img.decode();
          return { url, width: img.naturalWidth, height: img.naturalHeight };
        }, courseId);
        if (!r.url && process.env.CI) {
          // Windows Server runners may lack the media codecs the shell
          // thumbnailer needs; the app then keeps the generated cover.
          console.log('      (no OS video thumbnailer on this machine — generated cover kept)');
          return;
        }
        assert(r.url === `media://thumb/${courseId}`, `thumbnail url ${r.url}`);
        assert(r.width > 0 && r.height > 0, `thumbnail ${r.width}x${r.height}`);
      }],

      ['serves the HTML practice lesson to the in-app frame', async () => {
        const r = await page.run(async (id) => {
          const detail = await api.courses.get(id);
          const practice = detail.sections.flatMap((s) => s.lessons).find((l) => l.fileType === 'practice');
          const f = document.createElement('iframe');
          f.style.display = 'none';
          const loaded = new Promise((res) => f.addEventListener('load', () => res(true), { once: true }));
          f.src = await api.media.getUrl(practice.id);
          document.body.appendChild(f);
          const ok = await Promise.race([loaded, sleep(10000).then(() => false)]);
          f.remove();
          return ok;
        }, courseId);
        assert(r === true, 'practice frame did not load');
      }],

      ['previews a Markdown resource over IPC, and refuses fetch() on media://', async () => {
        const r = await page.run(async (id) => {
          const res = await api.resources.listForCourse(id);
          const md = res.find((x) => x.kind === 'markdown');
          const text = await api.resources.readText(md.id);
          let fetched = 'allowed';
          try {
            await fetch('media://resource/' + md.id);
          } catch {
            fetched = 'refused';
          }
          return { text, size: md.sizeBytes, fetched };
        }, courseId);
        assert(r.text.startsWith('# Storage'), `text ${JSON.stringify(r.text)}`);
        assert(r.size > 0, `size ${r.size}`);
        assert(r.fetched === 'refused', 'media:// must not be readable with fetch()');
      }],

      ['scores a file-based practice exam and records history', async () => {
        const r = await page.run(async ({ dir, file }) => {
          await api.practice.addFolderPath(dir);
          const exam = await api.practice.load(file);
          const answers = exam.questions.map((q, i) => ({ questionIndex: i, selected: q.correctIndices, seconds: 3 }));
          const attempt = await api.practice.submit(file, answers, [0], exam.contentHash);
          const history = await api.practice.history(file);
          return { questions: exam.questions.length, percent: attempt.percent, history: history.length };
        }, { dir: ws.examsDir, file: ws.examFile });
        assert(r.questions === EXAM_QUESTIONS.length, `questions ${r.questions}`);
        assert(r.percent === 100, `percent ${r.percent}`);
        assert(r.history === 1, `history ${r.history}`);
      }],
    ]);
  } finally {
    await app.stop();
    ws.cleanup();
  }
}
