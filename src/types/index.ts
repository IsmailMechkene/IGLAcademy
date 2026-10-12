// Shared domain types used by both the Electron main process and the renderer.

export interface Course {
  id: number;
  title: string;
  description: string;
  sourcePath: string;
  thumbnailPath: string | null;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
}

export interface Section {
  id: number;
  courseId: number;
  title: string;
  position: number;
}

export interface Lesson {
  id: number;
  sectionId: number;
  title: string;
  filePath: string;
  fileType: 'video' | 'practice' | 'resource';
  duration: number | null;
  position: number;
  /**
   * When set, the lesson's file was not on disk at the last rescan. The lesson
   * (and its notes, bookmarks and progress) is kept until the user forgets it
   * explicitly, so a moved folder or an unplugged drive loses nothing.
   */
  missingSince: string | null;
}

export interface LessonProgress {
  lessonId: number;
  completed: boolean;
  completedAt: string | null;
  positionSeconds: number;
  watchedSeconds: number;
  updatedAt: string;
}

export interface CourseWithProgress extends Course {
  sectionCount: number;
  lessonCount: number;
  completedCount: number;
  progressPercent: number;
  watchedSeconds: number;
}

export interface CourseDetail extends Course {
  sections: SectionWithLessons[];
  progressPercent: number;
  completedCount: number;
  lessonCount: number;
  watchedSeconds: number;
}

export interface SectionWithLessons extends Section {
  lessons: LessonWithProgress[];
}

export interface LessonWithProgress extends Lesson {
  completed: boolean;
  completedAt: string | null;
  positionSeconds: number;
  watchedSeconds: number;
}

