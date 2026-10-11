# IsmaLearn — Diagnostic Audit

**Audited:** 2026-10-11 · **Commit:** `c621349` (+26 uncommitted CSS/TSX files in the working tree)
**Method:** full read of all 155 tracked source files, `tsc --noEmit`, `npm test`, `npm run build`,
`npm run test:e2e`, `npm audit`, plus two custom CDP probes that drove the **built production app**
through its real IPC surface and real UI. Nothing in the repo was modified except this file.

> Verification labels used below: **CONFIRMED (runtime)** = reproduced against the running app and
> the observed output is quoted; **CONFIRMED (code)** = traced end-to-end in source with the decisive
> lines quoted; **UNVERIFIED** = plausible from code but not reproduced.

---

## 0. Status — Phases 0–4 applied 2026-10-11

### Phases 3 and 4

| ID | Status | What changed | Verified by |
|---|---|---|---|
| **M2** | **FIXED** | `formatDate` / `formatDateTime` go through `parseDbTime`, so SQLite `datetime('now')` values are read as UTC. | Unit test (same instant in both formats renders identically). UI probe: a note saved at `19:27:42` UTC shows **"8:27 PM"** local (CET+1), matching the expected value. |
| **M21** | **FIXED** | Every `due_at` write is ISO-8601: `insertFlashcard` writes it explicitly, IPC `dueAt` is canonicalised by `optionalTimestamp`, and migration 7 rewrites legacy rows. | Unit tests: legacy `2030-01-01 12:00:00` → `2030-01-01T12:00:00.000Z`; the card is no longer due at 11:00, and is due at 13:00. |
| **M3** | **FIXED** | Course roots are canonicalised (`realpathSync.native`), and paths are compared through `pathKey` (case-insensitive on Windows): duplicate detection, rescan matching and media containment. | Unit tests (upper/lower case, `..\` spellings). Runtime probe: importing the same folder in upper case → `duplicate`. |
| **M10** | **FIXED** | Sections store `rel_path` (migration 8), and rescan matches on it instead of on title. Legacy rows get backfilled from their lessons. A renamed folder is adopted rather than duplicated (the title follows unless you renamed it yourself). A file moved to another folder moves with its progress. Same-named siblings get "Parent / Leaf" titles. | 7 unit tests: siblings kept apart, folder rename (ids, progress and notes kept, 0 missing), user title preserved, cross-folder move, legacy backfill. |
| **M6** | **FIXED** | `settingsSchema.ts` is the single whitelist: `settings:set`/`get` reject unknown keys, and `getAllSettings` drops stored rows that are unknown or invalid. It is an exhaustive `switch`, so a new setting without a rule fails to compile. | Unit tests + probe: `settings.set('totallyMadeUpKey', 1)` → rejected. |
| **M7** | **FIXED** | A shared `ConfirmDialog` (focus starts on Cancel) now guards deleting a note (panel + page), a quiz, a deck and a card. | UI probe: Delete → dialog with focus on **Cancel**; Cancel keeps the note (1); confirming removes it (0). |
| **M8** | **FIXED** | With several courses, "New note" asks which course the note belongs to, and the editor shows the course/lesson. | UI probe: picker lists both courses; choosing Beta makes a note stored under **Beta Course**. |
| **M9** | **FIXED** | A `useNoteAutosave` hook owns its own timer and flushes pending edits on close, note switch, unmount and `ismalearn:window-closing`. Search got a separate timer. Also fixed in passing: "insert timestamp" changed the text without ever saving it. | UI probe: text typed and closed **within** the debounce was saved; same for the window-closing event. |
| **M11** | **FIXED** | Each attempt records a `content_hash`, and each exam version's questions are stored once (migration 9, deduplicated, included in backups, pruned with the source). A submit is scored against the version that was served, even if the file changed mid-exam. An old attempt that can't be matched returns an explanation instead of `null`, and analytics take topics from the attempt itself. | 5 unit tests: review still works after an edit, a mid-exam change scores 100%, an unknown version is refused clearly, a legacy attempt explains itself, snapshots are deduplicated and pruned. |
| **H5** | **FIXED** | Electron 33.4 → **44.7.0**, better-sqlite3 → 13.0.3, @electron/rebuild → 4.2, electron-builder → 26.15. `media://` no longer has `supportFetchAPI` (the precondition of GHSA-v3j7-r9gq-3gjw), and `connect-src` no longer lists `media:`. Text previews (`resources:readText`) and subtitles (`media:subtitleText` → `blob:` URL) come over IPC instead. | Probe on the Electron 44 build: video 206 + seek, PDF iframe 200, `fetch('media://…')` refused, subtitles via the real CC menu → `blob:` track, **2 cues**. `npm run dist` + `npm run smoke` pass. |
| M13 | **FIXED** | Logger buffers lines and appends asynchronously, tracks size in memory and flushes synchronously on exit/crash. Renderer console forwarding uses the non-deprecated `details` form and only forwards warnings/errors. | Probe log shows the expected entries. |
| M18 | **FIXED** | Parsed exams are cached by path + size + mtime (LRU 64). | Unit test: a changed file is re-parsed right away. |
| M20 | **FIXED** | New `courses:getLesson` (scoped to the course). The player fetches the course tree once instead of again on every lesson switch. | Probe: correct lesson/section, and `null` for the wrong course. |
| L1 | **FIXED** | ESLint 10 flat config (`npm run lint`, clean) + `.github/workflows/ci.yml` (typecheck, lint, test, build on windows-latest). Note: e2e is not in CI, because it downloads videos and reads a local exam folder. | `eslint .` exits 0. |
| L2, L3 | **FIXED** | `.seed-bundle.cjs` is always cleaned up and gitignored. `data/practice_exams/` is gitignored. Both were untracked with `git rm --cached` and **the files are still on disk**. | `git status` shows 23 staged deletions (index only). |
| L4 | **FIXED** | Thumbnails get the same course-folder containment check as lessons and resources. | Unit test. |
| L5 | **FIXED** | `will-navigate` guard: only the app bundle (or the dev server origin) may load. | Probe: `location.href = 'https://example.com/'` → still on `dist/index.html`, and the attempt is logged. |
| L6 | **FIXED** (partly moot) | Migration 10 indexes `flashcards(deck_id, position)`. `question_id` was already indexed in v5. The global path lookups were dead code and are gone (L11). | Unit test. |
| L7 | **covered by H6** | Startup recovery (quarantine + dialog) already handles a bad ledger. Making migration 1 `IF NOT EXISTS` would only move the failure to migration 2. | — |
| L8 | **FIXED** | Resource rows no longer `statSync` each file; sizes come from `fs.promises.stat` in the IPC layer. | Unit test (size 5 / missing −1). |
| L9 | **FIXED** | The e2e scripts wait for conditions instead of sleeping, and the runner no longer retries. | 1 of 7 runs failed (both scripts, the first launch right after the native rebuild; its log wasn't captured). The 6 runs after that all passed. |
| L10 | **FIXED** | `updateSettings` writes outside the state updater, and a rejected write rolls the UI back and shows an error. | Code + typecheck. |
| L11 | **FIXED** | Removed `findLessonByPath`, `findResourceByPath`, `updateResourceFilePath` and `getQuizByLessonId`. `requirePath` (null-byte check) now guards every path-shaped IPC argument. | Typecheck + lint. |
| M19 | **FIXED** (adjacent) | `postinstall` moved into `scripts`, so the README's `npm install` claim is true. `engines.node >= 22` added (needed by better-sqlite3 13). | — |

After Phases 3 + 4: `tsc --noEmit` clean, `eslint .` clean, **138/138 unit tests** (was 111), `npm run build`
clean, `npm run test:e2e` passes, `npm run dist` + `npm run smoke` pass (the smoke test now uses a throwaway
profile, so it no longer migrates your real database).

### Phases 0–2

Phase 2 was run as **"delete the fakes"**: anything with nothing behind it was removed rather than
built. Features that were fully implemented and merely *unwired* were connected instead — deleting
those would have removed working code (and a CC menu, an SRT converter and its tests) to fix a
one-line omission. Say the word if you want them gone as well.

| ID | Status | What changed | Verified by |
|---|---|---|---|
| **H1** | **FIXED (wired, not deleted)** | The subtitle branch in the `media://` handler now runs *before* the single-id parse that turned `sub/<id>/<index>` into `NaN`, and the player passes `lessonId` so tracks are actually requested. | Runtime probe: `media://sub/5/0` now returns **200 `text/vtt`** (was 400). Player probe: CC button appears, menu lists **"Off / Subtitles / FR"**, selecting one yields `<track src="media://sub/1/0">` that Chromium parses into **2 cues**, first reading "Hello from SRT". New unit test covers track listing + SRT→VTT. |
| **H2** | **FIXED (wired, not deleted)** | `connect-src 'self' media:` added to the CSP; `.txt`/`.md`/`.srt` added to the served MIME types. | Runtime probe: `fetch('media://resource/2')` → **`{ok: true, status: 200}`** with the file's text (was `Failed to fetch`), and the CSP console error is gone. |
| **M5** | **FIXED** | Lesson duration is learned from the player at `loadedmetadata` and persisted via `courses:setLessonDuration` (validated, 24 h ceiling, only rewritten on >1 s drift), so the duration UI and the resume heuristic have real data. | Runtime probe: `durationBefore: null` → `durationAfter: 10.026667`. New unit test covers the write-only-when-changed rule. |
| **M4** | **DELETED (the claim, not the data)** | The dashboard's "Learning time" card claimed watch time but summed the furthest point reached per lesson. Relabelled **"Content covered"** with a tooltip saying skipping ahead counts, and the unused `addWatchedTime` accumulator — the half-built real implementation — was removed, with the column's true meaning documented on `savePosition`. | Code change; the metric is unchanged, only its (previously false) label. Real watch time would need a playback ticker, deliberately not built. |
| **M14** | **DELETED** | "When a duplicate course is imported" (ask/skip/rescan) was stored and validated but never read. Setting, UI row, type field, default and validation all removed; migration 6 deletes the stored rows. | New unit test upgrades a pre-v6 database and asserts the key is gone while real settings survive. |
| **M15** | **DELETED** | The update checker could only ever report "not configured" (`UPDATE_REPO = ''`, no publish feed). `updateService.ts`, the `app:checkForUpdates` IPC, the preload method, the Settings row and the unread `checkForUpdates` setting are gone — as is `app:openUrl`, whose only caller was the deleted "Get update" button. README no longer advertises it. | Typecheck + build; the preload surface is two channels smaller. |
| **M16** | **FIXED (one line)** | Clicking a timestamp in a note now passes `startAt`, so the player actually seeks — the route already supported it and the comment claiming the player handled it was wrong. | Code change; the same `startAt` path is already exercised by the bookmark "Jump" button. |
| **M17** | **FIXED** | `examPassPercent` is now honoured in QuizHistory, PracticeExams (2 places), ExamStats (trend pass-line + weak-topic threshold) and the ModePicker's "N% to pass" label, which all hardcoded 70. | `grep` shows no hardcoded pass marks left in `src/`. |
| **C2** | **FIXED** | `refreshKey` removed from the `<main>` key, so a data refresh no longer remounts the page; the player records completion into local state (`withCompletion`) instead of calling `refreshAll()`. Settings' data effect now depends on `refreshKey` rather than the stable `refreshAll`. | Runtime probe at 93% of a real video: `videoStillSameElement: **true**`, `oldElementDetached: **false**`, playback ran on to 10.03s instead of resetting to 0. Sidebar still flips to "Completed". |
| **C3** | **FIXED** | `practice:submit` places each answer by `questionIndex` (the question's position in the file) instead of trusting array order, rejecting duplicate/out-of-range indices; `FileExamPage` sends it. Array position is still accepted for callers that submit in file order. | New unit test replaying the real shuffle pipeline + **full UI probe**: shuffle on, display order `[3,1,4,6,5,2]`, every question answered correctly as displayed → **"6 of 6 correct", 100%**, stored attempt reads back in file order. |
| **H7** | **FIXED** | Scoring extracted to `scoreAttempt(quiz, answers)`: one row per quiz question, `total = quiz.questions.length`, blank answers count as incorrect instead of raising `Invalid option selected`, out-of-range options dropped, unknown ids ignored. Exam mode can now submit (and advance past) blank questions, as the real exam does. | New unit test: short payload now scores **1/3 = 33%** (was 1/1 = 100%); blank + out-of-range answers no longer throw. |
| **M1** | **FIXED** | The exam clock derives from a wall-clock deadline, ticks twice a second, and re-syncs on `visibilitychange`, instead of decrementing a counter per interval. | Runtime probe: starving the JS event loop for ~3.9 s moved the clock `12:00` → **`11:56`**. The old counter would have lost that time. |
| **M12** | **FIXED** | A `null` submit result is treated as a failure in both runners (`QuizTaker`, `PracticeRunner`) instead of leaving the button stuck on "Submitting...". | Code change; the triggering condition (exam file changing mid-run) is not reproducible on demand — **not runtime-verified**. |
| **C1** | **FIXED** | Rescan now flags vanished files (`lessons.missing_since`, migration 5) instead of deleting the row; `getCourseHealth` keeps the flag in sync; missing lessons are badged in the lesson list and sidebar; permanent removal moved behind an explicit, confirmed "Forget lesson" action (`courses:forgetLesson`). | 4 new unit tests + runtime probe: notes 1→**1**, bookmarks 1→**1**, watched 123.5→**123.5** after the same rescan that used to zero them. UI probe shows the banner, badge and both dialogs. |
| **H3** | **FIXED** | `media:locateFile` validates containment, file kind and existence **before** writing the lesson row, and returns a typed `LocateFileResult`; both call sites now report `outside-course` / `wrong-type` / `error` through a dialog instead of swallowing an unhandled rejection. | Typecheck + both call sites rewritten; refusal paths unit-reachable (containment behaviour already covered by `tests/database.test.ts`). |
| **H4** | **FIXED** | Attempt answers now store a snapshot of the question as asked, the `question_id` FK cascade was removed (table rebuild in migration 5), and the editor diffs questions instead of replacing them wholesale. | 2 new unit tests + runtime probe: after rewriting Q1 and deleting Q2 through the real IPC, the attempt still reads back **both** original questions, options, explanations and 1/2 = 50%. |
| **H6** | **FIXED** | `schema_migrations` removed from backup/restore; restore takes column names from the live schema (not the file) and coerces non-primitives; a failed open now quarantines the database by **renaming** it (never deleting), with a dialog and a retry, and `createDatabase` closes the handle on failure so the rename can succeed on Windows. A pre-migration copy is written to `backups/` before any schema upgrade. | 4 new unit tests, including a populated **pre-v5 database upgraded in place** (data intact, cascade gone) and a quarantine-then-reopen cycle. |
| L12 | **not done** | The 26 uncommitted CSS/`main.ts` changes were left untouched — committing someone else's unreviewed design pass is not mine to do. My edits do not overlap them (only `CourseDetail.module.css` gained one new class). | — |

Deliberately left alone: resource rows are still dropped on rescan (no user data attached to them);
the notes/bookmarks cascade still applies to *explicit* lesson removal (that is the point of the
confirmation); **M10** now surfaces as a duplicate section full of "File missing" badges when a
section folder is renamed, instead of silent data loss — still worth fixing in Phase 3. Exam timers
are anchored but still **not persisted**, so closing the window mid-exam loses the clock; resuming
vs voiding an interrupted exam is a product decision, not a bug fix.

Fixed as a side effect of C2: rescan/import result dialogs are now readable. `refreshAll()` used to
remount the page that had just opened them, so "Rescan complete: N new lessons" was destroyed in the
same tick it was created — confirmed visible in a UI probe after the change.

After Phases 0 + 1: `tsc --noEmit` clean, **108/108 unit tests pass** (was 96), `npm run build`
clean, `npm run test:e2e` passes, 6 CDP probes against the built app.

---

## 1. Executive summary

**Overall health: 5.5 / 10.**

This is not AI slop in the usual sense: the skeleton is genuinely well built. Context isolation,
sandbox, a preload-only typed bridge, per-domain IPC validation, path-containment checks, versioned
migrations, a transactional importer, 96 passing unit tests and a clean strict-TypeScript build are
all real and all work. The problem is the top 20% of each feature — the part the user actually
touches — which is where the defects cluster: **three of them break core flows outright and one
destroys user data silently.** Several advertised features are wired to nothing.

**Top 5 problems**

1. **Rescan silently deletes notes, bookmarks and progress** when a lesson file is temporarily
   unavailable (unplugged drive, renamed folder). Measured: notes 1 → 0, bookmarks 1 → 0, watched
   seconds 123.5 → 0 from a single rescan. `rescanOnStartup` / "Rescan all" make it automatic and
   library-wide. **(C1)**
2. **The video player restarts itself at 90% of every lesson.** `refreshAll()` fires on
   auto-complete and `refreshKey` is part of the `<main>` React `key`, so the whole page — including
   the `<video>` — unmounts. Measured: element detached, `currentTime` back to 0, playback paused. **(C2)**
3. **"Shuffle questions and answer order" produces wrong exam scores.** The renderer submits answers
   in *display* order; the main process scores them *positionally* against the original parse order.
   Measured: identical correct answers rotated by one position scored 0% instead of 100%. **(C3)**
4. **Subtitles are a dead feature end to end** — the player never receives the `lessonId` needed to
   fetch tracks, and the `media://sub/...` URL the backend hands out returns **HTTP 400** anyway. **(H1)**
5. **Electron 33 is end-of-life** (current: 44) with ~38 open advisories, one of which
   (custom protocol with `supportFetchAPI` and no `corsEnabled`) describes this app's exact
   `media://` registration. **(H5)**

**Recommendation: fix in place — do not rewrite.** The data layer, IPC boundary and importer are
worth keeping; nothing in the architecture needs to be replaced. Budget the work as (a) one day of
data-safety fixes (C1, H3, H4, H6), (b) one day of player/exam correctness (C2, C3, H7), (c) one day
of "finish or delete the fake features" (H1, H2, M14–M16), (d) an Electron upgrade. The only module
I would consider rewriting rather than patching is `rescanCourse` in
`electron/services/courseImportService.ts` — its match-then-delete logic is the root cause of C1 and
M11 and is easier to redesign (soft-delete / "missing" flag) than to patch.

---

## 2. Stack and architecture

| Layer | Actual (from config, not README) |
|---|---|
| Shell | Electron 33.4.11 (`electron-builder` 25, NSIS x64 only, `signAndEditExecutable: false`) |
| Renderer | React 18.3 + TypeScript 5.9 (`strict`, `noUnusedLocals`, `noUnusedParameters`), Vite 5.4, CSS Modules, lucide-react |
| Main | TypeScript bundled by esbuild 0.24 → CJS (`dist-electron/main.js`, `preload.js`) |
| DB | SQLite via `better-sqlite3` 11.10 (WAL, `foreign_keys = ON`), 4 hand-rolled migrations in `schema_migrations` |
| State | No library. One React Context in `src/App.tsx` (route, settings, `refreshKey`, search) + per-page `useState`; all reads go through IPC |
| Routing | Hand-rolled discriminated union `Route` in `src/App.tsx` — no router, no history, no deep links |
| Tests | Vitest (10 files / 96 tests, main-process logic only) + 2 CDP e2e scripts. **No renderer/component tests, no linter, no CI** |

**Entry points:** `electron/main.ts` (app + `media://` protocol + IPC registration) → `electron/ipc/*.ts`
(11 modules) → `electron/database/repositories/*.ts` (8) / `electron/services/*.ts` (12);
`index.html` → `src/main.tsx` → `src/App.tsx` → `src/pages/*` (9) + `src/components/*` (16).
Media never crosses IPC as a path: the renderer gets opaque `media://lesson/<id>` URLs that the main
process resolves and containment-checks. That design is sound and should be preserved.

**Dependency notes.** Runtime deps are 4 and all used (`better-sqlite3`, `react`, `react-dom`,
`lucide-react`). No unused, duplicated or suspiciously named packages. `npm audit`: **26
vulnerabilities (3 critical, 16 high, 7 moderate) — all in the dev/build toolchain**
(`vitest`→`tinypool` RCE, `electron-builder`→`tar`, `node-gyp`, `vite`, `esbuild` dev-server), none
shipped to users. The shipped-runtime risk is Electron itself (H5). Everything is 1–11 major
versions behind (electron 33→44, vite 5→8, react 18→19, vitest 2→5).

---

## 3. Findings

### Critical

| ID | Area | File:Line | Problem | Evidence | Fix | Effort |
|---|---|---|---|---|---|---|
| **C1** | Data loss | `electron/services/courseImportService.ts:187-202`; `electron/database/migrations.ts:53,65,183` | Rescan deletes any lesson whose file is not on disk *right now*. `notes.lesson_id`, `bookmarks.lesson_id` and `lesson_progress.lesson_id` are all `ON DELETE CASCADE`, so the whole note/bookmark/progress row dies with it — not just the link. A renamed section folder, an unplugged external drive or a moved file is enough. `courses:rescanAll` (`electron/ipc/courses.ts:87`) and `rescanOnStartup` (`src/App.tsx:108-126`) apply this to the entire library unattended. | **CONFIRMED (runtime).** Probe: created note + bookmark + 123.5 s position on a lesson, deleted only that lesson's `.mp4`, called `courses.rescan`. Result `{"rescan":{"status":"ok","removedLessons":1},"before":{"notes":1,"bookmarks":1,"totalWatchedSeconds":123.5},"after":{"notes":0,"bookmarks":0,"totalWatchedSeconds":0}}`. No warning, no undo, dialog reports success. | Never hard-delete on rescan. Add `lessons.missing_since` and mark instead; expose "N files missing" (the health UI already exists) and only delete on explicit user action. Minimum stop-gap: drop the delete loop and change the note/bookmark FKs to `ON DELETE SET NULL`. | M |
| **C2** | Player | `src/App.tsx:163` + `src/pages/Player/Player.tsx:186-191,271-277` | `handleTimeUpdate` calls `refreshAll()` the moment a lesson crosses 90%; `refreshKey` is interpolated into the `key` of `<main className="app-content">`, so React unmounts and remounts the entire page — video element included. Same thing on every manual complete/incomplete toggle. | **CONFIRMED (runtime).** UI-driven probe (real MP4, resumePlayback=never): set `currentTime` to 93% of duration, waited 2.5 s → `videoStillSameElement: false`, `oldElementDetached: true`, `newCurrentTime: 0`, `newPaused: true`. Every lesson stops and rewinds to 0 at 90%; with `resumePlayback: 'ask'` the user instead gets a resume dialog mid-lesson. | Stop remounting on data refresh: remove `refreshKey` from the `key` (let pages re-fetch via the dep instead), and don't call `refreshAll()` from the player — update local state and refresh on navigation away. | S |
| **C3** | Exam scoring | `src/components/Quiz/FileExamPage.tsx:16-39,105-119` vs `electron/services/practiceLibraryService.ts:181-194` | `practice:submit` is **positional**: `answers[i]` is scored against `exam.questions[i]` in original parse order. With shuffle on, `buildShuffled` reorders questions (`id: qi` keeps the original index but the array order changes) and `submitAnswers` builds the payload by mapping over the *shuffled* array — so answers land on the wrong questions. Option-level remapping (`normalizeSelected`) is correct; question-level is not. Stored `selections` are equally misaligned, so the review screen and `ExamStats` topic breakdown are wrong too. | **CONFIRMED (runtime + code).** Probe submitted the exam's own correct answers in order → `{"percent":100}`; the same three answer sets rotated by one position → `{"percent":0,"score":0}`, proving the positional contract. The display-order payload is plain in `FileExamPage.tsx:111-117`. | Submit a question identity, not a position: send `{questionIndex, selected}` and have `submitExamAttempt` index by it (or sort the payload by `q.id` before submitting). Add a test that shuffles and expects 100%. | S |

### High

| ID | Area | File:Line | Problem | Evidence | Fix | Effort |
|---|---|---|---|---|---|---|
| **H1** | Fake feature | `src/pages/Player/Player.tsx:440-456`; `src/components/VideoPlayer/VideoPlayer.tsx:118-132`; `electron/main.ts:47-65` | Subtitles cannot work, for two independent reasons. (1) `VideoPlayer` declares `lessonId?: number` and bails out of the track fetch when it is undefined — and `Player` never passes it, so `tracks` stays `[]` and the CC button (gated on `tracks.length > 0`) never renders. (2) Even if it did, the protocol handler computes `Number(url.pathname.replace(/^\//,''))` and 400s *before* reaching the `host === 'sub'` branch; for `media://sub/5/0` that is `Number("5/0") = NaN`. | **CONFIRMED (runtime).** `media.subtitles(5)` correctly returned `[{"index":0,"label":"Subtitles","url":"media://sub/5/0"}]`; loading that URL produced CDP `Network.responseReceived` `{"url":"media://sub/5/0","status":400,"mime":"text/plain"}`. `grep "lessonId="` shows the prop is only ever passed to `PracticeViewer` and `NotesPanel`. | Move the id parse inside the non-`sub` branch, and pass `lessonId={currentLessonId}` to `VideoPlayer`. Add an e2e assertion that a `.srt` sidecar yields a 200 `text/vtt`. | S |
| **H2** | Broken feature | `index.html:6`; `src/components/Resources/ResourceSection.tsx:66-82` | The in-app preview for text/markdown/subtitle resources does `fetch(mediaUrl)`. The CSP sets no `connect-src`, so it falls back to `default-src 'self'` and every such fetch is refused — the preview silently lands in its error branch. PDFs/images are unaffected (`img-src` lists `media:`). | **CONFIRMED (runtime).** Probe got `resourceFetch: {"threw":"Failed to fetch"}` with renderer console: *"Refused to connect to 'media://resource/2' because it violates the following Content Security Policy directive: "default-src 'self'". Note that 'connect-src' was not explicitly set…"* | Add `connect-src 'self' media:;` to the CSP meta tag. | S |
| **H3** | Data corruption | `electron/ipc/media.ts:30-45`; `electron/services/fileService.ts:30-39` | "Locate file" writes the user-picked path with `updateLessonFilePath` **before** validating it, then calls `getMediaUrl`, which enforces course-root containment and throws. Net effect for the normal case (file moved somewhere else): the lesson row is overwritten with a path that can never be served, the IPC call rejects, and `handleLocateFile` (`Player.tsx:279-285`) and the health dialog (`CourseDetail.tsx:309-321`) `await` it with no `try/catch` → unhandled rejection, no error shown, button appears to do nothing. `getCourseHealth` then reports the lesson as healthy (it only checks `existsSync`) while playback keeps failing. | **CONFIRMED (code).** Containment throw is asserted by the project's own test `tests/database.test.ts:540` ("rejects files outside the course directory"); the write-before-validate order is explicit at `ipc/media.ts:43-44`. | Validate containment first and return a typed failure; if the file is legitimately outside the folder, either refuse with an explanation or re-root the course. Wrap both call sites in error handling. | S |
| **H4** | Data loss | `electron/ipc/quizzes.ts:90-97`; `electron/database/migrations.ts:109` | Editing a quiz deletes and re-inserts every question ("replace questions wholesale"). `quiz_attempt_answers.question_id` is `ON DELETE CASCADE`, so **all per-answer history for every past attempt is destroyed**, while `quiz_attempts` rows survive — leaving history entries whose review screen is empty but whose score is still displayed. | **CONFIRMED (code).** Delete loop at `ipc/quizzes.ts:93` (`existing?.questions.forEach((q) => deleteQuestion(db, q.id))`) + the cascade in the schema. | Diff questions instead of replacing them (update in place, insert new, delete only removed ones), or snapshot question text into `quiz_attempt_answers` at submit time. | M |
| **H5** | Security | `package.json:37` (`electron: ^33.2.0`); `electron/main.ts:25-35` | Electron 33 is past end-of-support (latest 44) so it receives no Chromium security fixes; `npm audit` lists ~38 advisories against it, 8 of them high. One is directly applicable to this codebase: **GHSA-v3j7-r9gq-3gjw — "Custom protocol with `supportFetchAPI` but not `corsEnabled` allows cross-origin reads" (fixed in 39.8.10)**. `media` is registered exactly that way, and the app renders untrusted local HTML (imported practice tests) in an iframe. | **CONFIRMED (runtime).** `npm audit --json` advisory list quoted above; the privileged-scheme registration is at `main.ts:26-34`. | Upgrade to a supported Electron (≥41.10.6 minimum, 44 preferred) and re-test the native module ABI; add `corsEnabled: true` (or drop `supportFetchAPI`) on the `media` scheme. | M |
| **H6** | Upgrade / restore | `electron/services/backupService.ts:12-32,75-99`; `electron/ipc/backup.ts:58-67` | `TABLES_IN_DELETE_ORDER` includes `schema_migrations`, so restoring a backup **replaces the schema version ledger with the backup's**. Any backup taken before a future migration N will, after restore, leave the live (already-migrated) database claiming it is at version N-1 → next launch re-runs migration N → `CREATE TABLE`/`ADD COLUMN` on objects that already exist → `getDb()` throws inside `app.whenReady` → the app fails to start, every launch, permanently. Secondary issues in the same function: column names are taken from `rows[0]` only and interpolated into SQL as `"${c}"` with no escaping (malicious/hand-edited backup JSON), and row values are never type-checked. | **CONFIRMED (code).** `importData` deletes then re-inserts `schema_migrations` (lines 78-96); `runMigrations` (`migrations.ts:255-268`) re-executes any version missing from that table and lets the error propagate; `main.ts:147` calls `getDb()` with no recovery path. Harmless *today* (all 4 migrations ship in 1.0.0) — this is a landmine armed by the next schema change. | Exclude `schema_migrations` from backup/restore; validate row shapes against a whitelist of columns per table; wrap `getDb()` in a startup recovery path (rename the bad DB, show a dialog) instead of dying. | M |
| **H7** | Exam scoring | `electron/ipc/quizzes.ts:104-142`; `electron/database/repositories/quizzes.ts:204-223` | The server trusts the client's answer array shape. `total` is `answers.length`, not the quiz's question count, so a short array yields an inflated percentage. Conversely an *empty* `selectedIndices` is rejected outright (`Invalid option selected for question N`) even though the preload comment at line 115 says it "counts as incorrect" — so the timed auto-submit path in `QuizTaker` (`:110-124`), which deliberately submits unanswered questions, fails with "Couldn't save your attempt" and the whole attempt is lost. | **CONFIRMED (runtime).** Probe on a 2-question quiz: submitting 1 answer → `{"score":1,"total":1,"percent":100}`; submitting one answered + one empty → `ValidationError: Invalid option selected for question 2`. | Score against `quiz.questions`, not the payload: `total = quiz.questions.length`, missing/empty answers recorded as incorrect with `selected_indices = '[]'` (the repo already round-trips `-1`/`[]` sentinels — see `parseIndexSet`). | S |

### Medium

| ID | Area | File:Line | Problem | Evidence | Fix | Effort |
|---|---|---|---|---|---|---|
| M1 | Exam timing | `src/components/Quiz/QuizTaker.tsx:109-124` | The exam clock is a `setInterval` decrementing a counter, with no wall-clock anchor and no persistence. Chromium throttles timers in occluded/minimised windows and the interval does not advance across OS sleep, so a backgrounded or suspended exam gets extra real time; closing the window loses the clock entirely. `backgroundThrottling` is never disabled. | CONFIRMED (code) — no `Date.now()` deadline anywhere in the timer; `grep backgroundThrottling` → no hits. | Store `deadlineAt = Date.now() + limit*1000` and derive the display from it each tick; persist it so an interrupted exam can resume or be voided. | S |
| M2 | Dates | `src/utils/format.ts:19-33` vs `:41-52` | `formatDate`/`formatDateTime` do `new Date(iso)` on SQLite `datetime('now')` strings (`"2026-10-11 17:13:29"`, UTC, no zone marker), which Chromium parses as **local** time. The helper written for exactly this (`parseDbTime`) is only used by `timeAgo`. Every note "Edited", quiz/exam history timestamp, bookmark and backup date is off by the UTC offset. | CONFIRMED (runtime) — probe captured `updatedAt: "2026-10-11 17:13:29"` created while the machine's local clock read 18:13 (CET); the UI renders it as 17:13. | Route `formatDate`/`formatDateTime` through `parseDbTime`. (Better: store ISO-8601 everywhere — see M4/M21.) | S |
| M3 | Import | `electron/services/courseImportService.ts:30-33`; `electron/database/repositories/courses.ts:56-59` | Duplicate detection is exact string equality on `source_path`. Windows paths are case-insensitive, so the same folder reached via a different-cased drive letter or name imports a **second independent course** with duplicate lessons, progress and notes. | CONFIRMED (runtime) — `importPath("C:\\…\\AWS Course")` → `duplicate`; `importPath("c:\\…\\AWS Course")` → `{"status":"imported","courseId":2}`, `courses.list().length === 2`. | Normalise with `fs.realpathSync.native` (resolves true casing) before compare/store, and add a case-insensitive uniqueness check on Windows. | S |
| M4 | Stats | `electron/database/repositories/progress.ts:4-12`, `:15-22` | `savePosition` sets `watched_seconds = MAX(existing, position)`, i.e. "furthest point reached", not time watched. Dragging the scrubber to the end credits 100% of the runtime. The function that would do it properly, `addWatchedTime`, is **never called** from anywhere. Everything labelled "watched" on the dashboard (`formatHours(totalWatchedSeconds)`) is therefore wrong. | CONFIRMED (runtime + code) — one `savePosition(lesson, 123.5)` with no playback produced `totalWatchedSeconds: 123.5`; `grep addWatchedTime` → declaration only. | Either accumulate real playback time via `addWatchedTime` on a play-time ticker, or rename the metric to "progress reached" and stop presenting it as hours watched. | S |
| M5 | Player | nothing writes `lessons.duration`; `src/pages/CourseDetail/CourseDetail.tsx:280`; `src/pages/Player/Player.tsx:241-247` | `duration` is in the schema and in the types, the player receives it in `onLoadedMetadata`, and `CourseDetail` has UI for it — but it is never persisted, so it is always `null`: lesson durations never display, course length is unknown, and the resume heuristic falls back to its `dur === 0` branch (`Player.tsx:110`) which can prompt to resume a lesson that is effectively finished. | CONFIRMED (runtime) — all five imported lessons returned `duration: null`; `grep "duration ="` → no writes. | Persist the duration from `onLoadedMetadata` via a small IPC call (one write per lesson, first play). | S |
| M6 | Settings | `electron/ipc/settings.ts:18-47` | `settings:set` validates the *values* of known keys but accepts **any key** with any JSON value, and `getAllSettings` merges everything into the returned `AppSettings`. A buggy or hostile renderer can grow the table without bound and inject arbitrary keys into the settings object. | CONFIRMED (runtime) — `settings.set('totallyMadeUpKey', {a:1})` succeeded and `settings.getAll()` returned it alongside the real settings. | Whitelist keys against `DEFAULT_SETTINGS` and reject unknown ones. | S |
| M7 | UX / safety | `src/components/NotesPanel/NotesPanel.tsx:80-87,187-194`; `src/pages/Notes/NotesPage.tsx:86-90,200-209`; `src/components/Quiz/QuizManager.tsx:178-187`; `src/pages/Review/ReviewPage.tsx:249-260,268-277` | Deleting a note, a quiz (which cascades its entire attempt history), a flashcard deck (cards + SM-2 state) or a card happens **immediately on one click, with no confirmation and no undo**. Course removal and exam-source removal do confirm — the pattern exists, it is just not applied. | CONFIRMED (code) — each handler calls the destructive IPC straight from `onClick`. | Reuse the existing `Modal` confirm pattern for every destructive action. | S |
| M8 | Notes | `src/pages/Notes/NotesPage.tsx:67-84` | "New note" on the Notes page silently attaches the note to `courses[0]` — whichever course happens to sort first (most-recently-opened). The user is never told, and there is no way to change a note's course. | CONFIRMED (code) — `api().courses.list().then(courses => … courseId: courses[0].id)`. | Ask which course (or allow course-less notes by relaxing the `NOT NULL` FK). | S |
| M9 | Notes | `src/components/NotesPanel/NotesPanel.tsx:42-56`; `src/pages/Notes/NotesPage.tsx:23,41-42,53-54` | Autosave is a 600 ms (panel) / 500 ms (page) debounce with no flush on unmount, on modal close, or on `beforeunload` — closing the app right after typing loses the last keystrokes. On the Notes page a **single `saveTimer` ref is shared between the search debounce and the note autosave**, so the two cancel each other. | CONFIRMED (code). | Separate the refs; flush pending saves in an unmount cleanup and on the existing `ismalearn:window-closing` event. | S |
| M10 | Scanner | `electron/services/courseScanner.ts:192` + `electron/services/courseImportService.ts:157-163` | Section titles come from the folder **basename** only, so sibling trees with the same leaf name ("Resources", "01", "Videos") produce multiple identically-titled sections. Rescan then matches sections by case-insensitive title and lesson identity by `"${sectionTitle}::${lessonTitle}"`, so content from one folder can be merged into or re-linked to another. | CONFIRMED (code). | Key sections by their path relative to the course root (store it), and match on that during rescan. | M |
| M11 | Exams | `electron/services/practiceLibraryService.ts:181-183,231` | If the HTML file changes between load and submit, `submitExamAttempt` throws `Answer count does not match the exam` and the finished attempt is discarded. Likewise `buildDetail` returns `null` when the stored selection count no longer matches, so historical attempts silently become unviewable ("Review" does nothing) after the file is edited/re-downloaded. | CONFIRMED (code). | Store the question count (and ideally a content hash) with the attempt; on mismatch show a clear "this exam file changed" state instead of failing or returning `null`. | M |
| M12 | Error handling | `src/components/Quiz/QuizTaker.tsx:90-99` | If the submit path resolves `null` (exactly the `buildDetail` case above), `setResult(null)` leaves `submitting` stuck `true`: the button reads "Submitting…" forever with no error and no way back except Exit, losing the attempt. | CONFIRMED (code). | Treat `null` as a failure: `setSubmitting(false); setSubmitError(true)`. | S |
| M13 | Main-process I/O | `electron/services/logger.ts:23-50`; `electron/main.ts:114-116` | Every renderer console message is forwarded to `log()`, which does a **synchronous `statSync` + `appendFileSync` on the main thread per message**. A noisy render loop (React warning spam, repeated CSP violations like H2) turns into synchronous disk I/O on the thread that also serves video streaming and all IPC. | CONFIRMED (code) — probe triggered 2 console errors from a single preview attempt; each became a sync write. | Buffer and flush asynchronously; cache the rotation check. | S |
| M14 | Fake feature | `src/pages/Settings/Settings.tsx:209-218`; `src/types/index.ts:294` | **"When a duplicate course is imported" (ask / skip / rescan) does nothing.** The value is stored and validated, but no code outside Settings ever reads it — the import flow always shows the duplicate dialog. | CONFIRMED (code) — `grep duplicateImportBehavior` → Settings UI, type, default, validation. No consumer. | Implement the branch in `handleImport`, or remove the setting. | S |
| M15 | Fake feature | `electron/services/updateService.ts:9`; `src/pages/Settings/Settings.tsx:378-406` | `UPDATE_REPO = ''` so `checkForUpdates` always returns `{status:'disabled'}` unless an env var is set; the "Check now" button can only ever say "Update checks are not configured for this build". The `checkForUpdates` **boolean setting is read by nobody**, and `electron-builder.yml` has no `publish` block, so there is no update channel at all. | CONFIRMED (code). | Either configure a release feed (and gate it on the setting) or remove the button, the setting and the service. | S |
| M16 | Fake feature | `src/pages/Notes/NotesPage.tsx:186-195` | Clicking a `[mm:ss](t=…)` timestamp in the Notes page navigates to the player but **drops the time** — `void seconds` with a comment claiming the player handles it, which it does not (`startAt` is never passed). The identical link inside the player's notes panel does work. | CONFIRMED (code). | Pass `startAt: seconds` in the `navigate` call — the route already supports it. | S |
| M17 | Consistency | `src/components/Quiz/QuizHistory.tsx:72`; `src/pages/PracticeExams/PracticeExams.tsx:217,363`; `src/pages/ExamStats/ExamStats.tsx:30,190`; `src/components/Quiz/ModePicker.tsx:42` | The configurable `examPassPercent` is honoured in `QuizReview` but **hardcoded to 70** in five other places, including the ModePicker's "70% to pass" label and the pass/fail colouring in history and analytics. | CONFIRMED (code). | Thread `settings.examPassPercent` through (it is already in context). | S |
| M18 | Performance | `src/pages/ExamStats/ExamStats.tsx:54-73`; `src/pages/PracticeExams/PracticeExams.tsx:36-48` | Opening analytics re-reads and re-parses the same HTML file once per attempt detail, sequentially (up to 11 full parses); the Practice Exams page re-parses **every** registered file on each mount. Measured cost is modest but it is all synchronous work on the main thread. | CONFIRMED (runtime) — real 65-question files parse in 6–16 ms each (0.2 MB); a 22-file library ≈ 220 ms per page mount, ≈ 110 ms per analytics open. | Cache parsed exams in the main process keyed by path + mtime. | S |
| M19 | Build | `package.json:44` | `"postinstall"` sits **outside** the `"scripts"` block, so it never runs. The README's promise that *"`npm install` installs deps and rebuilds better-sqlite3 for Electron"* is false; a fresh clone must know to run `npm run rebuild:electron`. | CONFIRMED (code) — top-level key after `devDependencies`. | Move it into `scripts`. | S |
| M20 | Performance | `src/pages/Player/Player.tsx:54-65,76-135` | Two separate effects each call `courses.get(courseId)` — the full course tree with every lesson and its progress — and the second re-runs on **every lesson switch** just to find one lesson's metadata. | CONFIRMED (runtime) — `courses.get` on a 1200-lesson course took 101 ms; that is paid twice on entry and once per lesson change, and `LessonSidebar` re-renders all 1200 rows unvirtualised. | Fetch the course once; add a `lessons:get` IPC for per-lesson metadata. | S |
| M21 | Data layer | `electron/database/repositories/study.ts:200` vs `:265-273`; `migrations.ts:199,226` | `due_at` columns mix two formats: rows created by SQL get `datetime('now')` (`"2026-10-11 17:13:30"`), rows written by the app get ISO-8601 (`"2026-10-12T17:13:30.054Z"`). They are compared as **strings** (`due_at <= ?`), and `' ' < 'T'`, so a same-day SQLite-format due date always sorts as "due" regardless of the hour. | CONFIRMED (runtime) — probe shows a new card at `"2026-10-11 17:13:30"` next to a review item at `"2026-10-12T17:13:30.054Z"` in sibling tables. | Pick ISO-8601 everywhere (write it in the inserts too) and add an index-friendly comparison. | S |

### Low

| ID | Area | File:Line | Problem | Evidence | Fix | Effort |
|---|---|---|---|---|---|---|
| L1 | Tooling | repo root | **No linter at all** — no ESLint config, no `lint` script, no `eslint` dependency — yet the source carries 6 `// eslint-disable-next-line` comments pretending otherwise. No CI either (`.github/` absent), so nothing enforces the type-check or tests that do exist. | CONFIRMED — `ls -a \| grep eslint` empty, `grep -c eslint package.json` → 0. | Add ESLint + `react-hooks` rules and a CI workflow running `typecheck`/`test`. | S |
| L2 | Hygiene | `scripts/.seed-bundle.cjs` (589 lines) | A generated esbuild bundle (output of `register-exam-source.mjs`) is **committed**; it escapes `.gitignore` only because it is a dotfile. It duplicates main-process logic and will silently rot. | CONFIRMED — `git ls-files scripts` lists it. | Write it to a temp dir; gitignore the pattern. | S |
| L3 | Hygiene / licensing | `data/practice_exams/**` (22 files, 6.0 MB) | 22 downloaded third-party Udemy practice-test HTML files are committed to the repository. They are user data at best and someone else's copyrighted content at worst; they also bloat the clone. | CONFIRMED — `git ls-files data \| wc -l` → 22. | Remove from version control, keep them outside the repo and register the folder at runtime. | S |
| L4 | Security (defence in depth) | `electron/services/fileService.ts:42-47` | `resolveThumbnailFile` is the only resolver with **no containment check** — it serves whatever `thumbnail_path` says. Not exploitable today (the column is only written by the scanner/relocate), but it is the one hole in an otherwise consistent model. | CONFIRMED (code) — compare with `:33` and `:62`. | Apply the same check. | S |
| L5 | Security (defence in depth) | `electron/main.ts:106-111` | `setWindowOpenHandler` is set, but there is **no `will-navigate` guard**, so nothing prevents the top-level renderer from being navigated away from the app bundle. | CONFIRMED (code). | Add a `will-navigate` handler that `preventDefault()`s anything outside the app origin. | S |
| L6 | Data layer | `migrations.ts:106-113,213-220,168-177` | Missing indexes on FK columns used for joins/filters: `quiz_attempt_answers.question_id`, `flashcards.deck_id`, `resources.file_path`. Also `resources`/`lessons` have no uniqueness on `file_path`, and `findLessonByPath`/`findResourceByPath` query globally rather than per course — so the same file registered in two courses resolves ambiguously. | CONFIRMED (code). | Add the indexes; scope the path lookups by course. | S |
| L7 | Robustness | `migrations.ts:20-118,255-268` | Migration 1 uses bare `CREATE TABLE` (no `IF NOT EXISTS`), so a database with tables but an empty/corrupt `schema_migrations` can never start, and any migration failure propagates out of `getDb()` at `main.ts:147` with no recovery UI (see H6). | CONFIRMED (code). | Guard migration application and add a corrupt-DB recovery path. | M |
| L8 | Performance | `electron/database/repositories/resources.ts:22-28` | `toResource` does a synchronous `fs.statSync` **per row** on the main thread, so listing resources is O(files) blocking syscalls. | CONFIRMED (code). | Compute sizes lazily, or batch/cache them. | S |
| L9 | Tests | `scripts/test-e2e.mjs:39-47` | The e2e runner retries each script once and only reports failure if both attempts fail — flakiness is designed in rather than fixed. The first run in this audit failed with `Execution context was destroyed` and passed on retry. | CONFIRMED (runtime) — quoted output in §1 method. | Wait for a stable target instead of retrying blind. | S |
| L10 | Renderer | `src/App.tsx:63-71` + `src/main.tsx:7` | `updateSettings` fires IPC writes **inside a `setState` updater**, which React 18 StrictMode double-invokes in dev → duplicate writes. Failures are swallowed (`void … .catch`), so a rejected `settings:set` leaves the UI showing a value that is not persisted. | CONFIRMED (code). | Move the IPC call out of the updater and surface errors. | S |
| L11 | Dead code | `progress.ts:15` (`addWatchedTime`), `quizzes.ts:86` (`getQuizByLessonId`), `quizzes.ts:129` (`updateQuestion`), `resources.ts:81,87` (`findResourceByPath`, `updateResourceFilePath`), `validate.ts:50` (`requirePath` — used only by tests, so the null-byte check it provides is **not** applied on any real IPC path) | Unused exports kept alive by the fact that nothing lints for them; `requirePath`'s absence from production code also means `courses:importPath`/`practice:load` accept paths with embedded NULs (`requireString` does not check). | CONFIRMED — grep results in §Low evidence. | Delete or wire up; use `requirePath` for every path-shaped IPC argument. | S |
| L12 | Repo state | working tree | 26 files are modified and uncommitted (a cosmetic design pass over `global.css` + every CSS module, plus `win.maximize()` in `main.ts`). Any fix work starts on top of unreviewed changes. | CONFIRMED — `git diff --stat` → 766 insertions / 609 deletions. | Commit or stash before starting. | S |

---

## 4. Fake or incomplete features

Things the UI offers that do not do what they appear to do:

1. **Subtitles / CC menu** — fully built (discovery, SRT→VTT conversion, `<track>` rendering, CC
   menu) and **completely unreachable**: the prop that enables it is never passed, and the URL it
   would use returns 400. (H1)
2. **Text / Markdown / subtitle resource preview** — always falls into its error branch, blocked by
   the app's own CSP. PDF and image previews do work. (H2)
3. **"When a duplicate course is imported" setting** — stored, validated, never read. (M14)
4. **Update checker** — hardwired to `disabled`; no publish feed exists; the `checkForUpdates`
   boolean setting has no consumer. (M15)
5. **Notes-page timestamp links** — navigate to the lesson but never seek, with a comment claiming
   otherwise. (M16)
6. **"Locate file" recovery** — for the only case that matters (file moved out of the course folder)
   it corrupts the row and then silently does nothing. (H3)
7. **Lesson durations** — schema column, type field, player callback and UI all present; nothing
   ever writes the value, so no duration is ever shown. (M5)
8. **"Hours watched" stats** — presented as watch time, actually "furthest position reached"; the
   real accumulator (`addWatchedTime`) is dead code. (M4)
9. **Shuffle** — the checkbox works, the resulting score does not. (C3)
10. **In-app practice-test viewer** — honestly sandboxed (`sandbox=""`, so the exam's scripts never
    run) but that means it renders as a dead, non-interactive page; the real experience requires the
    separate Practice Exams flow or "Open in browser". Documented in the code, not in the UI.
11. **`ValidationError` re-exports** (`ipc/courses.ts:109`, `ipc/quizzes.ts:154`,
    `ipc/settings.ts:58`) — look like an error-mapping layer, are just unused re-exports; IPC
    rejections reach the renderer as raw `Error invoking remote method '…': ValidationError: …`
    strings, which is what the user sees in dialogs.

---

## 5. What works well (do not break this)

- **The security model is real and consistent.** `contextIsolation: true`, `sandbox: true`,
  `nodeIntegration: false`, a narrow typed `contextBridge` surface, no `dangerouslySetInnerHTML`
  anywhere, a hand-rolled Markdown renderer that builds React nodes instead of HTML, `sandbox=""`
  on the untrusted-HTML iframe, `shell.openExternal` gated to `https:`, and the opaque `media://`
  indirection with per-request course-root containment checks (lessons and resources). **No secrets,
  keys or tokens in the repo; no telemetry, analytics or network calls of any kind** except the
  (disabled) GitHub release check. The "local-first, no accounts" claim holds.
- **IPC input validation** (`electron/services/validate.ts` + per-handler use) is applied uniformly:
  every id, string, enum and numeric setting is checked before it reaches SQL. Confirmed at runtime —
  `settings.set('defaultPlaybackSpeed', 3)` was rejected with a clear message.
- **SQL is parameterised everywhere.** The only identifier interpolation is the backup importer's
  table/column names (H6); there is no user-data string concatenation into SQL anywhere.
- **The folder scanner is genuinely good.** Natural sort works (`1 - alpha`, `2 - beta`,
  `10 - tenth` in that order), nested folders become sections, resource-only subfolders attach to
  their nearest lesson-bearing ancestor, non-media files are ignored, hidden files are skipped,
  unicode/`%`/`#`/apostrophes in filenames survive the whole path to playback, and original files
  are never moved or modified. Verified at runtime.
- **The practice-exam parser is the strongest module in the codebase.** Brace-matching extraction
  with string awareness, per-question isolation so a truncated download still yields every intact
  question, control-character tolerance, letter→index mapping, multi-select handling. On the six
  real CLF-C02 files it extracted **390/390 questions with 0 skipped at 6–16 ms per file**.
- **Range-request streaming** (`fileService.ts:156-200`) is implemented properly — correct 206,
  `Content-Range`, suffix ranges, 416 — which is why seeking works. The project's own e2e proves
  `loadedmetadata` + seek through `media://`.
- **Migrations** are versioned, transactional and idempotent, and the DB lives in `userData` so it
  survives updates. Automatic timestamped backups with WAL checkpoint + pruning run on startup.
- **Performance is better than it looks.** Importing a 1200-lecture course took **91 ms**;
  `courses.get` on it 101 ms; a practice-library scan 146 ms. The build is clean (`tsc --noEmit`
  passes with `strict` + no-unused; `vite build` and the esbuild main bundle emit zero warnings; no
  `any`, no `@ts-ignore`, no `@ts-expect-error` in the entire codebase).
- **96 unit tests pass** and they cover the right things (migrations, import/rescan, containment
  refusal, progress, notes, quiz scoring, resources, relocation, backup round-trip, cross-course
  rescan isolation). The two CDP e2e scripts are a genuinely useful harness — my own probes reused
  their approach.
- **Error/empty/loading states exist nearly everywhere** (`LoadError` with retry, skeleton cards,
  per-section empty states), the `Modal` traps focus and restores it, `:focus-visible` outlines are
  global, `prefers-reduced-motion` is honoured, light and dark themes both have adequate contrast,
  and interactive controls carry `aria-label`/`aria-pressed`/`role` attributes.

---

## 6. Recommended fix order

Each step is independently testable; later steps assume earlier ones.

**Phase 0 — stop the bleeding (data loss first)**
1. **C1** — remove the delete-on-rescan behaviour (mark missing instead). Regression test: note +
   bookmark + progress survive a rescan with the file absent. *This is the only bug that destroys
   data the user cannot recreate — do it before anything else.*
2. **H4** — stop wiping attempt answers when a quiz is edited (diff, don't replace).
3. **H3** — validate the located path before writing it; handle the rejection in both call sites.
4. **H6** — exclude `schema_migrations` from backup/restore + add a startup DB-failure recovery path.
5. **L12** — commit or stash the 26 pending CSS changes so the above lands on a clean tree.

**Phase 1 — core flows users hit every session**
6. **C2** — kill the remount: drop `refreshKey` from the `<main>` key, remove `refreshAll()` from
   `handleTimeUpdate`. Verify with the 90% probe (video element identity must survive).
7. **C3** + **H7** — make exam/quiz submission identity-based and score against the question set,
   not the payload. Add a shuffled-run test expecting 100%.
8. **M1** — anchor the exam timer to wall-clock.
9. **M12** — unstick the "Submitting…" state.

**Phase 2 — finish or delete the fakes**
10. **H2** (one CSP line) and **H1** (one prop + moving three lines in the protocol handler) — both
    tiny, both restore an advertised feature.
11. **M5** → then **M4** (duration must exist before watch-time maths is meaningful).
12. **M14, M15, M16, M17** — implement or remove; no half-wired settings.

**Phase 3 — correctness and consistency**
13. **M2** + **M21** — one timestamp format, one parser.
14. **M3** (path normalisation) → **M10** (path-keyed sections) → re-run the rescan tests; these two
    share the same root cause and should land together.
15. **M6, M7, M8, M9, M11** — validation, confirmations, note ownership, autosave flush.

**Phase 4 — platform and hygiene**
16. **H5** — Electron upgrade (≥41.10.6) + `corsEnabled` on `media://`; re-run `electron-rebuild`,
    the full test suite and the packaged smoke test afterwards.
17. **L1** — ESLint + CI gate (`typecheck`, `test`, `test:e2e`) so nothing on this list regresses.
18. **M13, M18, M20, L6, L8** — main-thread I/O, caching, indexes.
19. **L2, L3, L4, L5, L7, L9, L10, L11** — cleanup, defence in depth, dead code.

---

## 7. Questions for you

1. **Rescan semantics (blocks C1).** When a lesson file disappears, do you want it (a) hidden but
   kept forever with its notes/progress, (b) kept with a "missing" badge and a manual "forget this
   lesson" action, or (c) auto-removed after N days? I recommend (b).
2. **Are there existing databases in the wild** (your own `%APPDATA%/IsmaLearn/ismalearn.db`, or
   anyone else's) whose data must be preserved? That decides whether C1/H4/M3 fixes need repair
   migrations (e.g. re-attaching orphaned notes) or just forward-looking behaviour changes.
3. **Electron upgrade now or later?** It is the single biggest security win but it touches the
   native module ABI and the packaging path, and `signAndEditExecutable: false` suggests the build
   environment is already constrained. Do you have admin/Developer Mode available on the build
   machine now?
4. **Watch time: real or positional?** Implementing true watch time (M4) means a playback ticker and
   a new write path. If "furthest point reached" is good enough, I will relabel the UI instead — much
   cheaper.
5. **Shuffle: keep it?** Fixing C3 properly means changing the `practice:submit` payload shape. If
   shuffle is not important to you, removing the checkbox is a one-line fix and closes the bug now.
6. **Login / usage tracking** from the brief: there is **no trace** of auth, session tracking, event
   queueing or sync in this codebase — not even a stub. Should I treat that as greenfield work to be
   planned separately, and should it stay opt-in given the app's current "no accounts, no cloud,
   no telemetry" promise in the README?
7. **`data/practice_exams/`** — may I remove those 22 HTML files from version control (L3), or are
   they intentionally bundled for distribution?

---

*Stopping here as instructed — no fixes applied. The two probe scripts used for the runtime evidence
are in this session's scratchpad and can be re-run against any build for regression checking.*
