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
}

export interface PracticeExamQuestion {
  question: string;
  options: string[];
  correctIndices: number[];
  explanation: string;
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
}

export interface QuizAttemptDetail extends QuizAttemptSummary {
  answers: QuizAttemptAnswer[];
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

export interface AppSettings {
  theme: 'dark' | 'light' | 'system';
  defaultPlaybackSpeed: number;
  resumePlayback: 'ask' | 'always' | 'never';
  duplicateImportBehavior: 'ask' | 'skip' | 'rescan';
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  defaultPlaybackSpeed: 1,
  resumePlayback: 'ask',
  duplicateImportBehavior: 'ask',
};

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
  removedLessons: number;
  error?: string;
}

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
