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
  fileType: 'video' | 'resource';
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
  explanation: string;
  position: number;
}

export interface Quiz {
  id: number;
  courseId: number;
  sectionId: number | null;
  sectionTitle: string | null;
  title: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  questionCount: number;
}

export interface QuizDetail extends Quiz {
  questions: QuizQuestion[];
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
  selectedIndex: number;
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

export interface AppSettings {
  theme: 'dark' | 'light';
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
  explanation: string;
}

export interface AnswerInput {
  questionId: number;
  selectedIndex: number;
}

export interface AppPaths {
  userData: string;
  dbPath: string;
}
