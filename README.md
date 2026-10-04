# IsmaLearn

**Your courses. Your pace. Your progress.**

IsmaLearn is a local-first desktop learning platform for organizing and studying
downloaded video courses — no internet connection, no accounts, no cloud.
Import a course folder from your computer and get sections, lessons, progress
tracking, notes with video timestamps, and self-made quizzes.

![platform](https://img.shields.io/badge/platform-Windows-blue)
![stack](https://img.shields.io/badge/stack-Electron%20%C2%B7%20React%20%C2%B7%20SQLite-violet)

## Features

- **Local course importer** — pick any folder; subfolders become sections,
  videos become lessons (natural numeric sorting). PDF/TXT/MD/subtitle/image
  resources attach to their section. Original files are never moved or modified.
- **Video player** — custom controls, 0.5x–2x speeds, fullscreen, prev/next
  lesson, per-lesson resume positions, 90%-watched auto-complete, missing-file
  recovery with a "locate file" dialog.
- **Progress tracking** — dashboard stats, continue-learning, recently opened,
  per-course progress bars, all persisted in SQLite.
- **Notes** — per-course/per-lesson notes with autosave, Markdown preview,
  clickable video timestamps, and global search.
- **Quizzes** — create multiple-choice quizzes per course, take them, review
  answers with explanations, and keep a full attempt history.
- **Settings** — dark/light theme, default playback speed, resume preference,
  duplicate-import behavior, and storage info.

## Tech stack

| Layer    | Technology                                                              |
| -------- | ----------------------------------------------------------------------- |
| Runtime  | Electron 33 (context isolation, sandbox, preload-only bridge)           |
| UI       | React 18 + TypeScript (strict) + Vite 5 + CSS Modules + Lucide icons    |
| Database | SQLite via better-sqlite3, WAL mode, migrations in `schema_migrations` |
| Media    | HTML5 video served through a `media://` custom protocol (no raw paths)  |
| Tests    | Vitest (34 tests: scanner, sorting, DB, progress, quizzes, notes)      |

## Getting started

Prerequisites: **Node.js 20+** and npm. Windows build tools are needed once to
compile the native SQLite module (`npm install` pulls what it needs via
prebuilt tooling where possible; otherwise install the VS Build Tools).

```bash
npm install     # installs deps and rebuilds better-sqlite3 for Electron
npm run dev     # starts Vite + Electron with hot reload
```

Useful commands:

```bash
npm run typecheck   # strict TypeScript check (tsc --noEmit)
npm test            # run the Vitest suite
npm run build       # production build → dist/ + dist-electron/
npm run dist        # package a Windows NSIS installer → release/
npm run icon        # regenerate assets/icon.png, build/icon.ico, assets/icon.svg
```

> **Native module note:** `better-sqlite3` needs Electron's ABI to run the app
> but plain Node's ABI for Vitest. You never have to think about this: `npm test`
> rebuilds for Node when needed, and `npm run dev` / `npm run build` / `npm run
> dist` rebuild for Electron when needed (`scripts/ensure-abi.mjs` tracks a
> stamp file and skips redundant rebuilds). Manual overrides:
> `npm run rebuild:node`, `npm run rebuild:electron`. Close the app first —
> Windows locks the binary while Electron runs.

## How it works

```
electron/
  main.ts            # window, media:// protocol, IPC registration
  preload.ts         # narrow typed contextBridge API (no fs access)
  database/
    connection.ts    # userData/ismalearn.db singleton (survives updates)
    migrations.ts    # versioned schema migrations
    repositories/    # courses, progress, notes, quizzes, settings
  ipc/               # one validated handler module per domain
  services/
    courseScanner.ts # recursive folder scan → sections/lessons/resources
    courseImportService.ts  # import + duplicate detection + rescan merge
    fileService.ts   # containment-checked media resolution
    naturalSort.ts   # human-aware filename sorting
    validate.ts      # IPC input validation
src/
  components/        # Sidebar, Topbar, CourseCard, VideoPlayer, LessonSidebar, NotesPanel, Quiz/*
  pages/             # Dashboard, Library, CourseDetail, Player, Notes, Settings
  types/             # shared domain types (imported by main + renderer)
tests/               # vitest suite for critical business logic
```

**Security model:** the renderer has no Node access and never sees filesystem
paths. Videos/thumbnails stream through opaque `media://lesson/<id>` URLs that
the main process resolves with a containment check (files must live inside the
registered course folder). All IPC input is validated in the main process.

**Database:** SQLite lives at `%APPDATA%/IsmaLearn/ismalearn.db` (Windows) so
updates never wipe learning data. Courses store *references* to your files, not
copies — deleting the app database never deletes your videos.

## Importing courses

1. Click **Import Course** (top bar, dashboard, or library).
2. Select the folder containing the course.
3. Subfolders → sections, videos → lessons, sorted naturally
   (`02 - EC2` before `10 - VPC`).
4. Use **Rescan** anytime to pick up newly added files — existing progress,
   notes, and quizzes are preserved.

Supported video: MP4, WebM, MKV (where Chromium can decode it).
Supported practice tests: HTML/HTM (e.g. downloaded Udemy practice exams).
Register a folder (or single file) under **Practice Exams** in the sidebar —
tests are parsed live straight from your files (nothing is imported, moved, or
copied) and grouped by certification (SAA-C03, DVA-C02, …).

**Two exam modes.** Every exam offers a mode picker: **Practice mode** checks
each answer instantly with explanations (untimed), while **Exam mode** runs
under real AWS pacing (2 minutes per question — 130 minutes for a 65-question
exam), hiding answers until submit, with a question navigator, flag-for-review,
and automatic submission when time runs out. Passing is 70%.

Attempt history (scores, dates, full answer review) is stored per file, so
re-taking the same test tracks your progress over time. Removing a source
deletes its history but never touches your files.
Supported resources: PDF, TXT, MD, VTT/SRT, PNG/JPG/GIF/WebP/SVG.

## License

MIT
