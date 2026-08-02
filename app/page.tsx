"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parsePdfImport } from "@/lib/pdf-import";

type WordSense = {
  part: string;
  meaning: string;
};

type Word = {
  id: number;
  chapter?: string;
  word: string;
  phonetic: string;
  part: string;
  meaning: string;
  senses?: WordSense[];
  definition: string;
  example: string;
  translation: string;
  tag: string;
};

type ProgressRecord = {
  status: "mastered" | "review";
  lastStudied: string;
  lastStudiedAt?: string;
};

type StoredProgress = Record<number, ProgressRecord>;

type DailyChapterPlan = {
  study: string[];
  review: string[];
};

type StoredChapterSchedule = {
  bookSignature: string;
  startDate: string;
  days: DailyChapterPlan[];
};

type DailyStudyRecord = {
  studiedCount: number;
  targetCount: number;
  completed: boolean;
  checkedIn: boolean;
  hourlyCounts: number[];
};

type StudyHistory = Record<string, DailyStudyRecord>;

type SessionMode = "choose" | "review" | "learn";

type StoredSessionState = {
  mode: Exclude<SessionMode, "choose">;
  currentId: number;
  revealed: boolean;
  lastAnswer: "known" | "unknown" | null;
  queue?: number[];
  date?: string;
  active?: boolean;
};

type StoredBookEntry = {
  id: string;
  name: string;
  note: string;
  words: Word[];
  progress: StoredProgress;
  schedule?: StoredChapterSchedule;
  studyHistory: StudyHistory;
  session?: StoredSessionState;
};

type StoredBookState = {
  words: Word[];
  progress: StoredProgress;
  schedule?: StoredChapterSchedule;
  studyHistory?: StudyHistory;
  session?: StoredSessionState;
  bookId?: string;
  bookName?: string;
  bookNote?: string;
  activeBookId?: string;
  books?: StoredBookEntry[];
};

type BackupPayload = StoredBookState & {
  version: 1;
  exportedAt: string;
};

const WORDS: Word[] = [
  {
    id: 1,
    chapter: "第 1 单元",
    word: "serendipity",
    phonetic: "/ˌserənˈdipitē/",
    part: "n.",
    meaning: "意外发现珍奇事物的运气",
    definition: "the chance occurrence of a happy or useful discovery",
    example: "A fortunate stroke of serendipity brought them together.",
    translation: "一次幸运的意外发现让他们相遇。",
    tag: "GRE",
  },
  {
    id: 2,
    chapter: "第 1 单元",
    word: "meticulous",
    phonetic: "/məˈtikyələs/",
    part: "adj.",
    meaning: "一丝不苟的；极其仔细的",
    definition: "showing great attention to detail; very careful and precise",
    example: "She kept meticulous notes during every experiment.",
    translation: "她在每次实验中都做了极其细致的记录。",
    tag: "IELTS",
  },
  {
    id: 3,
    chapter: "第 1 单元",
    word: "resilient",
    phonetic: "/rəˈzilyənt/",
    part: "adj.",
    meaning: "有韧性的；能迅速恢复的",
    definition: "able to withstand or recover quickly from difficult conditions",
    example: "Children are often more resilient than adults expect.",
    translation: "孩子往往比大人想象中更有韧性。",
    tag: "TOEFL",
  },
  {
    id: 4,
    chapter: "第 2 单元",
    word: "ambiguous",
    phonetic: "/amˈbiɡyo͞oəs/",
    part: "adj.",
    meaning: "模棱两可的；含糊不清的",
    definition: "open to more than one interpretation; not clear",
    example: "The wording of the contract was deliberately ambiguous.",
    translation: "合同的措辞被故意写得模棱两可。",
    tag: "CET-6",
  },
  {
    id: 5,
    chapter: "第 2 单元",
    word: "alleviate",
    phonetic: "/əˈlēvēˌāt/",
    part: "vt./vi.",
    meaning: "减轻；缓解（痛苦、问题等）",
    definition: "make a problem or unpleasant feeling less severe",
    example: "A short walk can help alleviate stress after a long day.",
    translation: "忙碌一天后，短暂散步有助于缓解压力。",
    tag: "CET-6",
  },
  {
    id: 6,
    chapter: "第 2 单元",
    word: "coherent",
    phonetic: "/kōˈhirənt/",
    part: "adj.",
    meaning: "连贯的；有条理的",
    definition: "logical and consistent; easy to understand",
    example: "He presented a coherent argument backed by evidence.",
    translation: "他提出了一个有证据支持的连贯论点。",
    tag: "IELTS",
  },
  {
    id: 7,
    chapter: "第 3 单元",
    word: "pragmatic",
    phonetic: "/praɡˈmatik/",
    part: "adj.",
    meaning: "务实的；实用主义的",
    definition: "dealing with problems in a practical way",
    example: "We need a pragmatic solution that works today.",
    translation: "我们需要一个今天就能奏效的务实方案。",
    tag: "GRE",
  },
  {
    id: 8,
    chapter: "第 3 单元",
    word: "vivid",
    phonetic: "/ˈvivid/",
    part: "adj.",
    meaning: "生动的；鲜明的",
    definition: "producing powerful feelings or strong, clear images",
    example: "I have a vivid memory of my first day at university.",
    translation: "我对大学第一天的经历记忆犹新。",
    tag: "TOEFL",
  },
];

const STORAGE_KEY = "vocab-flow-progress-v1";
const CUSTOM_WORDS_KEY = "vocab-flow-custom-words-v1";
const BOOK_STATE_KEY = "vocab-flow-book-state-v1";
const STUDY_HISTORY_KEY = "vocab-flow-study-history-v1";
const DEFAULT_SCHEDULE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const APP_TIME_ZONE = "Asia/Shanghai";
const PDF_REVIEW_OFFSETS = [7, 4, 2, 1];
const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];
const EMPTY_HOURLY_COUNTS = Array.from({ length: 24 }, () => 0);
const DEFAULT_BOOK_ID = "builtin-sample";
const DEFAULT_BOOK_NAME = "简辞示例词书";
const TEST_BOOK_ID = "test-book";
const TEST_BOOK_NAME = "测试词书（示例）";

function formatDate(date = new Date()) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
    timeZone: APP_TIME_ZONE,
  }).format(date);
}

function formatCompletionDate(timestamp: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    timeZone: APP_TIME_ZONE,
  }).format(new Date(timestamp));
}

function getTimeGreeting(date = new Date(), completed = false, studiedCount = 0) {
  const hour = localHour(date);
  if (hour < 5) return "夜深了，早点休息，明天再继续吧";
  if (hour < 8) {
    if (completed) return "早安，今天的任务已经完成了";
    return studiedCount > 0 ? "早安，继续保持这个节奏" : "早安，今天也从几个单词开始吧";
  }
  if (hour < 12) {
    if (completed) return "上午好，今天的任务完成得很漂亮";
    return studiedCount > 0 ? "上午好，趁状态正好继续学几个" : "上午好，趁状态正好学几个单词吧";
  }
  if (hour < 14) {
    if (completed) return "中午好，今天的任务已经完成了，安心休息吧";
    return studiedCount > 0 ? "中午好，学了一会儿，先休息一下吧" : "中午好，午休后再学也不迟";
  }
  if (hour < 18) {
    if (completed) return "下午好，今天的任务已经完成了";
    return studiedCount > 0 ? "下午好，继续保持这个节奏" : "下午好，抽几分钟巩固一下吧";
  }
  if (completed) return "晚上好，今天的任务完成了，安心休息吧";
  return studiedCount > 0 ? "晚上好，再巩固几个就可以收工了" : "晚上好，今天想学几个单词呢？";
}

function localDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: APP_TIME_ZONE,
    year: "numeric",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function localHour(date = new Date()) {
  const value = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: false,
    timeZone: APP_TIME_ZONE,
  }).format(date);
  return Number(value) % 24;
}

function normalizeHourlyCounts(value: unknown) {
  if (!Array.isArray(value)) return [...EMPTY_HOURLY_COUNTS];
  return Array.from({ length: 24 }, (_, index) => {
    const count = value[index];
    return typeof count === "number" && Number.isFinite(count) ? Math.max(0, count) : 0;
  });
}

function normalizeStudyHistory(value: unknown): StudyHistory {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([date, record]) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) return [];
    const candidate = record as Partial<DailyStudyRecord>;
    return [[date, {
      studiedCount: typeof candidate.studiedCount === "number" ? Math.max(0, candidate.studiedCount) : 0,
      targetCount: typeof candidate.targetCount === "number" ? Math.max(0, candidate.targetCount) : 0,
      completed: candidate.completed === true,
      checkedIn: candidate.checkedIn === true,
      hourlyCounts: normalizeHourlyCounts(candidate.hourlyCounts),
    } satisfies DailyStudyRecord]];
  }));
}

function normalizeProgress(value: unknown): StoredProgress {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([id, record]) => {
    const numericId = Number(id);
    if (!Number.isFinite(numericId) || !record || typeof record !== "object" || Array.isArray(record)) return [];
    const candidate = record as Partial<ProgressRecord>;
    if (candidate.status !== "mastered" && candidate.status !== "review") return [];
    return [[numericId, {
      status: candidate.status,
      lastStudied: typeof candidate.lastStudied === "string" ? candidate.lastStudied : "",
      lastStudiedAt: typeof candidate.lastStudiedAt === "string" ? candidate.lastStudiedAt : undefined,
    } satisfies ProgressRecord]];
  })) as StoredProgress;
}

function normalizeStoredSession(value: unknown): StoredSessionState | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Partial<StoredSessionState>;
  if ((candidate.mode !== "learn" && candidate.mode !== "review") || typeof candidate.currentId !== "number") return undefined;
  return {
    mode: candidate.mode,
    currentId: candidate.currentId,
    revealed: candidate.revealed === true,
    lastAnswer: candidate.lastAnswer === "known" || candidate.lastAnswer === "unknown" ? candidate.lastAnswer : null,
    queue: Array.isArray(candidate.queue)
      ? candidate.queue.filter((id): id is number => typeof id === "number" && Number.isFinite(id))
      : undefined,
    date: typeof candidate.date === "string" ? candidate.date : undefined,
    active: candidate.active !== false,
  };
}

function buildStudyWeek(date = new Date()) {
  const start = dateFromKey(localDateKey(date));
  const mondayOffset = (start.getUTCDay() + 6) % 7;
  start.setUTCDate(start.getUTCDate() - mondayOffset);
  return Array.from({ length: 7 }, (_, index) => new Date(start.getTime() + index * DAY_MS));
}

function buildStudyMonth(date = new Date()) {
  const cursor = dateFromKey(localDateKey(date));
  const first = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1, 12));
  const mondayOffset = (first.getUTCDay() + 6) % 7;
  const start = new Date(first.getTime() - mondayOffset * DAY_MS);
  return Array.from({ length: 42 }, (_, index) => new Date(start.getTime() + index * DAY_MS));
}

function shiftCalendarCursor(cursor: string, view: "month" | "week" | "day", direction: number) {
  const date = dateFromKey(cursor);
  if (view === "month") {
    date.setUTCDate(15);
    date.setUTCMonth(date.getUTCMonth() + direction);
  } else {
    date.setUTCDate(date.getUTCDate() + (view === "week" ? direction * 7 : direction));
  }
  return localDateKey(date);
}

