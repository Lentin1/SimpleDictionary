export type View = "today" | "learn" | "books";

export type BookSummary = {
  id: string;
  name: string;
  note: string;
  wordCount: number;
  chapterCount: number;
  masteredCount: number;
  active: boolean;
  chapters: string[];
};

export type TodayOverview = {
  date: string;
  studiedCount: number;
  reviewCount: number;
  targetCount: number;
  checkedIn: boolean;
  studyChapters: string[];
  reviewChapters: string[];
};

export type HistoryRecord = {
  date: string;
  studiedCount: number;
  reviewCount: number;
  targetCount: number;
  checkedIn: boolean;
  completed: boolean;
  hourlyCounts: number[];
};

export type AppSnapshot = {
  appName: string;
  currentBook: BookSummary | null;
  books: BookSummary[];
  today: TodayOverview;
  schedule: ScheduleDaySnapshot[];
  history: HistoryRecord[];
  migratedFromLegacy: boolean;
};

export type ScheduleDaySnapshot = {
  dayIndex: number;
  date: string | null;
  studyChapters: string[];
  reviewChapters: string[];
};

export type ScheduleDayInput = Omit<ScheduleDaySnapshot, "date"> & { date?: string | null };

export type LlmSettings = {
  endpoint: string;
  model: string;
  configured: boolean;
};

export type LlmMessage = {
  role: "user" | "assistant";
  content: string;
};

export type StudySense = {
  part: string;
  meaning: string;
};

export type StudyWord = {
  word: string;
  part: string;
  phonetic: string;
  meaning: string;
  chapter: string;
  senses?: StudySense[];
  definition?: string;
  example?: string;
  translation?: string;
  tag?: string;
};

export type BookWord = StudyWord & { key: string };

export type StudySessionSnapshot = {
  mode: "learn" | "review";
  date: string;
  active: boolean;
  completed: boolean;
  revealed: boolean;
  current: StudyWord & { key: string } | null;
  answer: "known" | "unknown" | null;
  remainingCount: number;
  knownCount: number;
  unknownCount: number;
};

export type ImportWordInput = {
  legacyId?: string;
  chapter: string;
  word: string;
  phonetic?: string;
  part?: string;
  meaning?: string;
  senses?: StudySense[];
  definition?: string;
  example?: string;
  translation?: string;
  tag?: string;
};