export interface Note {
  id: number;
  courseId: number;
  lessonId: number | null;
  lessonTitle: string | null;
  courseTitle: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface QuizQuestion {
  id: number;
  quizId: number;
  question: string;
  options: string[];
  correctIndex: number;
  /** All correct option indices (length 1 for single-choice). */
  correctIndices: number[];
  explanation: string;
  position: number;
}

export interface Quiz {
  id: number;
  courseId: number;
  sectionId: number | null;
  sectionTitle: string | null;
  /** Lesson this quiz was imported from (practice exams), if any. */
  sourceLessonId: number | null;
  title: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  questionCount: number;
}

export interface QuizDetail extends Quiz {
  questions: QuizQuestion[];
}

/** A learning resource file attached to a course section. */
export type ResourceKind = 'pdf' | 'image' | 'text' | 'markdown' | 'subtitle' | 'other';

export interface CourseResource {
  id: number;
  sectionId: number;
  sectionTitle: string;
  title: string;
  filePath: string;
  kind: ResourceKind;
  position: number;
  sizeBytes: number;
}

export interface ResourceSearchHit {
  resourceId: number;
  title: string;
  kind: ResourceKind;
  snippet: string;
}

/** A timestamped bookmark on a lesson (or a whole course). */
export interface Bookmark {
  id: number;
  courseId: number;
  courseTitle: string;
  lessonId: number | null;
  lessonTitle: string | null;
  positionSeconds: number;
  title: string;
  note: string;
  createdAt: string;
}

/** A "review later" queue entry. refId holds a lesson/note/quiz id or a file path. */
export interface ReviewItem {
  id: number;
  courseId: number | null;
  courseTitle: string;
  kind: 'lesson' | 'note' | 'quiz' | 'exam';
  refId: string;
  title: string;
  dueAt: string;
  done: boolean;
  createdAt: string;
}

export interface FlashcardDeck {
  id: number;
  /** Null for decks not tied to a course (practice-exam mistakes). */
  courseId: number | null;
  /** The course title, or "Practice exams" for course-less decks. */
  courseTitle: string;
  title: string;
  source: string;
  cardCount: number;
  dueCount: number;
  createdAt: string;
}

export interface Flashcard {
  id: number;
  deckId: number;
  front: string;
  back: string;
  position: number;
  ease: number;
  intervalDays: number;
  reps: number;
  dueAt: string;
}

export type FlashGrade = 'again' | 'hard' | 'good' | 'easy';

export interface MissingLesson {
  lessonId: number;
  title: string;
  filePath: string;
}

export interface CourseHealth {
  courseId: number;
  totalLessons: number;
  missingLessons: MissingLesson[];
}

export interface RelocateResult {
  status: 'ok' | 'error';
  relocated: number;
  stillMissing: number;
  error?: string;
}

export interface BackupInfo {
  fileName: string;
  sizeBytes: number;
  createdAt: string;
}

/** A folder or file registered as a practice-exam source (parsed live, never imported). */
export interface ExamSource {
  id: number;
  path: string;
  kind: 'file' | 'dir';
  createdAt: string;
}

/** One practice test discovered by scanning an exam source. */
export interface PracticeExamFile {
  filePath: string;
  title: string;
  questionCount: number;
  multiCount: number;
  skipped: number;
  /** Unparseable files carry only filePath + error. */
  error?: string;
  attemptCount: number;
  bestPercent: number | null;
  lastAttemptAt: string | null;
}

/** Full parsed content of one practice test, for the exam runners. */
export interface PracticeExamContent {
  title: string;
  description: string;
  questions: PracticeExamQuestion[];
  /**
   * Fingerprint of the questions as parsed. Sent back on submit so the
   * attempt is scored against the version the user actually answered, even if
   * the file changed on disk in the meantime.
   */
  contentHash: string;
}

export interface PracticeExamQuestion {
  question: string;
  options: string[];
  correctIndices: number[];
  explanation: string;
  /** Source domain, e.g. "Security" (empty when unknown). */
  topic: string;
}

export interface QuizAttemptSummary {
  id: number;
  quizId: number;
  score: number;
  total: number;
  percent: number;
  createdAt: string;
}

export interface QuizAttemptAnswer {
  questionId: number;
  question: string;
  options: string[];
  correctIndex: number;
  correctIndices: number[];
  selectedIndex: number;
  /** Full selected set (single-choice: one element). */
  selectedIndices: number[];
  isCorrect: boolean;
  explanation: string;
  /** Seconds spent on this question (file-based exams only). */
  seconds?: number;
  /** Source domain as of the attempt (file-based exams only). */
  topic?: string;
}

export interface QuizAttemptDetail extends QuizAttemptSummary {
  answers: QuizAttemptAnswer[];
  /** Flagged question ids (file-based exams only). */
  flagged?: number[];
  /** File exams: wrong answers newly added to the exam's mistakes deck. */
  mistakesAdded?: number;
  mistakesDeckId?: number;
  /**
   * Set when the per-question review cannot be shown (file-based exams taken
   * before snapshots existed, whose file has since changed or gone). The
   * score is still real; `answers` is empty.
   */
  unavailableReason?: string;
}

export interface LearningStats {
  courseCount: number;
  totalWatchedSeconds: number;
  lessonsCompleted: number;
  totalLessons: number;
  overallProgressPercent: number;
}

/** The most recently touched lesson of a course (for Continue Learning). */
export interface LessonActivity {
  lessonId: number;
  lessonTitle: string;
  sectionTitle: string;
  updatedAt: string;
}

/** One lesson plus the bits of its section the player header needs. */
export interface LessonContext {
  lesson: LessonWithProgress;
  sectionTitle: string;
}

export interface AppSettings {
  theme: 'dark' | 'light' | 'system';
  defaultPlaybackSpeed: number;
  resumePlayback: 'ask' | 'always' | 'never';
  autoBackup: boolean;
  backupKeep: number;
  rescanOnStartup: boolean;
  examPassPercent: number;
  examSecondsPerQuestion: number;
  /** Turn wrongly answered practice-exam questions into flashcards. */
  examMistakesToFlashcards: boolean;
  /** Daily study goal in minutes (video watch time + exam time). */
  dailyGoalMinutes: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  defaultPlaybackSpeed: 1,
  resumePlayback: 'ask',
  autoBackup: true,
  backupKeep: 7,
  rescanOnStartup: false,
  examPassPercent: 70,
  examSecondsPerQuestion: 120,
  examMistakesToFlashcards: true,
  dailyGoalMinutes: 20,
};

export const DAILY_GOAL_OPTIONS = [10, 15, 20, 30, 45, 60, 90] as const;

/** Ctrl+K palette results, grouped by kind. */
export interface GlobalSearchResults {
  courses: Array<{ id: number; title: string; lessonCount: number }>;
  lessons: Array<{
    id: number;
    title: string;
    kind: 'video' | 'practice';
    sectionTitle: string;
    courseId: number;
    courseTitle: string;
  }>;
  notes: Array<{
    id: number;
    title: string;
    snippet: string;
    courseId: number;
    courseTitle: string;
    lessonId: number | null;
  }>;
  exams: Array<{ filePath: string; title: string; questionCount: number }>;
}

/** Today's study, the streak and the last week, for the Home page. */
export interface StudyStats {
  today: {
    studiedSeconds: number;
    goalSeconds: number;
    lessonsCompleted: number;
    questionsAnswered: number;
    cardsReviewed: number;
  };
  activeToday: boolean;
  currentStreak: number;
  bestStreak: number;
  /** Oldest first, ending today. */
  last7: Array<{ day: string; studiedSeconds: number; active: boolean }>;
  totalStudiedSeconds: number;
}

export const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

// ---- IPC payload types ----

export interface ImportResult {
  status: 'imported' | 'duplicate' | 'cancelled' | 'error';
  courseId?: number;
  courseTitle?: string;
  lessonCount?: number;
  sectionCount?: number;
  error?: string;
}

export interface RescanResult {
  status: 'ok' | 'error';
  addedLessons: number;
  addedSections: number;
  /**
   * Lessons newly flagged as missing (files gone). Rescan never deletes them —
   * progress, notes and bookmarks stay until the user forgets the lesson.
   */
  missingLessons: number;
  /** Lessons whose file came back since the last rescan. */
  restoredLessons: number;
  error?: string;
}

/** Result of relinking a single missing lesson file via the native dialog. */
export type LocateFileResult =
  | { status: 'ok'; url: string }
  | { status: 'cancelled' }
  | { status: 'outside-course'; courseTitle: string }
  | { status: 'wrong-type'; expected: string }
  | { status: 'error'; message: string };

export interface NoteInput {
  courseId: number;
  lessonId?: number | null;
  title: string;
  content: string;
}

export interface QuizInput {
  courseId: number;
  sectionId?: number | null;
  title: string;
  description: string;
  questions: QuizQuestionInput[];
}

export interface QuizQuestionInput {
  question: string;
  options: string[];
  correctIndex: number;
  correctIndices: number[];
  explanation: string;
}

export interface AnswerInput {
  questionId: number;
  selectedIndex: number;
  /** Optional full selection set; defaults to [selectedIndex]. */
  selectedIndices?: number[];
}

export interface PracticeFileImportResult {
  status: 'imported' | 'duplicate' | 'cancelled' | 'error';
  courseId?: number;
  lessonId?: number;
  quizId?: number;
  skipped?: number;
  /** Set when the file was kept as a lesson but could not be parsed as an exam. */
  parseError?: string;
  error?: string;
}

export interface PracticeFolderImportResult {
  scanned: number;
  imported: Array<{ quizId: number; courseId: number; title: string }>;
  duplicates: Array<{ quizId: number; courseId: number; title: string }>;
  failed: Array<{ file: string; error: string }>;
}

export interface AppPaths {
  userData: string;
  dbPath: string;
}