function formatCalendarTitle(view: "month" | "week" | "day", cursor: string, today: string) {
  const date = dateFromKey(cursor);
  if (view === "month") {
    return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", timeZone: APP_TIME_ZONE }).format(date);
  }
  if (view === "day") {
    return cursor === today
      ? "今天"
      : new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "short", timeZone: APP_TIME_ZONE }).format(date);
  }
  const week = buildStudyWeek(date);
  const todayWeek = buildStudyWeek(dateFromKey(today));
  if (localDateKey(week[0]) === localDateKey(todayWeek[0])) return "本周打卡";
  const formatter = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", timeZone: APP_TIME_ZONE });
  return `${formatter.format(week[0])} – ${formatter.format(week[6])}`;
}

function countStudyStreak(history: StudyHistory, today: string) {
  let streak = 0;
  let cursor = dateFromKey(today);
  while (history[localDateKey(cursor)]?.checkedIn) {
    streak += 1;
    cursor = new Date(cursor.getTime() - DAY_MS);
  }
  return streak;
}

function dateFromKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1, 12));
}

function daysBetween(startDate: string, endDate: string) {
  return Math.floor((dateFromKey(endDate).getTime() - dateFromKey(startDate).getTime()) / DAY_MS);
}

function chapterLabelKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ").replace(/^list 0+(\d+)$/, "list $1");
}

function wordKey(word: Word) {
  return `${chapterLabelKey(chapterName(word))}::${word.word.trim().toLowerCase()}`;
}

function hashText(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function bookSignature(words: Word[]) {
  return `${words.length}:${hashText(words.map(wordKey).join("|"))}`;
}

function buildDefaultChapterSchedule(words: Word[], startDate = localDateKey()): StoredChapterSchedule {
  const names = chapterNames(words);
  const dayCount = Math.max(DEFAULT_SCHEDULE_DAYS, names.length);
  const days = Array.from({ length: dayCount }, (_, index) => {
    const reviewIndexes = PDF_REVIEW_OFFSETS
      .map((offset) => index - offset)
      .filter((chapterIndex) => chapterIndex >= 0 && chapterIndex < names.length)
      .sort((left, right) => left - right);
    return {
      study: names[index] ? [names[index]] : [],
      review: reviewIndexes.map((chapterIndex) => names[chapterIndex]),
    };
  });
  return { bookSignature: bookSignature(words), startDate, days };
}

function normalizeChapterSchedule(schedule: Partial<StoredChapterSchedule>, words: Word[]) {
  const names = chapterNames(words);
  const validNames = new Map(names.map((name) => [chapterLabelKey(name), name]));
  const sourceDays = Array.isArray(schedule.days) ? schedule.days : [];
  const days = sourceDays.map((day) => {
    const rawDay = day as unknown as { study?: unknown; review?: unknown };
    const normalizeNames = (value: unknown) => {
      const source = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
      return Array.from(new Set(source
        .filter((name): name is string => typeof name === "string")
        .map((name) => validNames.get(chapterLabelKey(name)))
        .filter((name): name is string => Boolean(name))));
    };
    const study = normalizeNames(rawDay?.study);
    const review = normalizeNames(rawDay?.review);
    return { study, review };
  });
  const fallback = buildDefaultChapterSchedule(words, typeof schedule.startDate === "string" ? schedule.startDate : localDateKey());
  return {
    bookSignature: bookSignature(words),
    startDate: typeof schedule.startDate === "string" ? schedule.startDate : fallback.startDate,
    days: days.length ? days : fallback.days,
  };
}

function normalizeStoredWords(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((word, index) => {
    if (!word || typeof word !== "object") return [];
    const candidate = word as Partial<Word>;
    if (typeof candidate.word !== "string" || typeof candidate.meaning !== "string") return [];
    return [{
      id: typeof candidate.id === "number" ? candidate.id : index + 1,
      chapter: typeof candidate.chapter === "string" ? candidate.chapter : "未分组",
      word: candidate.word,
      phonetic: typeof candidate.phonetic === "string" ? candidate.phonetic : "/—/",
      part: typeof candidate.part === "string" ? candidate.part : "n.",
      meaning: candidate.meaning,
      senses: normalizeStoredSenses(candidate.senses),
      definition: typeof candidate.definition === "string" ? candidate.definition : "",
      example: typeof candidate.example === "string" ? candidate.example : "",
      translation: typeof candidate.translation === "string" ? candidate.translation : "",
      tag: typeof candidate.tag === "string" ? candidate.tag : "自定义",
    } satisfies Word];
  });
}

function normalizeStoredBookEntry(value: unknown): StoredBookEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<StoredBookEntry>;
  if (typeof candidate.id !== "string" || !candidate.id.trim() || typeof candidate.name !== "string") return null;
  const words = normalizeStoredWords(candidate.words);
  const availableWords = words.length ? words : WORDS;
  const storedSchedule = candidate.schedule;
  const schedule = storedSchedule && typeof storedSchedule === "object"
    ? normalizeChapterSchedule(storedSchedule, availableWords)
    : buildDefaultChapterSchedule(availableWords);
  const note = typeof candidate.note === "string" ? candidate.note : "";
  return {
    id: candidate.id,
    name: normalizeBookName(candidate.name, note),
    note,
    words,
    progress: normalizeProgress(candidate.progress),
    schedule,
    studyHistory: normalizeStudyHistory(candidate.studyHistory),
    session: normalizeStoredSession(candidate.session),
  };
}

function normalizeBookName(value: string, legacyNote = "") {
  const name = value.trim() || DEFAULT_BOOK_NAME;
  const note = legacyNote.trim();
  const legacyName = name === "我的自定义词书" || name === "恢复的词书";
  const generatedNote = note === "从备份恢复" || note === "从本地 TXT / PDF 导入";
  return legacyName && note && !generatedNote ? note : name;
}

function createTestBook(): StoredBookEntry {
  const words = WORDS.slice(0, 4).map((word, index) => ({
    ...word,
    id: 1001 + index,
    chapter: index < 2 ? "测试章节 01" : "测试章节 02",
    tag: "TEST",
  }));
  return {
    id: TEST_BOOK_ID,
    name: TEST_BOOK_NAME,
    note: "",
    words,
    progress: {},
    schedule: buildDefaultChapterSchedule(words),
    studyHistory: {},
  };
}

function ensureTestBook(books: StoredBookEntry[]) {
  return books.some((book) => book.id === TEST_BOOK_ID) ? books : [...books, createTestBook()];
}

function buildSmoothChartPath(values: number[], maxValue: number) {
  const weights = [1, 2, 4, 2, 1];
  const smoothedValues = values.map((_, index) => {
    let weightedTotal = 0;
    let weightTotal = 0;
    for (let offset = -2; offset <= 2; offset += 1) {
      const value = values[index + offset];
      const weight = weights[offset + 2];
      if (typeof value === "number" && Number.isFinite(value)) {
        weightedTotal += value * weight;
        weightTotal += weight;
      }
    }
    return weightTotal ? weightedTotal / weightTotal : 0;
  });
  const plottedMax = Math.max(1, ...smoothedValues);
  const displayScale = maxValue / plottedMax;
  const points = smoothedValues.map((value, index) => ({
    x: (index / Math.max(1, values.length - 1)) * 100,
    y: 88 - ((value * displayScale) / maxValue) * 70,
  }));
  if (!points.length) return "";
  const clampY = (value: number) => Math.max(18, Math.min(88, value));
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[index - 1] ?? points[index];
    const current = points[index];
    const next = points[index + 1];
    const after = points[index + 2] ?? next;
    const controlOne = {
      x: current.x + (next.x - previous.x) / 6,
      y: clampY(current.y + (next.y - previous.y) / 6),
    };
    const controlTwo = {
      x: next.x - (after.x - current.x) / 6,
      y: clampY(next.y - (after.y - current.y) / 6),
    };
    path += ` C ${controlOne.x} ${controlOne.y}, ${controlTwo.x} ${controlTwo.y}, ${next.x} ${next.y}`;
  }
  return path;
}

function normalizePart(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[.。]/g, "");
  const aliases: Record<string, string> = {
    noun: "n.",
    n: "n.",
    名词: "n.",
    adjective: "adj.",
    adj: "adj.",
    形容词: "adj.",
    verb: "v.",
    v: "v.",
    vt: "vt.",
    vi: "vi.",
    "vt/vi": "vt./vi.",
    动词: "v.",
  };
  return aliases[normalized] ?? (value.trim().endsWith(".") ? value.trim() : `${value.trim()}.`);
}

const PART_TOKEN_PATTERN = /^(?:(?:vt|vi)\.?\/(?:vt|vi)\.?|n|adj|adv|v|vt|vi|prep|pron|conj|num|det|aux|art|modal|noun|adjective|verb|名词|形容词|动词)\.?$/i;
const PART_SEQUENCE_PATTERN = /(?:vt\.?\s*\/\s*vi\.?|vi\.?\s*\/\s*vt\.?|noun|adjective|verb|n|adj|adv|v|vt|vi|prep|pron|conj|num|det|aux|art|modal|名词|形容词|动词)\.?/gi;

function normalizeStoredSenses(value: unknown): WordSense[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const senses = value.flatMap((sense) => {
    if (!sense || typeof sense !== "object" || Array.isArray(sense)) return [];
    const candidate = sense as Partial<WordSense>;
    if (typeof candidate.part !== "string" || typeof candidate.meaning !== "string") return [];
    const part = normalizePart(candidate.part);
    const meaning = candidate.meaning.trim();
    return part && meaning ? [{ part, meaning }] : [];
  });
  return senses.length ? senses : undefined;
}

function splitPartLabels(value: string) {
  const source = value.trim();
  if (!source) return [];
  const matches = source.match(PART_SEQUENCE_PATTERN) ?? [];
  const remainder = source
    .replace(PART_SEQUENCE_PATTERN, "")
    .replace(/[\s./,，、;；]+/g, "");
  if (matches.length && !remainder) return matches.map((part) => normalizePart(part));
  return [normalizePart(source)];
}

function splitMeaningSegments(value: string) {
  return value
    .split(/\s*[;；]\s*/)
    .map((meaning) => meaning.replace(/[;；]+$/g, "").trim())
    .filter(Boolean);
}

function parseExplicitSenses(meaning: string) {
  const senses = splitMeaningSegments(meaning).flatMap((segment) => {
    const match = segment.match(/^([^\s:：]+)\s*(?:[:：]\s*|\s+)(.+)$/);
    if (!match || !PART_TOKEN_PATTERN.test(match[1])) return [];
    return [{ part: normalizePart(match[1]), meaning: match[2].trim() }];
  });
  return senses.length > 1 ? senses : [];
}

function getWordSenses(word: Pick<Word, "part" | "meaning" | "senses">): WordSense[] {
  if (word.senses?.length) {
    const storedSenses = word.senses.flatMap((sense) => getWordSenses(sense));
    if (storedSenses.length) return storedSenses;
  }
  const explicitSenses = parseExplicitSenses(word.meaning);
  if (explicitSenses.length) return explicitSenses;

  const parts = splitPartLabels(word.part);
  const meanings = splitMeaningSegments(word.meaning);
  if (parts.length === 1) return [{ part: parts[0] ?? "n.", meaning: word.meaning.trim() }];
  if (meanings.length === parts.length) {
    return parts.map((part, index) => ({ part, meaning: meanings[index] }));
  }
  if (meanings.length > parts.length) {
    return parts.map((part, index) => ({
      part,
      meaning: meanings.slice(index, index === parts.length - 1 ? undefined : index + 1).join("；"),
    }));
  }
  return [{ part: parts[0] ?? "n.", meaning: word.meaning.trim() }];
}

