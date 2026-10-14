<img width="1983" height="793" alt="IGLAcademy Coral Teal Logo" src="https://github.com/user-attachments/assets/0c84b756-fe2a-45b4-819e-04e3527e8d1c" />

# IGLAcademy

**Your courses. Your pace. Your progress.**

A local-first desktop app for studying downloaded video courses — no account,
no cloud, no internet required. Point it at a course folder and get sections,
lessons, progress tracking, notes, quizzes, and practice exams.

![platform](https://img.shields.io/badge/platform-Windows-blue)
![stack](https://img.shields.io/badge/stack-Electron%20%C2%B7%20React%20%C2%B7%20SQLite-violet)

## Features

- **Course import** — subfolders become sections, videos become lessons (sorted
  naturally). PDFs, Markdown, text, subtitles, and images attach as resources.
  Your files are never moved or modified.
- **Video player** — speed control, resume, auto-complete, subtitles,
  picture-in-picture, A–B looping, bookmarks, and keyboard shortcuts (press `?`).
- **Notes** — per-lesson Markdown notes with clickable video timestamps.
- **Quizzes & flashcards** — course quizzes plus spaced-repetition review.
- **Practice exams** — HTML practice tests run in Practice or timed Exam mode,
  with score history and weak-topic analysis.
- **Backups & updates** — JSON export/import, automatic database backups, and
  in-app updates from GitHub Releases.

## Getting started

Requires **Node.js 22+** on Windows.

```bash
npm install     # install dependencies
npm run dev     # run the app with hot reload
```

Other commands:

```bash
npm test            # unit tests
npm run test:e2e    # end-to-end tests (run `npm run build` first)
npm run typecheck   # TypeScript check
npm run lint        # ESLint
npm run installer   # build the Windows installer into release/
```

## Data

Everything is stored locally in SQLite at `%APPDATA%/IsmaLearn/ismalearn.db`
(the folder keeps its original name so existing data survives the rename).
Courses store references to your files, not copies.

## Releasing

Bump the version, then push a matching tag. The workflow in
`.github/workflows/release.yml` builds, tests, and publishes the installer to
GitHub Releases, and installed copies update automatically.

```bash
npm version 1.1.0 --no-git-tag-version
git commit -am "chore: release 1.1.0"
git tag v1.1.0
git push origin main v1.1.0
```

To sign releases, add `WIN_CSC_LINK` (base64 .pfx) and `WIN_CSC_KEY_PASSWORD`
as repository secrets.

## License

MIT
