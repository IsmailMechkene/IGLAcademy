var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// electron/database/connection.ts
var import_node_fs = __toESM(require("node:fs"));
var import_node_path = __toESM(require("node:path"));
var import_better_sqlite3 = __toESM(require("better-sqlite3"));
var import_electron = require("electron");

// electron/database/migrations.ts
var MIGRATIONS = [
  {
    version: 1,
    name: "initial_schema",
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
    `
  },
  {
    version: 2,
    name: "quiz_multi_answer_and_practice_source",
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
    `
  },
  {
    version: 3,
    name: "practice_exam_library",
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
    `
  }
];
function runMigrations(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const applied = new Set(
    database.prepare("SELECT version FROM schema_migrations").all().map((row) => row.version)
  );
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    database.exec("BEGIN");
    try {
      database.exec(migration.sql);
      database.prepare(
        "INSERT INTO schema_migrations (version, name) VALUES (?, ?)"
      ).run(migration.version, migration.name);
      database.exec("COMMIT");
    } catch (err) {
      database.exec("ROLLBACK");
      throw err;
    }
  }
}

// electron/database/connection.ts
function createDatabase(dbPath2) {
  import_node_fs.default.mkdirSync(import_node_path.default.dirname(dbPath2), { recursive: true });
  const database = new import_better_sqlite3.default(dbPath2);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  runMigrations(database);
  return database;
}

// electron/services/practiceLibraryService.ts
var import_node_fs2 = __toESM(require("node:fs"));
var import_node_path3 = __toESM(require("node:path"));

// electron/database/repositories/practice.ts
function toSource(row) {
  return {
    id: row.id,
    path: row.path,
    kind: row.kind === "file" ? "file" : "dir",
    createdAt: row.created_at
  };
}
function listSources(db2) {
  return db2.prepare("SELECT * FROM exam_sources ORDER BY created_at").all().map(toSource);
}
function getSource(db2, id) {
  const row = db2.prepare("SELECT * FROM exam_sources WHERE id = ?").get(id);
  return row ? toSource(row) : null;
}
function findSourceByPath(db2, resolvedPath) {
  const row = db2.prepare("SELECT * FROM exam_sources WHERE path = ?").get(resolvedPath);
  return row ? toSource(row) : null;
}
function insertSource(db2, data) {
  const info = db2.prepare("INSERT INTO exam_sources (path, kind) VALUES (?, ?)").run(data.path, data.kind);
  return getSource(db2, Number(info.lastInsertRowid));
}
function getPracticeStats(db2, filePath) {
  const row = db2.prepare(
    `SELECT COUNT(*) AS n,
        MAX(CAST(score AS REAL) / NULLIF(total, 0)) AS best,
        MAX(created_at) AS last_at
       FROM practice_attempts WHERE source_path = ?`
  ).get(filePath);
  return {
    attemptCount: row.n,
    bestPercent: row.best === null ? null : Math.round(row.best * 100),
    lastAttemptAt: row.last_at
  };
}

// electron/services/courseScanner.ts
var import_node_path2 = __toESM(require("node:path"));

// electron/services/naturalSort.ts
var TOKEN_RE = /(\d+)|(\D+)/g;
function naturalCompare(a, b) {
  const aParts = a.match(TOKEN_RE) ?? [];
  const bParts = b.match(TOKEN_RE) ?? [];
  const len = Math.min(aParts.length, bParts.length);
  for (let i = 0; i < len; i++) {
    const ap = aParts[i];
    const bp = bParts[i];
    const aIsNum = /^\d+$/.test(ap);
    const bIsNum = /^\d+$/.test(bp);
    if (aIsNum && bIsNum) {
      const an = parseInt(ap, 10);
      const bn = parseInt(bp, 10);
      if (an !== bn) return an - bn;
      if (ap !== bp) return ap < bp ? -1 : 1;
    } else {
      const al = ap.toLowerCase();
      const bl = bp.toLowerCase();
      if (al !== bl) return al < bl ? -1 : 1;
    }
  }
  return aParts.length - bParts.length;
}
function naturalSort(items, key) {
  return [...items].sort((a, b) => naturalCompare(key(a), key(b)));
}

// electron/services/courseScanner.ts
var PRACTICE_EXTENSIONS = [".html", ".htm"];
function extOf(filePath) {
  return import_node_path2.default.extname(filePath).toLowerCase();
}
function isPracticeFile(filePath) {
  return PRACTICE_EXTENSIONS.includes(extOf(filePath));
}
function titleFromFileName(fileName) {
  const stem = import_node_path2.default.basename(fileName, import_node_path2.default.extname(fileName));
  return stem.replace(/[._]+/g, " ").replace(/\s+/g, " ").trim() || stem;
}

// electron/services/practiceExamParser.ts
function htmlToText(html) {
  return (html ?? "").replace(/<(br|p|li|tr|h[1-6]|pre|div|ul|ol)[^>]*>/gi, "\n").replace(/<\/(p|li|tr|h[1-6]|pre|div|ul|ol)>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").split("\n").map((line) => line.replace(/[ \t]+/g, " ").trim()).filter((line) => line.length > 0).join("\n");
}
function letterToIndex(letter, optionCount) {
  if (typeof letter !== "string" || letter.length !== 1) return null;
  const idx = letter.toLowerCase().charCodeAt(0) - 97;
  if (idx < 0 || idx >= optionCount) return null;
  return idx;
}
function extractQuestionBlobs(content) {
  const noData = { title: "", blobs: [], truncatedTail: false };
  if (typeof content !== "string" || content.length === 0) return noData;
  const marker = "const quizData =";
  const markerIdx = content.indexOf(marker);
  if (markerIdx < 0) return noData;
  const head = content.slice(markerIdx, markerIdx + 5e4);
  const titleMatch = /"quiz_title"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(head);
  const title = titleMatch ? titleMatch[1] : "";
  const arrIdx = content.indexOf('"questions"', markerIdx);
  if (arrIdx < 0) return { title, blobs: [], truncatedTail: false };
  const arrStart = content.indexOf("[", arrIdx);
  if (arrStart < 0) return { title, blobs: [], truncatedTail: false };
  const scriptEnd = content.indexOf("</script>", arrStart);
  const limit = scriptEnd > 0 ? scriptEnd : content.length;
  const matchElement = (from) => {
    let depth = 0;
    let inString2 = false;
    let escaped2 = false;
    for (let i2 = from; i2 < limit; i2++) {
      const ch = content[i2];
      if (inString2) {
        if (escaped2) escaped2 = false;
        else if (ch === "\\") escaped2 = true;
        else if (ch === '"') inString2 = false;
        continue;
      }
      if (ch === '"') inString2 = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return i2 + 1;
      }
    }
    return -1;
  };
  const blobs = [];
  let closedNormally = false;
  let i = arrStart + 1;
  let inString = false;
  let escaped = false;
  while (i < limit) {
    const c = content[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      i++;
      continue;
    }
    if (c === '"') {
      inString = true;
      i++;
      continue;
    }
    if (c === "[") {
      let depth = 1;
      i++;
      while (i < limit && depth > 0) {
        const d = content[i];
        if (inString) {
          if (escaped) escaped = false;
          else if (d === "\\") escaped = true;
          else if (d === '"') inString = false;
        } else if (d === '"') {
          inString = true;
        } else if (d === "[") {
          depth++;
        } else if (d === "]") {
          depth--;
        }
        i++;
      }
      continue;
    }
    if (c === "]") {
      closedNormally = true;
      break;
    }
    if (c === "{") {
      const end = matchElement(i);
      if (end < 0) break;
      blobs.push(content.slice(i, end));
      i = end;
      continue;
    }
    i++;
  }
  let truncatedTail = false;
  if (!closedNormally) {
    truncatedTail = content.slice(i, limit).includes("{");
  }
  return { title, blobs, truncatedTail };
}
function parseQuestionBlob(blob) {
  const raw = blob.replace(/[\x00-\x1F]/g, " ");
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}
function parsePracticeExamHtml(content) {
  const { title, blobs, truncatedTail } = extractQuestionBlobs(content);
  if (blobs.length === 0) return null;
  const questions = [];
  let skipped = truncatedTail ? 1 : 0;
  for (const blob of blobs) {
    const raw = parseQuestionBlob(blob);
    if (!raw) {
      skipped++;
      continue;
    }
    const type = raw.assessment_type;
    if (type !== "multiple-choice" && type !== "multi-select") {
      skipped++;
      continue;
    }
    const prompt = raw.prompt;
    if (!prompt || typeof prompt !== "object" || !Array.isArray(prompt.answers)) {
      skipped++;
      continue;
    }
    const options = prompt.answers.filter((a) => typeof a === "string").map((a) => htmlToText(a)).filter((a) => a.length > 0);
    if (options.length < 2 || !Array.isArray(raw.correct_response)) {
      skipped++;
      continue;
    }
    const correctIndices = [...new Set(
      raw.correct_response.map((letter) => letterToIndex(letter, options.length)).filter((i) => i !== null)
    )].sort((a, b) => a - b);
    if (correctIndices.length === 0) {
      skipped++;
      continue;
    }
    if (type === "multiple-choice" && correctIndices.length !== 1) {
      skipped++;
      continue;
    }
    const stemHtml = typeof prompt.question === "string" && prompt.question.trim() ? prompt.question : typeof raw.question_plain === "string" ? raw.question_plain : "";
    const question = htmlToText(stemHtml);
    if (!question) {
      skipped++;
      continue;
    }
    questions.push({
      question,
      options,
      correctIndices,
      explanation: typeof prompt.explanation === "string" ? htmlToText(prompt.explanation) : ""
    });
  }
  return { title: title.trim(), questions, skipped };
}

// electron/services/validate.ts
var ValidationError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
};

// electron/services/practiceLibraryService.ts
function resolveSourceTarget(targetPath, kind) {
  const resolved = import_node_path3.default.resolve(targetPath);
  if (!import_node_fs2.default.existsSync(resolved)) throw new ValidationError("Path not found.");
  const stat = import_node_fs2.default.statSync(resolved);
  if (kind === "file" && !stat.isFile()) throw new ValidationError("Expected a file.");
  if (kind === "dir" && !stat.isDirectory()) throw new ValidationError("Expected a folder.");
  if (kind === "file" && !isPracticeFile(resolved)) {
    throw new ValidationError("Only HTML practice-test files (.html) can be registered.");
  }
  return resolved;
}
function registerSource(db2, targetPath, kind) {
  const resolved = resolveSourceTarget(targetPath, kind);
  return findSourceByPath(db2, resolved) ?? insertSource(db2, { path: resolved, kind });
}
function filesOfSource(source) {
  if (source.kind === "file") return [source.path];
  const files = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = import_node_fs2.default.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = import_node_path3.default.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && isPracticeFile(entry.name)) files.push(full);
    }
  };
  walk(source.path);
  return naturalSort(files, (f) => f);
}
function scanLibrary(db2) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const source of listSources(db2)) {
    for (const file of filesOfSource(source)) {
      if (seen.has(file)) continue;
      seen.add(file);
      const stats = getPracticeStats(db2, file);
      try {
        const content = import_node_fs2.default.readFileSync(file, "utf8");
        const parsed = parsePracticeExamHtml(content);
        if (!parsed || parsed.questions.length === 0) {
          out.push({
            filePath: file,
            title: titleFromFileName(file),
            questionCount: 0,
            multiCount: 0,
            skipped: parsed?.skipped ?? 0,
            error: "No usable questions found in this file.",
            ...stats
          });
          continue;
        }
        out.push({
          filePath: file,
          title: parsed.title || titleFromFileName(file),
          questionCount: parsed.questions.length,
          multiCount: parsed.questions.filter((q) => q.correctIndices.length > 1).length,
          skipped: parsed.skipped,
          ...stats
        });
      } catch {
        out.push({
          filePath: file,
          title: titleFromFileName(file),
          questionCount: 0,
          multiCount: 0,
          skipped: 0,
          error: "Could not read this file.",
          ...stats
        });
      }
    }
  }
  return naturalSort(out, (f) => f.title);
}

// C:/Users/MSI/AppData/Local/Temp/ismalearn-seed-k6f11T/entry.js
var [dbPath, ...dirs] = JSON.parse(process.env.SEED_ARGS || "[]");
var db = createDatabase(dbPath);
try {
  for (const dir of dirs) {
    const source = registerSource(db, dir, "dir");
    console.log("registered source #" + source.id + ": " + source.path);
  }
  const files = scanLibrary(db);
  const groups = /* @__PURE__ */ new Map();
  for (const f of files) {
    const key = f.error ? "unreadable" : f.title.split(" - ")[0];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  console.log("sources:", listSources(db).length);
  console.log("files found:", files.length);
  for (const [key, list] of groups) {
    const qs = list.reduce((s, f) => s + f.questionCount, 0);
    console.log("  [" + key + "] " + list.length + " files, " + qs + " questions");
  }
} finally {
  db.close();
}