function shouldShowDefinition(definition: string) {
  const normalized = definition.trim();
  return Boolean(normalized) && normalized !== "来自我的词书的自定义词条";
}

function shouldShowExample(example: string) {
  const normalized = example.trim();
  return Boolean(normalized) && normalized !== "例句待补充。";
}

function parseWordImport(rawText: string, startId: number) {
  const imported: Word[] = [];
  const errors: string[] = [];
  const lines = rawText.split(/\r?\n/);
  let currentChapter = "未分组";

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmedLine = line.trim();
    if (!trimmedLine) return;
    const chapterMatch = trimmedLine.match(/^\[(.+)\]$|^【(.+)】$|^#{1,2}\s+(.+)$/);
    if (chapterMatch) {
      currentChapter = (chapterMatch[1] ?? chapterMatch[2] ?? chapterMatch[3]).trim();
      return;
    }
    if (trimmedLine.startsWith("#")) return;
    const fields = trimmedLine.split("|").map((field) => field.trim());
    const hasPhoneticColumn = fields.length >= 5 || (fields.length === 4 && /^[\[\/]/.test(fields[1]));
    const [word, phonetic, meaning, part, example] = hasPhoneticColumn
      ? [fields[0], fields[1], fields[2], fields[3], fields[4] ?? ""]
      : [fields[0], "/—/", fields[1], fields[2], fields[3] ?? ""];
    if (!word || !meaning || !part) {
      errors.push(`第 ${lineNumber} 行格式不完整，请按“单词 | 音标 | 中文释义 | 词性 | 例句（可选）”填写`);
      return;
    }
    const normalizedPart = normalizePart(part);
    const senses = getWordSenses({ part: normalizedPart, meaning });
    imported.push({
      id: startId + imported.length,
      chapter: currentChapter,
      word,
      phonetic: phonetic || "/—/",
      part: normalizedPart,
      meaning,
      senses: senses.length > 1 ? senses : undefined,
      definition: "",
      example: example || "",
      translation: "",
      tag: currentChapter.toLowerCase().startsWith("list") ? "TOEFL" : "自定义",
    });
  });

  return { imported, errors };
}

function chapterName(word: Word) {
  return word.chapter?.trim() || "未分组";
}

function chapterNames(words: Word[]) {
  return Array.from(new Set(words.map(chapterName)));
}

function getScheduledChapterPlan(words: Word[], progress: StoredProgress, schedule: StoredChapterSchedule, today: string) {
  const names = chapterNames(words);
  const dayIndex = Math.max(0, Math.min(schedule.days.length - 1, daysBetween(schedule.startDate, today)));
  const day = schedule.days[dayIndex] ?? { study: [], review: [] };
  const studyNames = day.study.filter((name) => names.includes(name));
  const reviewNames = day.review.filter((name) => names.includes(name));
  const selectedNames = Array.from(new Set([...studyNames, ...reviewNames]));
  const selectedWords = words.filter((word) => selectedNames.includes(chapterName(word)));
  const studyWords = words.filter((word) => studyNames.includes(chapterName(word)) && progress[word.id]?.status !== "mastered");
  return { names, dayIndex, day, studyNames, reviewNames, selectedNames, selectedWords, studyWords };
}

