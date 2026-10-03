import { contextBridge, ipcRenderer } from 'electron';
import type {
  CourseDetail, CourseWithProgress, Note, NoteInput,
  Quiz, QuizDetail, QuizAttemptSummary, QuizAttemptDetail, QuizInput,
  AnswerInput, LearningStats, AppSettings, ImportResult, RescanResult, AppPaths, LessonActivity,
  ExamSource, PracticeExamFile, PracticeExamContent,
} from '../src/types';

// Narrow, typed API exposed to the renderer via contextBridge.
// The renderer can only invoke these explicit channels — no arbitrary IPC,
// no filesystem access, no Node.js integration.
const api = {
  courses: {
    list: (): Promise<CourseWithProgress[]> => ipcRenderer.invoke('courses:list'),
    get: (courseId: number): Promise<CourseDetail | null> => ipcRenderer.invoke('courses:get', courseId),
    import: (): Promise<ImportResult> => ipcRenderer.invoke('courses:import'),
    importPath: (dirPath: string): Promise<ImportResult> => ipcRenderer.invoke('courses:importPath', dirPath),
    rename: (courseId: number, title: string): Promise<void> => ipcRenderer.invoke('courses:rename', courseId, title),
    updateDescription: (courseId: number, description: string): Promise<void> =>
      ipcRenderer.invoke('courses:updateDescription', courseId, description),
    rescan: (courseId: number): Promise<RescanResult> => ipcRenderer.invoke('courses:rescan', courseId),
    remove: (courseId: number): Promise<void> => ipcRenderer.invoke('courses:remove', courseId),
    markOpened: (courseId: number): Promise<void> => ipcRenderer.invoke('courses:markOpened', courseId),
    renameSection: (sectionId: number, title: string): Promise<void> =>
      ipcRenderer.invoke('courses:renameSection', sectionId, title),
    renameLesson: (lessonId: number, title: string): Promise<void> =>
      ipcRenderer.invoke('courses:renameLesson', lessonId, title),
    thumbnailUrl: (courseId: number): Promise<string | null> =>
      ipcRenderer.invoke('courses:thumbnailUrl', courseId),
  },
  progress: {
    savePosition: (lessonId: number, seconds: number): Promise<void> =>
      ipcRenderer.invoke('progress:savePosition', lessonId, seconds),
    setCompleted: (lessonId: number, completed: boolean): Promise<void> =>
      ipcRenderer.invoke('progress:setCompleted', lessonId, completed),
    stats: (): Promise<LearningStats> => ipcRenderer.invoke('progress:stats'),
    mostRecentCourseId: (): Promise<number | null> => ipcRenderer.invoke('progress:mostRecentCourseId'),
    recentCourseIds: (limit?: number): Promise<number[]> => ipcRenderer.invoke('progress:recentCourseIds', limit),
    lastActivity: (courseId: number): Promise<LessonActivity | null> =>
      ipcRenderer.invoke('progress:lastActivity', courseId),
  },
  notes: {
    list: (courseId?: number): Promise<Note[]> => ipcRenderer.invoke('notes:list', courseId),
    search: (query: string): Promise<Note[]> => ipcRenderer.invoke('notes:search', query),
    get: (id: number): Promise<Note | null> => ipcRenderer.invoke('notes:get', id),
    create: (input: NoteInput): Promise<Note> => ipcRenderer.invoke('notes:create', input),
    update: (id: number, input: { title: string; content: string }): Promise<Note> =>
      ipcRenderer.invoke('notes:update', id, input),
    remove: (id: number): Promise<void> => ipcRenderer.invoke('notes:delete', id),
  },
  quizzes: {
    listForCourse: (courseId: number): Promise<Quiz[]> => ipcRenderer.invoke('quizzes:listForCourse', courseId),
    get: (id: number): Promise<QuizDetail | null> => ipcRenderer.invoke('quizzes:get', id),
    create: (input: QuizInput): Promise<QuizDetail> => ipcRenderer.invoke('quizzes:create', input),
    update: (id: number, input: QuizInput): Promise<QuizDetail> => ipcRenderer.invoke('quizzes:update', id, input),
    remove: (id: number): Promise<void> => ipcRenderer.invoke('quizzes:delete', id),
    submitAttempt: (quizId: number, answers: AnswerInput[]): Promise<number> =>
      ipcRenderer.invoke('quizzes:submitAttempt', quizId, answers),
    attempts: (quizId: number): Promise<QuizAttemptSummary[]> => ipcRenderer.invoke('quizzes:attempts', quizId),
    attemptDetail: (attemptId: number): Promise<QuizAttemptDetail | null> =>
      ipcRenderer.invoke('quizzes:attemptDetail', attemptId),
  },
  practice: {
    listSources: (): Promise<ExamSource[]> => ipcRenderer.invoke('practice:listSources'),
    addFolder: (): Promise<ExamSource | null> => ipcRenderer.invoke('practice:addFolder'),
    addFile: (): Promise<ExamSource | null> => ipcRenderer.invoke('practice:addFile'),
    addFolderPath: (dirPath: string): Promise<ExamSource> =>
      ipcRenderer.invoke('practice:addFolderPath', dirPath),
    addFilePath: (filePath: string): Promise<ExamSource> =>
      ipcRenderer.invoke('practice:addFilePath', filePath),
    removeSource: (sourceId: number): Promise<void> =>
      ipcRenderer.invoke('practice:removeSource', sourceId),
    scan: (): Promise<PracticeExamFile[]> => ipcRenderer.invoke('practice:scan'),
    load: (filePath: string): Promise<PracticeExamContent> =>
      ipcRenderer.invoke('practice:load', filePath),
    submit: (filePath: string, selections: number[][]): Promise<QuizAttemptDetail> =>
      ipcRenderer.invoke('practice:submit', filePath, selections),
    history: (filePath: string): Promise<QuizAttemptSummary[]> =>
      ipcRenderer.invoke('practice:history', filePath),
    attemptDetail: (attemptId: number): Promise<QuizAttemptDetail | null> =>
      ipcRenderer.invoke('practice:attemptDetail', attemptId),
  },
  settings: {
    getAll: (): Promise<AppSettings> => ipcRenderer.invoke('settings:getAll'),
    get: <T>(key: string): Promise<T | undefined> => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: unknown): Promise<void> => ipcRenderer.invoke('settings:set', key, value),
    reset: (): Promise<AppSettings> => ipcRenderer.invoke('settings:reset'),
  },
  media: {
    getUrl: (lessonId: number): Promise<string> => ipcRenderer.invoke('media:getUrl', lessonId),
    checkFile: (lessonId: number): Promise<boolean> => ipcRenderer.invoke('media:checkFile', lessonId),
    locateFile: (lessonId: number): Promise<string | null> => ipcRenderer.invoke('media:locateFile', lessonId),
    openExternal: (lessonId: number): Promise<void> => ipcRenderer.invoke('media:openExternal', lessonId),
  },
  app: {
    getVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),
    getPaths: (): Promise<AppPaths> => ipcRenderer.invoke('app:getPaths'),
    getLibraryInfo: (): Promise<{ courseCount: number; dbSizeBytes: number; dbPath: string }> =>
      ipcRenderer.invoke('app:getLibraryInfo'),
    showError: (title: string, message: string): Promise<void> => ipcRenderer.invoke('app:showError', title, message),
  },
};

export type IsmaLearnApi = typeof api;

contextBridge.exposeInMainWorld('ismaLearn', api);
