import type Database from 'better-sqlite3';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE courses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        source_path TEXT NOT NULL UNIQUE,
        thumbnail_path TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_opened_at TEXT
      );

      CREATE TABLE sections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_sections_course ON sections(course_id, position);

      CREATE TABLE lessons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_type TEXT NOT NULL DEFAULT 'video',
        duration REAL,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_lessons_section ON lessons(section_id, position);

      CREATE TABLE lesson_progress (
        lesson_id INTEGER PRIMARY KEY REFERENCES lessons(id) ON DELETE CASCADE,
        completed INTEGER NOT NULL DEFAULT 0,
        completed_at TEXT,
        position_seconds REAL NOT NULL DEFAULT 0,
        watched_seconds REAL NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_progress_updated ON lesson_progress(updated_at);

      CREATE TABLE notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        lesson_id INTEGER REFERENCES lessons(id) ON DELETE CASCADE,
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_notes_course ON notes(course_id, updated_at);
      CREATE INDEX idx_notes_lesson ON notes(lesson_id);

      CREATE TABLE quizzes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        section_id INTEGER REFERENCES sections(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_quizzes_course ON quizzes(course_id);

      CREATE TABLE quiz_questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
        question TEXT NOT NULL,
        options TEXT NOT NULL,
        correct_index INTEGER NOT NULL,
        explanation TEXT NOT NULL DEFAULT '',
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_questions_quiz ON quiz_questions(quiz_id, position);

      CREATE TABLE quiz_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
        score INTEGER NOT NULL,
        total INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_attempts_quiz ON quiz_attempts(quiz_id, created_at);

      CREATE TABLE quiz_attempt_answers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        attempt_id INTEGER NOT NULL REFERENCES quiz_attempts(id) ON DELETE CASCADE,
        question_id INTEGER NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
        selected_index INTEGER NOT NULL,
        is_correct INTEGER NOT NULL
      );
      CREATE INDEX idx_answers_attempt ON quiz_attempt_answers(attempt_id);

      CREATE TABLE app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    name: 'quiz_multi_answer_and_practice_source',
    sql: `
      -- Multiple correct answers per question (practice exams). Legacy rows
      -- keep '[]' and fall back to the single correct_index value.
      ALTER TABLE quiz_questions ADD COLUMN correct_indices TEXT NOT NULL DEFAULT '[]';
      -- Selected option sets per attempt answer (single-choice rows reuse
      -- selected_index; multi-select rows store the full set here).
      ALTER TABLE quiz_attempt_answers ADD COLUMN selected_indices TEXT NOT NULL DEFAULT '[]';
      -- Links an imported practice exam back to its source HTML lesson.
      ALTER TABLE quizzes ADD COLUMN source_lesson_id INTEGER REFERENCES lessons(id) ON DELETE CASCADE;
      CREATE INDEX idx_quizzes_source_lesson ON quizzes(source_lesson_id);
    `,
  },
  {
    version: 3,
    name: 'practice_exam_library',
    sql: `
      -- Folders (or individual files) registered as practice-exam sources.
      -- Exams are parsed live from these files; nothing is imported or copied.
      CREATE TABLE exam_sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL DEFAULT 'dir',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Attempts keyed by file path. Selections are stored aligned by
      -- question position; question content is re-parsed from the file.
      CREATE TABLE practice_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_path TEXT NOT NULL,
        score INTEGER NOT NULL,
        total INTEGER NOT NULL,
        selections TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_practice_attempts_path ON practice_attempts(source_path, created_at);
    `,
  },
  {
    version: 4,
    name: 'resources_retention_analytics',
    sql: `
      -- Course resources (pdf, text, markdown, subtitles, images) persisted
      -- per section so they can be previewed, searched and opened.
      CREATE TABLE resources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        file_path TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'other',
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_resources_section ON resources(section_id, position);

      -- Timestamped bookmarks on lessons.
      CREATE TABLE bookmarks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        lesson_id INTEGER REFERENCES lessons(id) ON DELETE CASCADE,
        position_seconds REAL NOT NULL DEFAULT 0,
        title TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_bookmarks_course ON bookmarks(course_id, created_at);

      -- "Review later" queue entries (lessons, notes, quizzes, exams).
      -- course_id is null for file-based exams, which belong to no course.
      CREATE TABLE review_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        ref_id TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        due_at TEXT NOT NULL DEFAULT (datetime('now')),
        done INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_review_items_due ON review_items(done, due_at);

      -- Flashcards (manual, from notes, or from quiz questions).
      CREATE TABLE flashcard_decks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE flashcards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        deck_id INTEGER NOT NULL REFERENCES flashcard_decks(id) ON DELETE CASCADE,
        front TEXT NOT NULL,
        back TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE flashcard_state (
        card_id INTEGER PRIMARY KEY REFERENCES flashcards(id) ON DELETE CASCADE,
        ease REAL NOT NULL DEFAULT 2.5,
        interval_days REAL NOT NULL DEFAULT 0,
        reps INTEGER NOT NULL DEFAULT 0,
        due_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_flashcard_state_due ON flashcard_state(due_at);

      -- Per-question timing and flagged questions for exam analytics.
      ALTER TABLE practice_attempts ADD COLUMN durations TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE practice_attempts ADD COLUMN flags TEXT NOT NULL DEFAULT '[]';
    `,
  },
  {
    version: 5,
    name: 'missing_lessons_and_attempt_snapshots',
    sql: `
      -- A lesson whose file is not on disk is FLAGGED, never deleted: deleting
      -- it would cascade away the user's notes, bookmarks and progress (an
      -- unplugged drive or a renamed folder used to be enough). NULL = present.
      ALTER TABLE lessons ADD COLUMN missing_since TEXT;
      CREATE INDEX idx_lessons_missing ON lessons(missing_since);

      -- Attempt answers keep their own copy of the question they were given,
      -- so editing a quiz question can never rewrite history. NULL on legacy
      -- rows, which fall back to the live question.
      --
      -- The question_id foreign key is also dropped (table rebuild): it was
      -- ON DELETE CASCADE, so removing a question erased the answer rows of
      -- every past attempt that contained it. The snapshot is authoritative
      -- now, and question_id is kept purely as a soft reference.
      CREATE TABLE quiz_attempt_answers_v5 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        attempt_id INTEGER NOT NULL REFERENCES quiz_attempts(id) ON DELETE CASCADE,
        question_id INTEGER NOT NULL,
        selected_index INTEGER NOT NULL,
        is_correct INTEGER NOT NULL,
        selected_indices TEXT NOT NULL DEFAULT '[]',
        question_text TEXT,
        options_snapshot TEXT,
        correct_snapshot TEXT,
        explanation_snapshot TEXT,
        position_snapshot INTEGER
      );
      INSERT INTO quiz_attempt_answers_v5
        (id, attempt_id, question_id, selected_index, is_correct, selected_indices)
        SELECT id, attempt_id, question_id, selected_index, is_correct, selected_indices
        FROM quiz_attempt_answers;
      DROP TABLE quiz_attempt_answers;
      ALTER TABLE quiz_attempt_answers_v5 RENAME TO quiz_attempt_answers;
      CREATE INDEX idx_answers_attempt ON quiz_attempt_answers(attempt_id);
      CREATE INDEX idx_answers_question ON quiz_attempt_answers(question_id);
    `,
  },
];

export function runMigrations(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    (
      database
        .prepare('SELECT version FROM schema_migrations')
        .all() as Array<{ version: number }>
    ).map((row) => row.version),
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    database.exec('BEGIN');
    try {
      database.exec(migration.sql);
      database.prepare(
        'INSERT INTO schema_migrations (version, name) VALUES (?, ?)',
      ).run(migration.version, migration.name);
      database.exec('COMMIT');
    } catch (err) {
      database.exec('ROLLBACK');
      throw err;
    }
  }
}