function Icon({ name }: { name: "spark" | "book" | "clock" | "stack" | "check" | "arrow" | "sliders" | "help" }) {
  const paths = {
    spark: <><path d="m12 2 1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9L12 2Z" /><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z" /></>,
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Z" /><path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20" /></>,
    clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.2 2" /></>,
    stack: <><path d="M5.5 5H19v14H5.5A2.5 2.5 0 0 0 3 21.5v-14A2.5 2.5 0 0 1 5.5 5Z" /><path d="M7 9h9M7 13h9M7 17h6" /></>,
    check: <path d="m5 12 4.2 4.2L19 6.5" />,
    arrow: <><path d="M5 12h13" /><path d="m13 6 6 6-6 6" /></>,
    sliders: <><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="9" cy="6" r="2" /><circle cx="15" cy="12" r="2" /><circle cx="11" cy="18" r="2" /></>,
    help: <><circle cx="12" cy="12" r="9" /><path d="M9.7 9a2.4 2.4 0 1 1 4.2 1.6c-1 .9-1.9 1.2-1.9 2.5" /><path d="M12 16.5h.01" /></>,
  };
  return <svg aria-hidden="true" className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

export default function Home() {
  const [progress, setProgress] = useState<StoredProgress>({});
  const [studyHistory, setStudyHistory] = useState<StudyHistory>({});
  const [customWords, setCustomWords] = useState<Word[]>([]);
  const [currentId, setCurrentId] = useState<number>(1);
  const [sessionMode, setSessionMode] = useState<SessionMode>("choose");
  const [sessionQueue, setSessionQueue] = useState<number[]>([]);
  const [sessionDate, setSessionDate] = useState<string | null>(null);
  const [pendingSessionMode, setPendingSessionMode] = useState<Exclude<SessionMode, "choose"> | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [lastAnswer, setLastAnswer] = useState<"known" | "unknown" | null>(null);
  const [activeTab, setActiveTab] = useState<"review" | "mastered">("review");
  const [chapterSchedule, setChapterSchedule] = useState<StoredChapterSchedule | null>(null);
  const [showScheduleEditor, setShowScheduleEditor] = useState(false);
  const [showBookPanel, setShowBookPanel] = useState(false);
  const [bookPanelMode, setBookPanelMode] = useState<"library" | "view" | "import" | "edit">("library");
  const [bookLibrary, setBookLibrary] = useState<StoredBookEntry[]>([]);
  const [activeBookId, setActiveBookId] = useState(DEFAULT_BOOK_ID);
  const [bookName, setBookName] = useState(DEFAULT_BOOK_NAME);
  const [bookNote, setBookNote] = useState("");
  const [editingBookId, setEditingBookId] = useState<string | null>(null);
  const [bookNameDraft, setBookNameDraft] = useState("");
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");
  const [selectedFileName, setSelectedFileName] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [toast, setToast] = useState("");
  const [now, setNow] = useState(0);
  const [calendarView, setCalendarView] = useState<"month" | "week" | "day">("week");
  const [calendarCursor, setCalendarCursor] = useState(() => localDateKey());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const persistenceReadyRef = useRef(false);
  const allWords = customWords.length ? customWords : WORDS;
  const today = localDateKey();
  const currentWord = allWords.find((word) => word.id === currentId) ?? allWords[0];
  const effectiveSchedule = useMemo(
    () => chapterSchedule ?? buildDefaultChapterSchedule(allWords, today),
    [allWords, chapterSchedule, today],
  );
  const activePlan = useMemo(
    () => getScheduledChapterPlan(allWords, progress, effectiveSchedule, today),
    [allWords, effectiveSchedule, progress, today],
  );
  const planWords = activePlan.selectedWords;
  const targetWordCount = planWords.length;
  const scheduleChapterNames = chapterNames(allWords);
  const bookChapterGroups = chapterNames(allWords).map((name) => ({ name, words: allWords.filter((word) => chapterName(word) === name) }));

  const currentSessionState = useCallback((): StoredSessionState | undefined => {
    if (sessionMode === "choose") {
      return pendingSessionMode && sessionQueue.length
        ? {
          mode: pendingSessionMode,
          currentId: sessionQueue[0] ?? currentId,
          revealed: false,
          lastAnswer: null,
          queue: sessionQueue,
          date: sessionDate ?? today,
          active: false,
        }
        : undefined;
    }
    return {
      mode: sessionMode,
      currentId,
      revealed,
      lastAnswer,
      queue: sessionQueue,
      date: sessionDate ?? today,
      active: true,
    };
  }, [currentId, lastAnswer, pendingSessionMode, revealed, sessionDate, sessionMode, sessionQueue, today]);

  const currentBookSnapshot = useCallback((session?: StoredSessionState): StoredBookEntry => ({
    id: activeBookId,
    name: bookName,
    note: bookNote,
    words: customWords,
    progress,
    schedule: chapterSchedule ?? buildDefaultChapterSchedule(allWords, today),
    studyHistory,
    session,
  }), [activeBookId, allWords, bookName, bookNote, chapterSchedule, customWords, progress, studyHistory, today]);

  const persistedBookEntries = useCallback((session?: StoredSessionState) => {
    const current = currentBookSnapshot(session);
    if (!bookLibrary.length) return [current];
    if (!bookLibrary.some((book) => book.id === activeBookId)) return [...bookLibrary, current];
    return bookLibrary.map((book) => book.id === activeBookId ? current : book);
  }, [activeBookId, bookLibrary, currentBookSnapshot]);

  useEffect(() => {
    let readyFrame = 0;
    const frame = window.requestAnimationFrame(() => {
      try {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        const savedCustomWords = window.localStorage.getItem(CUSTOM_WORDS_KEY);
        const savedBookState = window.localStorage.getItem(BOOK_STATE_KEY);
        const savedStudyHistory = window.localStorage.getItem(STUDY_HISTORY_KEY);
        const parsedBookState = savedBookState ? JSON.parse(savedBookState) as Partial<StoredBookState> : {};
        const bookStateWords = Array.isArray(parsedBookState.words) ? parsedBookState.words : [];
        const legacyWords = normalizeStoredWords(bookStateWords.length
          ? bookStateWords
          : savedCustomWords
            ? JSON.parse(savedCustomWords)
            : []);
        const legacyProgress = normalizeProgress((bookStateWords.length
          ? parsedBookState.progress
          : saved
            ? JSON.parse(saved)
            : parsedBookState.progress
        ) ?? {});
        const legacyAvailableWords = legacyWords.length ? legacyWords : WORDS;
        const legacyStudyHistory = normalizeStudyHistory(
          parsedBookState.studyHistory ?? (savedStudyHistory ? JSON.parse(savedStudyHistory) : {}),
        );
        const legacySchedule = parsedBookState.schedule && parsedBookState.schedule.bookSignature === bookSignature(legacyAvailableWords)
          ? normalizeChapterSchedule(parsedBookState.schedule, legacyAvailableWords)
          : buildDefaultChapterSchedule(legacyAvailableWords);
        const storedBooks = Array.isArray(parsedBookState.books)
          ? parsedBookState.books.flatMap((book) => {
            const normalized = normalizeStoredBookEntry(book);
            return normalized ? [normalized] : [];
          })
          : [];
        const initialBooks = storedBooks.length ? storedBooks : ensureTestBook([{
          id: typeof parsedBookState.bookId === "string" ? parsedBookState.bookId : legacyWords.length ? "custom-main" : DEFAULT_BOOK_ID,
          name: normalizeBookName(
            typeof parsedBookState.bookName === "string" && parsedBookState.bookName.trim()
              ? parsedBookState.bookName
              : legacyWords.length ? "我的自定义词书" : DEFAULT_BOOK_NAME,
            typeof parsedBookState.bookNote === "string" ? parsedBookState.bookNote : "",
          ),
          note: typeof parsedBookState.bookNote === "string" ? parsedBookState.bookNote : "",
          words: legacyWords,
          progress: legacyProgress,
          schedule: legacySchedule,
          studyHistory: legacyStudyHistory,
          session: parsedBookState.session,
        } satisfies StoredBookEntry]);
        const requestedBookId = typeof parsedBookState.activeBookId === "string"
          ? parsedBookState.activeBookId
          : initialBooks[0].id;
        const activeBook = initialBooks.find((book) => book.id === requestedBookId) ?? initialBooks[0];
        const parsedCustomWords = activeBook.words;
        const parsed = normalizeProgress(activeBook.progress);
        const availableWords = parsedCustomWords.length ? parsedCustomWords : WORDS;
        const parsedStudyHistory = normalizeStudyHistory(activeBook.studyHistory);
        const initialSchedule = activeBook.schedule && activeBook.schedule.bookSignature === bookSignature(availableWords)
          ? normalizeChapterSchedule(activeBook.schedule, availableWords)
          : buildDefaultChapterSchedule(availableWords);
        setBookLibrary(initialBooks.map((book) => book.id === activeBook.id ? { ...book, schedule: initialSchedule } : book));
        setActiveBookId(activeBook.id);
        setBookName(activeBook.name);
        setBookNote(activeBook.note);
        setProgress(parsed);
        setStudyHistory(parsedStudyHistory);
        setCustomWords(parsedCustomWords);
        setChapterSchedule(initialSchedule);
        const sessionToday = localDateKey();
        const initialPlan = getScheduledChapterPlan(availableWords, parsed, initialSchedule, sessionToday);
        const next = chooseNextWord(initialPlan.selectedWords, parsed);
        const storedSession = activeBook.session;
        const reviewWordsForSession = availableWords.filter((word) => initialPlan.reviewNames.includes(chapterName(word)));
        const learnResumeWords = availableWords.filter((word) => initialPlan.studyNames.includes(chapterName(word)) && parsed[word.id]?.status !== "mastered");
        const storedModeWords = storedSession?.mode === "review"
          ? reviewWordsForSession
          : storedSession?.mode === "learn"
            ? learnResumeWords
            : [];
        const storedQueue = storedSession && Array.isArray(storedSession.queue)
          ? storedSession.queue.filter((id) => storedModeWords.some((word) => word.id === id))
          : storedSession
            ? (storedSession.lastAnswer === "known"
              ? storedModeWords.filter((word) => word.id !== storedSession.currentId).map((word) => word.id)
              : [storedSession.currentId, ...storedModeWords.filter((word) => word.id !== storedSession.currentId).map((word) => word.id)])
            : [];
        const sessionDateMatches = !storedSession?.date || storedSession.date === sessionToday;
        const hasStoredSession = storedSession
          && sessionDateMatches
          && (storedSession.mode === "review" || storedSession.mode === "learn")
          && typeof storedSession.currentId === "number"
          && (initialPlan.selectedWords.some((word) => word.id === storedSession.currentId) || storedQueue.length > 0);
        if (hasStoredSession) {
          setSessionQueue(storedQueue);
          setSessionDate(storedSession.date ?? sessionToday);
          if (storedSession.active === false) {
            setPendingSessionMode(storedSession.mode);
            setSessionMode("choose");
            setRevealed(false);
            setLastAnswer(null);
          } else {
            setCurrentId(storedSession.currentId);
            setSessionMode(storedSession.mode);
            setRevealed(storedSession.revealed === true);
            setLastAnswer(storedSession.lastAnswer === "known" || storedSession.lastAnswer === "unknown" ? storedSession.lastAnswer : null);
          }
        } else if (next) {
          setCurrentId(next.id);
          setSessionQueue([]);
          setSessionDate(null);
          setPendingSessionMode(null);
        }
      } catch {
        // A clean in-memory session is still useful when storage is unavailable.
      }
      setNow(Date.now());
      // Wait for the loaded state to commit before enabling persistence. Otherwise
      // the initial default state can overwrite the user's saved book on refresh.
      readyFrame = window.requestAnimationFrame(() => {
        persistenceReadyRef.current = true;
        setHydrated(true);
      });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (readyFrame) window.cancelAnimationFrame(readyFrame);
    };
  }, []);

  useEffect(() => {
    if (!hydrated || !persistenceReadyRef.current) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
      window.localStorage.setItem(CUSTOM_WORDS_KEY, JSON.stringify(customWords));
      window.localStorage.setItem(STUDY_HISTORY_KEY, JSON.stringify(studyHistory));
      const session = currentSessionState();
      const currentBook = currentBookSnapshot(session);
      window.localStorage.setItem(BOOK_STATE_KEY, JSON.stringify({
        ...currentBook,
        activeBookId,
        bookId: activeBookId,
        bookName,
        bookNote,
        books: persistedBookEntries(session),
      } satisfies StoredBookState));
    } catch {
      // The in-memory session remains usable when browser storage is unavailable.
    }
  }, [activeBookId, bookLibrary, bookName, bookNote, chapterSchedule, currentBookSnapshot, currentSessionState, persistedBookEntries, progress, customWords, studyHistory, hydrated]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const studiedToday = planWords.filter((word) => progress[word.id]?.status === "mastered" && progress[word.id]?.lastStudied === today).length;
  const learnedWords = allWords.filter((word) => Boolean(progress[word.id]));
  const masteredWords = allWords.filter((word) => progress[word.id]?.status === "mastered");
  const reviewWords = allWords.filter((word) => progress[word.id]?.status === "review");
  const completed = studiedToday;
  const progressPercent = Math.min(100, Math.round((completed / Math.max(1, targetWordCount)) * 100));
  const remainingCount = Math.max(0, allWords.length - masteredWords.length);
  const estimatedDays = Math.ceil(remainingCount / Math.max(1, targetWordCount));
  const estimatedCompletion = now ? formatCompletionDate(now + estimatedDays * DAY_MS) : "计算中";

  const reviewChapterWords = useMemo(
    () => activePlan.reviewNames.length
      ? allWords.filter((word) => activePlan.reviewNames.includes(chapterName(word)))
      : [],
    [activePlan, allWords],
  );
  const learnChapterWords = useMemo(
    () => activePlan.studyNames.length
      ? allWords.filter((word) => activePlan.studyNames.includes(chapterName(word)))
      : [],
    [activePlan, allWords],
  );
  const reviewSessionWords = useMemo(
    () => reviewChapterWords,
    [reviewChapterWords],
  );
  const learnSessionWords = useMemo(
    () => learnChapterWords.filter((word) => !progress[word.id]),
    [learnChapterWords, progress],
  );
  const queuedSessionWords = useMemo(
    () => sessionQueue.flatMap((id) => {
      const word = allWords.find((candidate) => candidate.id === id);
      return word ? [word] : [];
    }),
    [allWords, sessionQueue],
  );
  const hasPendingSession = Boolean(pendingSessionMode && sessionDate === today && sessionQueue.length);
  const reviewStartWords = hasPendingSession && pendingSessionMode === "review" ? queuedSessionWords : reviewSessionWords;
  const learnStartWords = hasPendingSession && pendingSessionMode === "learn" ? queuedSessionWords : learnSessionWords;
  const todayRecord = studyHistory[today];
  const todayCompleted = targetWordCount > 0 && completed >= targetWordCount;
  const studyStreak = countStudyStreak(studyHistory, today);
  const calendarDates = useMemo(() => {
    const date = dateFromKey(calendarCursor);
    if (calendarView === "month") return buildStudyMonth(date);
    if (calendarView === "day") return [date];
    return buildStudyWeek(date);
  }, [calendarCursor, calendarView]);
  const calendarTitle = formatCalendarTitle(calendarView, calendarCursor, today);
  const selectedCalendarRecord = studyHistory[calendarCursor];
  const dayHourlyCounts = selectedCalendarRecord?.hourlyCounts ?? EMPTY_HOURLY_COUNTS;
  const dayChartMax = Math.max(1, ...dayHourlyCounts);
  const dayChartPath = buildSmoothChartPath(dayHourlyCounts, dayChartMax);
  const dayChartTotal = dayHourlyCounts.reduce((total, count) => total + count, 0);
  const reviewPreviewWords = reviewStartWords.slice(0, 8);

  const activeList = activeTab === "review" ? reviewWords : masteredWords;
  const editingBook = bookLibrary.find((book) => book.id === editingBookId);
  const visibleBooks: StoredBookEntry[] = bookLibrary.length ? bookLibrary : [{
    id: activeBookId,
    name: bookName,
    note: bookNote,
    words: customWords,
    progress,
    schedule: effectiveSchedule,
    studyHistory,
  }];

  function startSession(mode: Exclude<SessionMode, "choose">) {
    const words = mode === "review" ? reviewStartWords : learnStartWords;
    if (!words.length) {
      setToast(mode === "review" ? "今日计划没有可复习的章节单词" : "今日计划的新词已经学完了");
      window.setTimeout(() => setToast(""), 2200);
      return;
    }
    const shouldResume = hasPendingSession && pendingSessionMode === mode && queuedSessionWords.length > 0;
    const nextQueue = shouldResume ? sessionQueue : words.map((word) => word.id);
    const next = allWords.find((word) => word.id === nextQueue[0]) ?? words[0];
    setSessionQueue(nextQueue);
    setSessionDate(today);
    setPendingSessionMode(null);
    setCurrentId(next.id);
    setSessionMode(mode);
    setRevealed(false);
    setLastAnswer(null);
  }

  function exitSession() {
    if (sessionMode === "learn" || sessionMode === "review") {
      setPendingSessionMode(sessionMode);
      setSessionDate(today);
    }
    setSessionMode("choose");
    setRevealed(false);
    setLastAnswer(null);
    setToast("当前学习进度已保存");
    window.setTimeout(() => setToast(""), 2200);
  }

  const chooseNext = useCallback(() => {
    if (sessionMode === "choose") return;
    const next = sessionQueue
      .map((id) => allWords.find((word) => word.id === id))
      .find((word): word is Word => Boolean(word));
    if (!next) {
      setSessionQueue([]);
      setSessionDate(null);
      setPendingSessionMode(null);
      setSessionMode("choose");
      setRevealed(false);
      setLastAnswer(null);
      setToast("本轮任务已完成，返回首页查看进度");
      window.setTimeout(() => setToast(""), 2400);
      return;
    }
    setCurrentId(next.id);
    setRevealed(false);
    setLastAnswer(null);
  }, [allWords, sessionMode, sessionQueue]);

  const answer = useCallback((type: "known" | "unknown") => {
    if (sessionMode === "choose") return;
    const answeredAt = new Date();
    const answeredDate = localDateKey(answeredAt);
    const answeredHour = localHour(answeredAt);
    const previousRecord = progress[currentId];
    const wasCompletedToday = previousRecord?.status === "mastered" && previousRecord.lastStudied === answeredDate;
    const nextRecord: ProgressRecord = type === "known"
      ? { status: "mastered", lastStudied: answeredDate, lastStudiedAt: answeredAt.toISOString() }
      : { status: "review", lastStudied: answeredDate, lastStudiedAt: answeredAt.toISOString() };
    const nextProgress = { ...progress, [currentId]: nextRecord };
    const nextStudiedCount = planWords.filter((word) => nextProgress[word.id]?.status === "mastered" && nextProgress[word.id]?.lastStudied === answeredDate).length;
    const queue = sessionQueue.length ? sessionQueue : [currentId];
    const queueWithoutCurrent = queue[0] === currentId ? queue.slice(1) : queue.filter((id) => id !== currentId);
    const nextQueue = type === "unknown" ? [...queueWithoutCurrent, currentId] : queueWithoutCurrent;
    setProgress(nextProgress);
    setSessionQueue(nextQueue);
    setSessionDate(answeredDate);
    setPendingSessionMode(null);
    setStudyHistory((current) => ({
      ...current,
      [answeredDate]: {
        studiedCount: nextStudiedCount,
        targetCount: targetWordCount,
        completed: nextStudiedCount >= targetWordCount,
        checkedIn: current[answeredDate]?.checkedIn === true,
        hourlyCounts: (() => {
          const counts = [...(current[answeredDate]?.hourlyCounts ?? EMPTY_HOURLY_COUNTS)];
          if (type === "known" && !wasCompletedToday) {
            counts[answeredHour] += 1;
          }
          if (type === "unknown" && wasCompletedToday && previousRecord?.lastStudiedAt) {
            const previousHour = localHour(new Date(previousRecord.lastStudiedAt));
            counts[previousHour] = Math.max(0, counts[previousHour] - 1);
          }
          return counts;
        })(),
      },
    }));
    setLastAnswer(type);
    setRevealed(true);
  }, [currentId, planWords, progress, sessionMode, sessionQueue, targetWordCount]);

  function resetProgress() {
    setProgress({});
    setStudyHistory((current) => {
      const next = { ...current };
      delete next[today];
      return next;
    });
    setCurrentId(allWords[0]?.id ?? 1);
    setSessionMode("choose");
    setSessionQueue([]);
    setSessionDate(null);
    setPendingSessionMode(null);
    setRevealed(false);
    setLastAnswer(null);
    setToast("学习进度已重置");
    window.setTimeout(() => setToast(""), 2200);
  }

  function checkInToday() {
    if (!todayCompleted) return;
    setStudyHistory((current) => ({
      ...current,
      [today]: {
        studiedCount: completed,
        targetCount: targetWordCount,
        completed: true,
        checkedIn: true,
        hourlyCounts: todayRecord?.hourlyCounts ?? [...EMPTY_HOURLY_COUNTS],
      },
    }));
    setToast("今日学习已打卡");
    window.setTimeout(() => setToast(""), 2200);
  }

  const removeProgressRecord = useCallback((wordId: number) => {
    const wasStudiedToday = progress[wordId]?.status === "mastered" && progress[wordId]?.lastStudied === today;
    const studiedAt = progress[wordId]?.lastStudiedAt;
    setProgress((current) => {
      const next = { ...current };
      delete next[wordId];
      return next;
    });
    if (wasStudiedToday) {
      setStudyHistory((current) => {
        const record = current[today];
        if (!record) return current;
        const studiedCount = Math.max(0, record.studiedCount - 1);
        const next = { ...current };
        const hourlyCounts = [...(record.hourlyCounts ?? EMPTY_HOURLY_COUNTS)];
        if (studiedAt) {
          const hour = localHour(new Date(studiedAt));
          hourlyCounts[hour] = Math.max(0, hourlyCounts[hour] - 1);
        }
        if (studiedCount === 0 && !record.checkedIn) {
          delete next[today];
        } else {
          next[today] = {
            ...record,
            studiedCount,
            completed: studiedCount >= record.targetCount,
            hourlyCounts,
          };
        }
        return next;
      });
    }
    if (wordId === currentId) {
      setLastAnswer(null);
      setRevealed(false);
    }
    setToast("已撤销本次选择");
    window.setTimeout(() => setToast(""), 2200);
  }, [currentId, progress, today]);

  const undoLastAnswer = useCallback(() => {
    if (!lastAnswer) return;
    setSessionQueue((current) => [currentId, ...current.filter((id) => id !== currentId)]);
    setSessionDate(today);
    setPendingSessionMode(null);
    removeProgressRecord(currentId);
  }, [currentId, lastAnswer, removeProgressRecord, today]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (showBookPanel) {
        if (event.key === "Escape") setShowBookPanel(false);
        return;
      }
      if (sessionMode === "choose") return;
      const targetTag = (event.target as HTMLElement)?.tagName ?? "";
      const isFormField = ["INPUT", "TEXTAREA", "SELECT"].includes(targetTag);
      if (revealed && !isFormField && !event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undoLastAnswer();
        return;
      }
      if (revealed && event.code === "Space" && !isFormField) {
        event.preventDefault();
        chooseNext();
        return;
      }
      if (revealed || ["BUTTON", "INPUT", "TEXTAREA"].includes(targetTag)) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        answer("unknown");
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        answer("known");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [answer, chooseNext, revealed, sessionMode, showBookPanel, undoLastAnswer]);

  function handleImport() {
    const nextId = allWords.reduce((highest, word) => Math.max(highest, word.id), 0) + 1;
    const { imported, errors } = parseWordImport(importText, nextId);
    if (!importText.trim()) {
      setImportError("请先粘贴词书内容");
      return;
    }
    if (errors.length) {
      setImportError(errors.slice(0, 3).join("\n"));
      return;
    }
    if (!imported.length) {
      setImportError("没有找到可导入的单词，请至少填写一行内容");
      return;
    }
    const previousProgressByWord = new Map(allWords.map((word) => [wordKey(word), progress[word.id]]));
    const nextProgress = Object.fromEntries(imported.flatMap((word) => {
      const record = previousProgressByWord.get(wordKey(word));
      return record ? [[word.id, record]] : [];
    })) as StoredProgress;
    const nextSignature = bookSignature(imported);
    const sameBook = nextSignature === bookSignature(allWords);
    const nextSchedule = chapterSchedule?.bookSignature === nextSignature
      ? normalizeChapterSchedule(chapterSchedule, imported)
      : buildDefaultChapterSchedule(imported, today);
    const previousBook = currentBookSnapshot(currentSessionState());
    const importedName = (selectedFileName.replace(/\.(txt|pdf)$/i, "").trim() || `自定义词书 ${bookLibrary.length + 1}`).slice(0, 60);
    const importedBook: StoredBookEntry = {
      id: `book-${Date.now()}-${hashText(nextSignature)}`,
      name: importedName,
      note: "从本地 TXT / PDF 导入",
      words: imported,
      progress: nextProgress,
      studyHistory: sameBook ? studyHistory : {},
      schedule: nextSchedule,
    };
    setBookLibrary((current) => {
      const base = current.length
        ? current.map((book) => book.id === activeBookId ? previousBook : book)
        : [previousBook];
      return [...base, importedBook];
    });
    setActiveBookId(importedBook.id);
    setBookName(importedBook.name);
    setBookNote(importedBook.note);
    setCustomWords(imported);
    setProgress(nextProgress);
    setStudyHistory(sameBook ? studyHistory : {});
    setChapterSchedule(nextSchedule);
    setCurrentId(imported[0].id);
    setSessionMode("choose");
    setSessionQueue([]);
    setSessionDate(null);
    setPendingSessionMode(null);
    setRevealed(false);
    setLastAnswer(null);
    setImportText("");
    setImportError("");
    setSelectedFileName("");
    setBookPanelMode("library");
    setShowBookPanel(true);
    setToast(`已导入 ${imported.length} 个单词，已切换当前词书`);
    window.setTimeout(() => setToast(""), 2400);
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const nextId = allWords.reduce((highest, word) => Math.max(highest, word.id), 0) + 1;
      const result = file.name.toLowerCase().endsWith(".pdf")
        ? await parsePdfImport(file, nextId)
        : parseWordImport(await file.text(), nextId);
      if (result.errors.length) {
        setImportError(result.errors.slice(0, 3).join("\n"));
        return;
      }
      const text = result.imported.map((word) => [
        `[${word.chapter ?? "未分组"}]`,
        `${word.word} | ${word.phonetic} | ${word.senses && word.senses.length > 1 ? word.senses.map((sense) => `${sense.part} ${sense.meaning}`).join("；") : word.meaning} | ${word.senses && word.senses.length > 1 ? word.senses.map((sense) => sense.part).join(" ") : word.part} | ${word.example}`,
      ].join("\n")).join("\n");
      setImportText(text);
      setSelectedFileName(file.name);
      setImportError("");
    } catch {
      setImportError("无法读取该文件，请确认它是可复制文本的 PDF 或符合格式的 TXT 文件");
    } finally {
      event.target.value = "";
    }
  }

  function exportBackup() {
    const session = currentSessionState();
    const payload: BackupPayload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      words: customWords.length ? customWords : allWords,
      progress,
      schedule: chapterSchedule ?? buildDefaultChapterSchedule(allWords, today),
      studyHistory,
      activeBookId,
      bookId: activeBookId,
      bookName,
      bookNote,
      books: persistedBookEntries(session),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = `jian-ci-backup-${today}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setToast("学习记录已导出");
    window.setTimeout(() => setToast(""), 2200);
  }

  function restoreBackup(rawText: string) {
    const parsed = JSON.parse(rawText) as Partial<BackupPayload>;
    const normalizedRestoredBooks = Array.isArray(parsed.books)
      ? parsed.books.flatMap((book) => {
        const normalized = normalizeStoredBookEntry(book);
        return normalized ? [normalized] : [];
      })
      : [];
    const restoredBooks = normalizedRestoredBooks;
    if (restoredBooks.length) {
      const requestedBookId = typeof parsed.activeBookId === "string" ? parsed.activeBookId : restoredBooks[0].id;
      const activeBook = restoredBooks.find((book) => book.id === requestedBookId) ?? restoredBooks[0];
      const restoredWords = activeBook.words;
      const availableWords = restoredWords.length ? restoredWords : WORDS;
      const restoredSchedule = activeBook.schedule && activeBook.schedule.bookSignature === bookSignature(availableWords)
        ? normalizeChapterSchedule(activeBook.schedule, availableWords)
        : buildDefaultChapterSchedule(availableWords, today);
      const restoredPlan = getScheduledChapterPlan(availableWords, activeBook.progress, restoredSchedule, today);
      const next = chooseNextWord(restoredPlan.selectedWords, activeBook.progress);
      setBookLibrary(restoredBooks.map((book) => book.id === activeBook.id ? { ...book, schedule: restoredSchedule } : book));
      setActiveBookId(activeBook.id);
      setBookName(activeBook.name);
      setBookNote(activeBook.note);
      setCustomWords(restoredWords);
      setProgress(activeBook.progress);
      setStudyHistory(activeBook.studyHistory);
      setChapterSchedule(restoredSchedule);
      setCurrentId(next?.id ?? availableWords[0]?.id ?? 1);
      setSessionMode("choose");
      setSessionQueue([]);
      setSessionDate(null);
      setPendingSessionMode(null);
      setRevealed(false);
      setLastAnswer(null);
      setToast(`已恢复 ${restoredBooks.length} 本词书和学习记录`);
      window.setTimeout(() => setToast(""), 2600);
      return;
    }
    if (parsed.version !== 1 || !Array.isArray(parsed.words) || !parsed.words.length) {
      throw new Error("invalid backup");
    }
    const restoredWords = normalizeStoredWords(parsed.words);
    if (!restoredWords.length) throw new Error("empty backup");
    const restoredProgress = normalizeProgress(parsed.progress);
    const restoredSchedule = parsed.schedule && typeof parsed.schedule === "object"
      ? normalizeChapterSchedule(parsed.schedule, restoredWords)
      : buildDefaultChapterSchedule(restoredWords, today);
    const restoredBookId = typeof parsed.bookId === "string" ? parsed.bookId : `restored-${Date.now()}`;
    setCustomWords(restoredWords);
    setActiveBookId(restoredBookId);
    setBookName(normalizeBookName(
      typeof parsed.bookName === "string" && parsed.bookName.trim() ? parsed.bookName : "恢复的词书",
      typeof parsed.bookNote === "string" ? parsed.bookNote : "",
    ));
    setBookNote(typeof parsed.bookNote === "string" ? parsed.bookNote : "从备份恢复");
    setProgress(restoredProgress);
    setStudyHistory(normalizeStudyHistory(parsed.studyHistory));
    setChapterSchedule(restoredSchedule);
    setBookLibrary([{
      id: restoredBookId,
      name: normalizeBookName(
        typeof parsed.bookName === "string" && parsed.bookName.trim() ? parsed.bookName : "恢复的词书",
        typeof parsed.bookNote === "string" ? parsed.bookNote : "",
      ),
      note: typeof parsed.bookNote === "string" ? parsed.bookNote : "从备份恢复",
      words: restoredWords,
      progress: restoredProgress,
      schedule: restoredSchedule,
      studyHistory: normalizeStudyHistory(parsed.studyHistory),
    }]);
    setCurrentId(restoredWords[0].id);
    setSessionMode("choose");
    setSessionQueue([]);
    setSessionDate(null);
    setPendingSessionMode(null);
    setRevealed(false);
    setLastAnswer(null);
    setToast(`已恢复 ${restoredWords.length} 个单词和学习记录`);
    window.setTimeout(() => setToast(""), 2600);
  }

  async function handleBackupFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      restoreBackup(await file.text());
    } catch {
      setToast("备份文件格式不正确");
      window.setTimeout(() => setToast(""), 2400);
    } finally {
      event.target.value = "";
    }
  }

  function switchBook(bookId: string) {
    const target = bookLibrary.find((book) => book.id === bookId);
    if (!target || target.id === activeBookId) {
      if (target) setShowBookPanel(false);
      return;
    }
    const currentSession = currentSessionState();
    const current = currentBookSnapshot(currentSession);
    setBookLibrary((books) => books.map((book) => book.id === activeBookId ? current : book));
    const targetWords = target.words.length ? target.words : WORDS;
    const targetSchedule = target.schedule && target.schedule.bookSignature === bookSignature(targetWords)
      ? normalizeChapterSchedule(target.schedule, targetWords)
      : buildDefaultChapterSchedule(targetWords, today);
    const targetPlan = getScheduledChapterPlan(targetWords, target.progress, targetSchedule, today);
    const storedSession = target.session;
    const canRestoreSession = storedSession
      && storedSession.active !== false
      && (storedSession.mode === "learn" || storedSession.mode === "review")
      && targetPlan.selectedWords.some((word) => word.id === storedSession.currentId);
    const canResumePending = storedSession
      && storedSession.active === false
      && (storedSession.mode === "learn" || storedSession.mode === "review")
      && Array.isArray(storedSession.queue)
      && storedSession.queue.some((id) => targetWords.some((word) => word.id === id));
    const next = chooseNextWord(targetPlan.selectedWords, target.progress);
    const restoredQueue = canRestoreSession && Array.isArray(storedSession.queue)
      ? storedSession.queue.filter((id) => targetWords.some((word) => word.id === id))
      : [];
    setActiveBookId(target.id);
    setBookName(target.name);
    setBookNote(target.note);
    setCustomWords(target.words);
    setProgress(target.progress);
    setStudyHistory(target.studyHistory);
    setChapterSchedule(targetSchedule);
    setCurrentId(canRestoreSession ? storedSession.currentId : next?.id ?? targetWords[0]?.id ?? 1);
    setSessionMode(canRestoreSession ? storedSession.mode : "choose");
    setSessionQueue(restoredQueue);
    setSessionDate(canRestoreSession || canResumePending ? storedSession.date ?? today : null);
    setPendingSessionMode(canResumePending ? storedSession.mode : null);
    setRevealed(canRestoreSession ? storedSession.revealed === true : false);
    setLastAnswer(canRestoreSession && (storedSession.lastAnswer === "known" || storedSession.lastAnswer === "unknown") ? storedSession.lastAnswer : null);
    setShowBookPanel(false);
    setToast(`已切换到「${target.name}」`);
    window.setTimeout(() => setToast(""), 2200);
  }

  function openBookNameEditor(book: StoredBookEntry) {
    setEditingBookId(book.id);
    setBookNameDraft(book.name);
    setBookPanelMode("edit");
  }

  function saveBookName() {
    if (!editingBookId) return;
    const nextName = bookNameDraft.trim();
    if (!nextName) {
      setToast("词书名称不能为空");
      window.setTimeout(() => setToast(""), 2200);
      return;
    }
    setBookLibrary((books) => books.map((book) => book.id === editingBookId ? { ...book, name: nextName } : book));
    if (editingBookId === activeBookId) setBookName(nextName);
    setBookPanelMode("library");
    setToast("词书名称已保存");
    window.setTimeout(() => setToast(""), 2200);
  }

  function deleteBook(bookId: string) {
    const sourceBooks = bookLibrary.length ? bookLibrary : [currentBookSnapshot(currentSessionState())];
    const target = sourceBooks.find((book) => book.id === bookId);
    if (!target) return;
    if (sourceBooks.length <= 1) {
      setToast("至少保留一本词书，暂时不能删除");
      window.setTimeout(() => setToast(""), 2200);
      return;
    }
    if (!window.confirm(`确定删除「${target.name}」吗？这本词书的学习进度、计划和打卡记录也会被删除。`)) return;

    const currentSession = currentSessionState();
    const current = currentBookSnapshot(currentSession);
    const booksWithCurrent = sourceBooks.map((book) => book.id === activeBookId ? current : book);
    const remainingBooks = booksWithCurrent.filter((book) => book.id !== bookId);
    setEditingBookId((editingId) => editingId === bookId ? null : editingId);

    if (bookId !== activeBookId) {
      setBookLibrary(remainingBooks);
      setToast(`已删除「${target.name}」`);
      window.setTimeout(() => setToast(""), 2200);
      return;
    }

    const nextBook = remainingBooks[0];
    const nextWords = nextBook.words.length ? nextBook.words : WORDS;
    const nextSchedule = nextBook.schedule && nextBook.schedule.bookSignature === bookSignature(nextWords)
      ? normalizeChapterSchedule(nextBook.schedule, nextWords)
      : buildDefaultChapterSchedule(nextWords, today);
    const nextPlan = getScheduledChapterPlan(nextWords, nextBook.progress, nextSchedule, today);
    const storedSession = nextBook.session;
    const canRestoreSession = storedSession
      && storedSession.active !== false
      && (storedSession.mode === "learn" || storedSession.mode === "review")
      && nextPlan.selectedWords.some((word) => word.id === storedSession.currentId);
    const canResumePending = storedSession
      && storedSession.active === false
      && (storedSession.mode === "learn" || storedSession.mode === "review")
      && Array.isArray(storedSession.queue)
      && storedSession.queue.some((id) => nextWords.some((word) => word.id === id));
    const next = chooseNextWord(nextPlan.selectedWords, nextBook.progress);
    const normalizedNextBook = { ...nextBook, schedule: nextSchedule };
    const restoredQueue = canRestoreSession && Array.isArray(storedSession.queue)
      ? storedSession.queue.filter((id) => nextWords.some((word) => word.id === id))
      : [];

    setBookLibrary([normalizedNextBook, ...remainingBooks.slice(1)]);
    setActiveBookId(normalizedNextBook.id);
    setBookName(normalizedNextBook.name);
    setBookNote(normalizedNextBook.note);
    setCustomWords(normalizedNextBook.words);
    setProgress(normalizedNextBook.progress);
    setStudyHistory(normalizedNextBook.studyHistory);
    setChapterSchedule(nextSchedule);
    setCurrentId(canRestoreSession ? storedSession.currentId : next?.id ?? nextWords[0]?.id ?? 1);
    setSessionMode(canRestoreSession ? storedSession.mode : "choose");
    setSessionQueue(restoredQueue);
    setSessionDate(canRestoreSession || canResumePending ? storedSession.date ?? today : null);
    setPendingSessionMode(canResumePending ? storedSession.mode : null);
    setRevealed(canRestoreSession ? storedSession.revealed === true : false);
    setLastAnswer(canRestoreSession && (storedSession.lastAnswer === "known" || storedSession.lastAnswer === "unknown") ? storedSession.lastAnswer : null);
    setBookPanelMode("library");
    setToast(`已删除「${target.name}」，已切换到「${normalizedNextBook.name}」`);
    window.setTimeout(() => setToast(""), 2400);
  }

  function updateScheduleDay(dayIndex: number, changes: Partial<DailyChapterPlan>) {
    setChapterSchedule((current) => {
      const base = current ?? buildDefaultChapterSchedule(allWords, today);
      const days = base.days.map((day, index) => index === dayIndex ? { ...day, ...changes } : day);
      return { ...base, bookSignature: bookSignature(allWords), days };
    });
  }

  function updateScheduleStartDate(startDate: string) {
    if (!startDate) return;
    setChapterSchedule((current) => ({
      ...(current ?? buildDefaultChapterSchedule(allWords, startDate)),
      startDate,
      bookSignature: bookSignature(allWords),
    }));
  }

  function toggleScheduleChapter(dayIndex: number, field: "study" | "review", name: string) {
    const day = effectiveSchedule.days[dayIndex];
    if (!day) return;
    const names = day[field];
    const nextNames = names.includes(name) ? names.filter((item) => item !== name) : [...names, name];
    updateScheduleDay(dayIndex, { [field]: nextNames });
  }

  const greeting = getTimeGreeting(now ? new Date(now) : new Date(), todayCompleted, studiedToday);

  return (
    <main className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside id="main-sidebar" className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Icon name="book" /></div>
          <div className="brand-copy"><strong>简辞</strong><span>Simple Dictionary</span></div>
          <button className="sidebar-toggle" type="button" aria-label={sidebarCollapsed ? "展开侧边栏" : "折叠侧边栏"} aria-expanded={!sidebarCollapsed} aria-controls="main-sidebar" title={sidebarCollapsed ? "展开侧边栏" : "折叠侧边栏"} onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}><span className="sidebar-toggle-icon" aria-hidden="true" /></button>
        </div>

        <nav className="main-nav" aria-label="主导航">
          <button className={`nav-item ${showBookPanel ? "" : "active"}`} type="button" aria-label="今日学习" title="今日学习" onClick={() => { setShowBookPanel(false); if (sessionMode === "learn" || sessionMode === "review") exitSession(); else setSessionMode("choose"); }}><span className="nav-icon"><Icon name="clock" /></span><span className="nav-label">今日学习</span><span className="nav-badge">{completed} / {targetWordCount}</span></button>
          <button className={`nav-item ${showBookPanel ? "active" : ""}`} type="button" aria-label="我的词书" title="我的词书" onClick={() => { setImportError(""); setBookPanelMode("library"); setShowBookPanel(true); }}><span className="nav-icon"><Icon name="stack" /></span><span className="nav-label">我的词书</span></button>
        </nav>

      </aside>

      <section className="content">
        <header className="topbar">
          <div><p className="eyebrow">{formatDate()}</p><h1>{greeting}</h1></div>
        </header>

        <div className="dashboard-grid">
          <section className="study-column" aria-label={sessionMode === "choose" ? "今日任务选择" : "单词学习区"}>
            {sessionMode === "choose" ? <div className="session-chooser">
              <div className="session-calendar-panel">
                <div className="session-calendar-header"><div><span className="section-kicker">学习日历 · 第 {activePlan.dayIndex + 1} 天</span><h2>{calendarTitle}</h2></div><div className="session-calendar-streak"><strong>{studyStreak} 天</strong><span>连续学习</span></div></div>
                <div className="calendar-toolbar"><div className="calendar-view-switcher" role="tablist" aria-label="日历范围">{(["month", "week", "day"] as const).map((view) => <button key={view} type="button" role="tab" aria-selected={calendarView === view} className={`calendar-view-button ${calendarView === view ? "selected" : ""}`} onClick={() => setCalendarView(view)}>{view === "month" ? "月" : view === "week" ? "周" : "日"}</button>)}</div><div className="calendar-nav"><button type="button" aria-label={`上一个${calendarView === "month" ? "月" : calendarView === "week" ? "周" : "日"}`} onClick={() => setCalendarCursor(shiftCalendarCursor(calendarCursor, calendarView, -1))}>‹</button><button type="button" onClick={() => setCalendarCursor(today)}>今天</button><button type="button" aria-label={`下一个${calendarView === "month" ? "月" : calendarView === "week" ? "周" : "日"}`} onClick={() => setCalendarCursor(shiftCalendarCursor(calendarCursor, calendarView, 1))}>›</button></div></div>
                {calendarView === "month" && <div className="calendar-month-grid" aria-label="月打卡日历">{WEEKDAY_LABELS.map((label) => <span className="calendar-month-weekday" key={`month-weekday-${label}`}>{label}</span>)}{calendarDates.map((date) => { const dateKey = localDateKey(date); const record = studyHistory[dateKey]; const status = record?.checkedIn ? "done" : dateKey > today ? "future" : "missed"; const isCurrentMonth = date.getUTCMonth() === dateFromKey(calendarCursor).getUTCMonth(); return <button type="button" className={`calendar-month-cell ${status} ${dateKey === today ? "today" : ""} ${isCurrentMonth ? "" : "outside"}`} key={`month-${dateKey}`} onClick={() => { setCalendarView("day"); setCalendarCursor(dateKey); }}><strong>{Number(dateKey.slice(-2))}</strong><span>{record?.studiedCount ?? 0} 词</span><i className={`calendar-dot ${status}`} /></button>; })}</div>}
                {calendarView === "week" && <div className="session-calendar-week" aria-label="周打卡日历">{calendarDates.map((date) => { const dateKey = localDateKey(date); const record = studyHistory[dateKey]; const status = record?.checkedIn ? "done" : dateKey > today ? "future" : "missed"; const weekdayIndex = (date.getUTCDay() + 6) % 7; return <button type="button" className={`session-calendar-day ${status} ${dateKey === today ? "today" : ""}`} key={`session-calendar-${dateKey}`} onClick={() => { setCalendarView("day"); setCalendarCursor(dateKey); }}><span>{WEEKDAY_LABELS[weekdayIndex]}</span><strong>{Number(dateKey.slice(-2))}</strong><small>{record?.studiedCount ?? 0} 词</small><i className={`calendar-dot ${status} ${dateKey === today ? "current" : ""}`} /></button>; })}</div>}
                {calendarView === "day" && <div className="calendar-day-view" aria-label="日学习曲线"><div className="day-chart-heading"><div><strong>{calendarCursor === today ? "今日学习曲线" : `${calendarCursor} 学习曲线`}</strong><span>{dayChartTotal} 个单词 · 按完成时间统计</span></div><span className={`calendar-status-pill ${selectedCalendarRecord?.checkedIn ? "done" : ""}`}>{selectedCalendarRecord?.checkedIn ? "已打卡" : calendarCursor > today ? "未开始" : "未打卡"}</span></div><div className="day-chart"><svg className="day-chart-svg" viewBox="0 0 100 100" role="img" aria-label="按小时统计的学习单词数量"><line x1="0" y1="88" x2="100" y2="88" /><line x1="0" y1="53" x2="100" y2="53" /><line x1="0" y1="18" x2="100" y2="18" /><path className="day-chart-line" d={dayChartPath} /></svg><div className="day-chart-labels"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div></div></div>}
                <div className={`session-calendar-footer ${todayCompleted ? "ready" : ""} ${todayRecord?.checkedIn ? "done" : ""}`}><div><strong>{todayRecord?.checkedIn ? "今日已打卡" : todayCompleted ? "今日任务已完成" : "今日学习进度"}</strong><span>{completed} / {targetWordCount} 个单词 · {todayRecord?.checkedIn ? "记录已保存到日历" : `还差 ${Math.max(0, targetWordCount - completed)} 个单词`}</span></div>{todayCompleted && !todayRecord?.checkedIn && <button type="button" onClick={checkInToday}>今日打卡</button>}</div>
                <div className="calendar-estimate"><div><span>预计完成</span><strong>{estimatedCompletion}</strong></div><small>按当前章节计划估算</small></div>
              </div>
              <div className="session-choice-grid">
                <button className="session-choice review" type="button" disabled={!reviewStartWords.length} onClick={() => startSession("review")}><span className="session-choice-icon">↻</span><span><strong>复习旧词</strong><small>{reviewStartWords.length ? `${reviewStartWords.length} 个章节单词` : "今日计划没有复习单词"}</small></span><Icon name="arrow" /></button>
                <button className="session-choice learn" type="button" disabled={!learnStartWords.length} onClick={() => startSession("learn")}><span className="session-choice-icon">＋</span><span><strong>学习新词</strong><small>{learnStartWords.length ? `${learnStartWords.length} 个新单词` : "今天的新词已经学完"}</small></span><Icon name="arrow" /></button>
              </div>
              <section className="review-list-preview" data-testid="review-list-preview" aria-label="今日复习列表"><div className="review-list-heading"><div><span className="section-kicker">严格按章节</span><strong>今日复习列表</strong></div><span>{reviewStartWords.length} 个词</span></div>{reviewPreviewWords.length ? <div className="review-list-items">{reviewPreviewWords.map((word) => <div className="review-list-item" key={word.id}><strong>{word.word}</strong><span>{chapterName(word)} · {word.meaning}</span></div>)}</div> : <p className="review-list-empty">{activePlan.reviewNames.length ? "所选章节暂无可复习单词" : "今日计划没有安排复习章节"}</p>}{reviewStartWords.length > reviewPreviewWords.length && <p className="review-list-more">还有 {reviewStartWords.length - reviewPreviewWords.length} 个词，进入复习后继续</p>}</section>
            </div> : <>
            <div className="session-heading"><div><span className="section-kicker">今日计划 · 第 {activePlan.dayIndex + 1} 天 · {sessionMode === "review" ? (activePlan.reviewNames.length ? activePlan.reviewNames.join("、") : "章节复习") : (activePlan.studyNames.length ? activePlan.studyNames.join("、") : "新词")}</span><h2>{sessionMode === "review" ? "复习旧词" : "学习新词"}</h2></div><div className="session-heading-actions"><span className="queue-count">{queuedSessionWords.length} 个待完成</span><button className="exit-session-button" type="button" onClick={exitSession}>退出学习</button></div></div>

            <article className={`word-card ${revealed ? "is-revealed" : ""}`}>
              <div className="word-card-top"><span className="word-tag">{currentWord.tag}</span></div>
              <div className="word-display"><h3>{currentWord.word}</h3><div className="word-meta"><span>{currentWord.phonetic}</span></div></div>
              {!revealed ? <p className="prompt">先凭直觉回想它的意思，再选择你的答案</p> : <div className="answer-reveal"><div className="meaning-line"><div className="meaning-sense-list">{getWordSenses(currentWord).map((sense) => <div className="meaning-sense" key={`${sense.part}-${sense.meaning}`}><b>{sense.part}</b><strong>{sense.meaning}</strong></div>)}</div></div>{shouldShowDefinition(currentWord.definition) && <p className="definition">{currentWord.definition}</p>}{shouldShowExample(currentWord.example) && <div className="example-block"><span className="example-label">例句</span><p>{currentWord.example}</p>{currentWord.translation.trim() && <p className="translation">{currentWord.translation}</p>}</div>}</div>}
              {revealed && lastAnswer && <div className={`answer-note answer-note-top ${lastAnswer}`}><span>{lastAnswer === "known" ? "✓" : "↻"}</span>{lastAnswer === "known" ? "已答对，移出当前队列" : "已排到队尾，稍后再次出现"}</div>}
              <div className={`card-divider ${revealed ? "revealed-divider" : ""}`} />
              {!revealed ? <div className="answer-buttons"><button className="answer-button unknown" type="button" onClick={() => answer("unknown")}><span className="answer-symbol">×</span><span><strong>不认识</strong><small>排到队尾，稍后再刷</small></span><span className="key-hint">←</span></button><button className="answer-button known" type="button" onClick={() => answer("known")}><span className="answer-symbol">✓</span><span><strong>认识</strong><small>答对并移出本轮</small></span><span className="key-hint">→</span></button></div> : <div className="revealed-actions"><button className="undo-answer-button" type="button" onClick={undoLastAnswer} aria-label="撤销本次选择，快捷键 Z"><span>撤销本次选择</span><span className="action-key">Z</span></button><button className="next-button" type="button" onClick={chooseNext}><span>{queuedSessionWords.length ? "下一个单词" : "完成本轮"}</span><span className="action-key next-key">Space</span><Icon name="arrow" /></button></div>}
            </article>
            <p className="keyboard-note">使用键盘 <kbd>←</kbd> 不认识 · <kbd>→</kbd> 认识 · <kbd>Space</kbd> 下一个单词 · <kbd>Z</kbd> 撤销</p>

            </>}
          </section>

          <aside className="stats-column" aria-label="学习进度">
            <section className="progress-panel panel"><div className="panel-heading"><div><span className="section-kicker">今日进度</span><h3>{bookName}</h3></div><button type="button" className="more-button" onClick={resetProgress} aria-label="重置学习进度">重置</button></div><div className="ring-row"><div className="progress-ring" style={{ "--progress": `${progressPercent * 3.6}deg` } as React.CSSProperties}><div><strong>{progressPercent}%</strong><span>完成</span></div></div><div className="progress-copy"><strong>{completed} <em>/ {targetWordCount}</em></strong><span>今日计划已学单词</span><p>{progressPercent >= 100 ? "今日计划已完成" : `还差 ${Math.max(0, targetWordCount - completed)} 个单词`}</p></div></div><div className="progress-bar"><span style={{ width: `${progressPercent}%` }} /></div><div className="goal-row"><span>今日计划</span><div className="goal-actions"><strong>{targetWordCount} 个单词</strong><button type="button" className="goal-edit-button" aria-expanded={showScheduleEditor} aria-controls="chapter-schedule-editor" onClick={() => setShowScheduleEditor((open) => !open)}><Icon name="sliders" /><span>{showScheduleEditor ? "收起计划" : "编辑学习计划"}</span></button></div></div>{showScheduleEditor && <div id="chapter-schedule-editor" className="chapter-schedule-editor"><div className="schedule-editor-heading"><div><strong>每日章节计划</strong><p>每天可直接点击多个学习章节和多个复习章节；学习与复习都严格按这里的章节执行。</p></div><label htmlFor="schedule-start-date">开始日期<input id="schedule-start-date" type="date" value={effectiveSchedule.startDate} onChange={(event) => updateScheduleStartDate(event.target.value)} /></label></div><div className="schedule-table" role="table" aria-label="每日章节计划"><div className="schedule-row schedule-header" role="row"><span>日期</span><span>学习章节（可多选）</span><span>复习章节（可多选）</span></div>{effectiveSchedule.days.map((day, index) => { const dayDate = localDateKey(new Date(dateFromKey(effectiveSchedule.startDate).getTime() + index * DAY_MS)); return <div className={`schedule-row ${index === activePlan.dayIndex ? "is-today" : ""}`} role="row" key={`schedule-${index}`}><span className="schedule-day">第 {index + 1} 天<small>{dayDate}</small></span><div className="chapter-picker" aria-label={`第 ${index + 1} 天学习章节`}><button type="button" className={`chapter-choice empty-choice ${day.study.length === 0 ? "selected" : ""}`} aria-pressed={day.study.length === 0} onClick={() => updateScheduleDay(index, { study: [] })}>不安排</button>{scheduleChapterNames.map((name) => <button type="button" className={`chapter-choice ${day.study.includes(name) ? "selected" : ""}`} aria-pressed={day.study.includes(name)} key={`study-${index}-${name}`} onClick={() => toggleScheduleChapter(index, "study", name)}>{name}</button>)}</div><div className="chapter-picker" aria-label={`第 ${index + 1} 天复习章节`}><button type="button" className={`chapter-choice empty-choice ${day.review.length === 0 ? "selected" : ""}`} aria-pressed={day.review.length === 0} onClick={() => updateScheduleDay(index, { review: [] })}>不安排</button>{scheduleChapterNames.map((name) => <button type="button" className={`chapter-choice ${day.review.includes(name) ? "selected" : ""}`} aria-pressed={day.review.includes(name)} key={`review-${index}-${name}`} onClick={() => toggleScheduleChapter(index, "review", name)}>{name}</button>)}</div></div>; })}</div><p className="schedule-help">直接点击章节即可跳着多选，再次点击取消；绿色行是今天，修改会自动保存。</p><div className="backup-row"><span>本地学习数据</span><div><button type="button" className="backup-button" onClick={exportBackup}>导出备份</button><input ref={backupInputRef} id="backup-upload" className="sr-only" type="file" accept=".json,application/json" onChange={handleBackupFileChange} /><label className="backup-button" htmlFor="backup-upload">导入备份</label></div></div></div>}<div className="completion-estimate">今天是第 {activePlan.dayIndex + 1} 天 · 按当前计划预计 <strong>{estimatedCompletion}</strong> 完成</div></section>

            <section className="queue-panel panel"><div className="panel-heading"><div><span className="section-kicker">我的单词本</span><h3>{activeTab === "review" ? "待复习" : "已掌握"}</h3></div><div className="queue-total">{activeList.length}</div></div><div className="tabs" role="tablist"><button type="button" role="tab" aria-selected={activeTab === "review"} className={activeTab === "review" ? "selected" : ""} onClick={() => setActiveTab("review")}>待复习 <span>{reviewWords.length}</span></button><button type="button" role="tab" aria-selected={activeTab === "mastered"} className={activeTab === "mastered" ? "selected" : ""} onClick={() => setActiveTab("mastered")}>已掌握 <span>{masteredWords.length}</span></button></div><div className="word-list">{activeList.length === 0 ? <div className="empty-list"><span>✦</span><p>{activeTab === "review" ? "答错的词会出现在这里" : "认识的词会出现在这里"}</p></div> : activeList.map((word) => <button className="list-word" type="button" key={word.id} onClick={() => { setCurrentId(word.id); setRevealed(false); setLastAnswer(null); }}><div><strong>{word.word}</strong><span>{word.meaning}</span></div><small>{activeTab === "review" ? `${chapterName(word)} · 章节复习` : "已掌握"}</small></button>)}</div><button className="view-all" type="button" onClick={() => setActiveTab(activeTab === "review" ? "mastered" : "review")}>查看{activeTab === "review" ? "已掌握" : "待复习"} <Icon name="arrow" /></button></section>

          </aside>
        </div>
      </section>
      {showBookPanel && <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowBookPanel(false)}><section className={`book-modal ${bookPanelMode === "view" ? "book-modal-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="book-panel-title" onMouseDown={(event) => event.stopPropagation()}>
        {bookPanelMode === "library" && <>
          <div className="modal-heading"><div><span className="section-kicker">词书管理</span><h2 id="book-panel-title">我的词书</h2></div><button type="button" className="modal-close" aria-label="关闭词书窗口" onClick={() => setShowBookPanel(false)}>×</button></div>
          <p className="modal-intro">在这里切换当前词书、查看章节内容、编辑名称或删除词书。每本词书的学习进度、计划和打卡记录都会独立保存。</p>
          <div className="book-library-list" aria-label="词书列表">
            {visibleBooks.map((book) => {
              const isActive = book.id === activeBookId;
              const words = book.words.length ? book.words : WORDS;
              const learnedCount = words.filter((word) => Boolean(book.progress[word.id])).length;
              return <article className={`book-library-item ${isActive ? "active" : ""}`} key={book.id}>
                <div className="book-library-main"><div className="book-summary-icon"><Icon name="book" /></div><div className="book-library-copy"><strong>{book.name}</strong><span>{words.length} 个单词 · {chapterNames(words).length} 个章节 · 已学 {learnedCount} 个</span></div></div>
                <div className="book-library-actions"><button type="button" className={`book-library-action ${isActive ? "current" : ""}`} disabled={isActive} onClick={() => switchBook(book.id)}>{isActive ? "正在使用" : "切换词书"}</button><button type="button" className="book-library-action" disabled={!isActive} onClick={() => setBookPanelMode("view")}>查看词书</button><button type="button" className="book-library-action" onClick={() => openBookNameEditor(book)}>编辑名称</button><button type="button" className="book-library-action danger" aria-label={`删除词书「${book.name}」`} onClick={() => deleteBook(book.id)}>删除</button></div>
              </article>;
            })}
          </div>
          <div className="book-library-footer"><button type="button" className="modal-primary" onClick={() => { setImportError(""); setBookPanelMode("import"); }}>导入 TXT / PDF</button><span>导入会新增一套独立词书，不覆盖已有学习记录。</span></div>
          <div className="book-help-card"><strong>导入格式</strong><p>用 <code>[List 01]</code> 作为章节标题，下面每行填写“单词 | 音标 | 中文释义 | 词性 | 例句（可选）”。PDF 会自动识别音标。</p></div>
        </>}
        {bookPanelMode === "view" && <><div className="modal-heading"><div><span className="section-kicker">我的词书 · 查看</span><h2 id="book-panel-title">{bookName}</h2></div><button type="button" className="modal-close" aria-label="关闭词书窗口" onClick={() => setShowBookPanel(false)}>×</button></div><div className="book-view-toolbar"><span>共 {allWords.length} 个单词 · {bookChapterGroups.length} 个章节 · 已学 {learnedWords.length} 个</span><div><button type="button" className="link-button" onClick={() => setBookPanelMode("library")}>返回我的词书</button><button type="button" className="link-button" onClick={() => { setImportError(""); setBookPanelMode("import"); }}>导入 TXT / PDF</button></div></div><div className="chapter-list">{bookChapterGroups.length ? bookChapterGroups.map((group) => <section className="chapter-group" key={group.name}><div className="chapter-group-heading"><strong>{group.name}</strong><span>{group.words.length} 个单词 · 已学 {group.words.filter((word) => Boolean(progress[word.id])).length}</span></div>{group.words.map((word) => <button className="chapter-word-row" type="button" key={word.id} onClick={() => { setCurrentId(word.id); setRevealed(false); setLastAnswer(null); setShowBookPanel(false); }}><div><strong>{word.word}</strong><span>{word.phonetic} · {word.meaning}</span></div><small>{progress[word.id]?.status === "mastered" ? "已掌握" : progress[word.id]?.status === "review" ? "待复习" : word.part}</small></button>)}</section>) : <div className="book-empty"><span>✦</span><strong>还没有可查看的单词</strong><p>先导入一份 TXT 词书吧。</p></div>}</div></>}
        {bookPanelMode === "import" && <><div className="modal-heading"><div><span className="section-kicker">我的词书 · 导入</span><h2 id="book-panel-title">导入 TXT / PDF 词书</h2></div><button type="button" className="modal-close" aria-label="关闭词书窗口" onClick={() => setShowBookPanel(false)}>×</button></div><p className="modal-intro">支持本地 `.txt` 和可复制文本的 `.pdf` 文件，也可以直接粘贴文本。章节标题会自动成为每日学习单元，导入后会新增一套独立词书，不覆盖已有记录。</p><div className="txt-file-row"><input ref={fileInputRef} id="txt-upload" className="sr-only" type="file" accept=".txt,.pdf,text/plain,application/pdf" onChange={handleFileChange} /><label htmlFor="txt-upload" className="file-picker">选择 TXT / PDF 文件</label>{selectedFileName ? <span className="selected-file">{selectedFileName}</span> : <span>也可以直接粘贴到下方</span>}</div><div className="format-guide"><strong>TXT 导入格式（音标为第二列）</strong><code>[List 01]\nsummary | [&apos;sʌməri] | 总结；概要 | n. |\nmarine | [mə&apos;ri:n] | adj. 海洋的；n. 海军陆战队士兵 | adj. n. |</code><span>TXT 使用“章节标题 + 单词 | 音标 | 中文释义 | 词性 | 例句（可选）”；多词性释义请在释义前写对应词性，例如“adj. 海洋的；n. 海军陆战队士兵”，系统会分行展示。PDF 会自动识别单词、音标、释义和词性。扫描图片型 PDF 暂不支持。</span></div><textarea className="import-textarea" aria-label="词书内容" value={importText} onChange={(event) => { setImportText(event.target.value); setImportError(""); }} placeholder={"[List 01]\nsummary | ['sʌməri] | 总结；概要 | n. |\nmarine | [mə'ri:n] | adj. 海洋的；n. 海军陆战队士兵 | adj. n. |"} rows={8} />{importError && <p className="import-error" role="alert">{importError}</p>}<div className="modal-footer"><button type="button" className="link-button" onClick={() => setBookPanelMode("library")}>返回我的词书</button><div><button type="button" className="modal-secondary" onClick={() => setShowBookPanel(false)}>取消</button><button type="button" className="modal-primary" onClick={handleImport}>导入并查看 <Icon name="arrow" /></button></div></div></>}
        {bookPanelMode === "edit" && <><div className="modal-heading"><div><span className="section-kicker">我的词书 · 名称</span><h2 id="book-panel-title">编辑词书名称</h2></div><button type="button" className="modal-close" aria-label="关闭词书窗口" onClick={() => setShowBookPanel(false)}>×</button></div><div className="book-edit-summary"><div className="book-summary-icon"><Icon name="book" /></div><div><strong>{editingBook?.name ?? bookName}</strong><span>名称会跟随这套词书和学习记录一起保存。</span></div></div><label className="book-name-field" htmlFor="book-name"><span>词书名称</span><input id="book-name" value={bookNameDraft} onChange={(event) => setBookNameDraft(event.target.value)} placeholder="例如：托福核心词 2100" maxLength={60} /></label><div className="modal-footer"><button type="button" className="link-button" onClick={() => setBookPanelMode("library")}>返回我的词书</button><div><button type="button" className="modal-secondary" onClick={() => setBookPanelMode("library")}>取消</button><button type="button" className="modal-primary" onClick={saveBookName}>保存名称</button></div></div></>}
      </section></div>}
      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}

function chooseNextWord(words: Word[], progress: StoredProgress, currentId?: number) {
  const candidates = words.filter((word) => word.id !== currentId);
  const notMastered = candidates.filter((word) => progress[word.id]?.status !== "mastered");
  return notMastered[0] ?? candidates[0] ?? words[0];
}
