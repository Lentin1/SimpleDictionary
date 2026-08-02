"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Word = {
  id: number;
  chapter?: string;
  word: string;
  phonetic: string;
  part: string;
  meaning: string;
  definition: string;
  example: string;
  translation: string;
  tag: string;
};

type ProgressRecord = {
  status: "mastered" | "review";
  dueAt: number;
  lastStudied: string;
  intervalIndex: number;
};

type StoredProgress = Record<number, ProgressRecord>;

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
const CHAPTER_PLAN_KEY = "vocab-flow-chapter-plan-v1";
const DEFAULT_STUDY_CHAPTERS = 1;
const DEFAULT_REVIEW_CHAPTERS = 2;
const DAY_MS = 24 * 60 * 60 * 1000;
const REVIEW_STEPS = [
  { label: "10 分钟", short: "10m" },
  { label: "1 天后", short: "1d" },
  { label: "3 天后", short: "3d" },
  { label: "7 天后", short: "7d" },
];

const daysFromNow = (days: number) => Date.now() + days * 24 * 60 * 60 * 1000;
const minutesFromNow = (minutes: number) => Date.now() + minutes * 60 * 1000;

function formatDate(date = new Date()) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(date);
}

function formatNextReview(dueAt: number) {
  const diff = dueAt - Date.now();
  if (diff <= 0) return "现在复习";
  const minutes = Math.ceil(diff / 60000);
  if (minutes < 60) return `${minutes} 分钟后`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `${hours} 小时后`;
  return `${Math.ceil(hours / 24)} 天后`;
}

function formatCompletionDate(timestamp: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
  }).format(new Date(timestamp));
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
    imported.push({
      id: startId + imported.length,
      chapter: currentChapter,
      word,
      phonetic: phonetic || "/—/",
      part: normalizePart(part),
      meaning,
      definition: "来自我的词书的自定义词条",
      example: example || "例句待补充。",
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

function getChapterPlan(words: Word[], progress: StoredProgress, studyCount: number, reviewCount: number) {
  const names = chapterNames(words);
  const unfinishedNames = names.filter((name) => words.some((word) => chapterName(word) === name && progress[word.id]?.status !== "mastered"));
  const studyNames = unfinishedNames.slice(0, studyCount);
  const reviewNames = names.filter((name) => words.some((word) => chapterName(word) === name && progress[word.id]?.status === "review")).slice(0, reviewCount);
  const selectedNames = Array.from(new Set([...studyNames, ...reviewNames]));
  const selectedWords = words.filter((word) => selectedNames.includes(chapterName(word)));
  const studyWords = words.filter((word) => studyNames.includes(chapterName(word)));
  return { names, studyNames, reviewNames, selectedNames, selectedWords, studyWords };
}

function Icon({ name }: { name: "spark" | "book" | "clock" | "check" | "arrow" | "sliders" | "help" }) {
  const paths = {
    spark: <><path d="m12 2 1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9L12 2Z" /><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z" /></>,
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Z" /><path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20" /></>,
    clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.2 2" /></>,
    check: <path d="m5 12 4.2 4.2L19 6.5" />,
    arrow: <><path d="M5 12h13" /><path d="m13 6 6 6-6 6" /></>,
    sliders: <><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="9" cy="6" r="2" /><circle cx="15" cy="12" r="2" /><circle cx="11" cy="18" r="2" /></>,
    help: <><circle cx="12" cy="12" r="9" /><path d="M9.7 9a2.4 2.4 0 1 1 4.2 1.6c-1 .9-1.9 1.2-1.9 2.5" /><path d="M12 16.5h.01" /></>,
  };
  return <svg aria-hidden="true" className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

export default function Home() {
  const [progress, setProgress] = useState<StoredProgress>({});
  const [customWords, setCustomWords] = useState<Word[]>([]);
  const [currentId, setCurrentId] = useState<number>(1);
  const [revealed, setRevealed] = useState(false);
  const [lastAnswer, setLastAnswer] = useState<"known" | "unknown" | null>(null);
  const [activeTab, setActiveTab] = useState<"review" | "mastered">("review");
  const [studyChaptersPerDay, setStudyChaptersPerDay] = useState(DEFAULT_STUDY_CHAPTERS);
  const [reviewChaptersPerDay, setReviewChaptersPerDay] = useState(DEFAULT_REVIEW_CHAPTERS);
  const [studyChapterDraft, setStudyChapterDraft] = useState(String(DEFAULT_STUDY_CHAPTERS));
  const [reviewChapterDraft, setReviewChapterDraft] = useState(String(DEFAULT_REVIEW_CHAPTERS));
  const [showPlanEditor, setShowPlanEditor] = useState(false);
  const [showBookPanel, setShowBookPanel] = useState(false);
  const [bookPanelMode, setBookPanelMode] = useState<"library" | "view" | "import">("library");
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");
  const [selectedFileName, setSelectedFileName] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [toast, setToast] = useState("");
  const [now, setNow] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const allWords = customWords.length ? customWords : WORDS;
  const currentWord = allWords.find((word) => word.id === currentId) ?? allWords[0];
  const activePlan = getChapterPlan(allWords, progress, studyChaptersPerDay, reviewChaptersPerDay);
  const targetWordCount = activePlan.studyWords.length || activePlan.selectedWords.length || allWords.length;
  const planWords = activePlan.selectedWords.length ? activePlan.selectedWords : allWords;
  const bookChapterGroups = chapterNames(customWords).map((name) => ({ name, words: customWords.filter((word) => chapterName(word) === name) }));

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        const savedCustomWords = window.localStorage.getItem(CUSTOM_WORDS_KEY);
        const savedChapterPlan = window.localStorage.getItem(CHAPTER_PLAN_KEY);
        const parsed = saved ? JSON.parse(saved) as StoredProgress : {};
        const parsedCustomWords = savedCustomWords ? (JSON.parse(savedCustomWords) as Word[]).map((word) => ({ ...word, chapter: word.chapter ?? "未分组" })) : [];
        const parsedChapterPlan = savedChapterPlan ? JSON.parse(savedChapterPlan) as { study?: number; review?: number } : {};
        const initialStudyCount = Math.min(20, Math.max(1, Number(parsedChapterPlan.study) || DEFAULT_STUDY_CHAPTERS));
        const initialReviewCount = Math.min(20, Math.max(0, Number(parsedChapterPlan.review) || DEFAULT_REVIEW_CHAPTERS));
        const availableWords = parsedCustomWords.length ? parsedCustomWords : WORDS;
        setProgress(parsed);
        setCustomWords(parsedCustomWords);
        setStudyChaptersPerDay(initialStudyCount);
        setReviewChaptersPerDay(initialReviewCount);
        setStudyChapterDraft(String(initialStudyCount));
        setReviewChapterDraft(String(initialReviewCount));
        const initialPlan = getChapterPlan(availableWords, parsed, initialStudyCount, initialReviewCount);
        const next = chooseNextWord(initialPlan.selectedWords.length ? initialPlan.selectedWords : availableWords, parsed);
        setCurrentId(next.id);
      } catch {
        // A clean in-memory session is still useful when storage is unavailable.
      }
      setNow(Date.now());
      setHydrated(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (hydrated) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  }, [progress, hydrated]);

  useEffect(() => {
    if (hydrated) window.localStorage.setItem(CUSTOM_WORDS_KEY, JSON.stringify(customWords));
  }, [customWords, hydrated]);

  useEffect(() => {
    if (hydrated) window.localStorage.setItem(CHAPTER_PLAN_KEY, JSON.stringify({ study: studyChaptersPerDay, review: reviewChaptersPerDay }));
  }, [studyChaptersPerDay, reviewChaptersPerDay, hydrated]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const today = new Date().toISOString().slice(0, 10);
  const studiedToday = allWords.filter((word) => progress[word.id]?.lastStudied === today).length;
  const masteredWords = allWords.filter((word) => progress[word.id]?.status === "mastered");
  const reviewWords = allWords.filter((word) => progress[word.id]?.status === "review");
  const completed = studiedToday;
  const progressPercent = Math.min(100, Math.round((completed / Math.max(1, targetWordCount)) * 100));
  const remainingCount = Math.max(0, allWords.length - masteredWords.length);
  const estimatedDays = Math.ceil(remainingCount / Math.max(1, targetWordCount));
  const estimatedCompletion = now ? formatCompletionDate(now + estimatedDays * DAY_MS) : "计算中";

  const activeList = activeTab === "review" ? reviewWords : masteredWords;

  function chooseNext() {
    const next = chooseNextWord(planWords, progress, currentWord.id);
    setCurrentId(next.id);
    setRevealed(false);
    setLastAnswer(null);
  }

  const answer = useCallback((type: "known" | "unknown") => {
    const nextRecord: ProgressRecord = type === "known"
      ? { status: "mastered", dueAt: daysFromNow(7), lastStudied: today, intervalIndex: 3 }
      : { status: "review", dueAt: minutesFromNow(10), lastStudied: today, intervalIndex: 0 };
    setProgress((current) => ({ ...current, [currentId]: nextRecord }));
    setLastAnswer(type);
    setRevealed(true);
    setToast(type === "known" ? "已加入掌握列表 · 7 天后复习" : "已加入待复习 · 10 分钟后再见");
    window.setTimeout(() => setToast(""), 2600);
  }, [currentId, today]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (showBookPanel) {
        if (event.key === "Escape") setShowBookPanel(false);
        return;
      }
      if (revealed || ["BUTTON", "INPUT", "TEXTAREA"].includes((event.target as HTMLElement)?.tagName ?? "")) return;
      if (event.key === "ArrowLeft") answer("unknown");
      if (event.key === "ArrowRight") answer("known");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [answer, revealed, showBookPanel]);

  function resetProgress() {
    setProgress({});
    setCurrentId(allWords[0]?.id ?? 1);
    setRevealed(false);
    setLastAnswer(null);
    setToast("学习进度已重置");
    window.setTimeout(() => setToast(""), 2200);
  }

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
    setCustomWords(imported);
    setCurrentId(imported[0].id);
    setRevealed(false);
    setLastAnswer(null);
    setImportText("");
    setImportError("");
    setSelectedFileName("");
    setBookPanelMode("view");
    setShowBookPanel(true);
    setToast(`已导入 ${imported.length} 个单词，已切换当前词书`);
    window.setTimeout(() => setToast(""), 2400);
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setImportText(text);
    setSelectedFileName(file.name);
    setImportError("");
  }

  async function loadBundledWordbook() {
    try {
      const response = await fetch("/wordbooks/2026-beat-toefl-list-01-30.txt");
      if (!response.ok) throw new Error("bundled wordbook unavailable");
      setImportText(await response.text());
      setSelectedFileName("2026-beat-toefl-list-01-30.txt");
      setImportError("");
    } catch {
      setImportError("内置 PDF 词书暂时无法读取，请改用下方的 TXT 文件选择器。");
    }
  }

  function commitChapterPlan() {
    const nextStudyCount = Math.min(20, Math.max(1, Number(studyChapterDraft) || 1));
    const nextReviewCount = Math.min(20, Math.max(0, Number(reviewChapterDraft) || 0));
    setStudyChaptersPerDay(nextStudyCount);
    setReviewChaptersPerDay(nextReviewCount);
    setStudyChapterDraft(String(nextStudyCount));
    setReviewChapterDraft(String(nextReviewCount));
  }

  const greeting = studiedToday > 0 ? "保持这个节奏" : "准备好开始了吗？";

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Icon name="spark" /></div>
          <div><strong>词流</strong><span>Vocab Flow</span></div>
        </div>

        <nav className="main-nav" aria-label="主导航">
          <button className={`nav-item ${showBookPanel ? "" : "active"}`} type="button" onClick={() => setShowBookPanel(false)}><span className="nav-icon"><Icon name="book" /></span><span>今日学习</span><span className="nav-badge">{targetWordCount}</span></button>
          <button className={`nav-item ${showBookPanel ? "active" : ""}`} type="button" onClick={() => { setImportError(""); setBookPanelMode("library"); setShowBookPanel(true); }}><span className="nav-icon"><Icon name="book" /></span><span>我的词书</span><span className="nav-badge muted">{customWords.length}</span></button>
        </nav>

        <div className="sidebar-bottom">
          <div className="streak-card">
            <div className="streak-top"><span className="fire">✦</span><span>连续学习</span><strong>3 天</strong></div>
            <div className="week-dots" aria-label="本周学习记录"><span>一</span><span>二</span><span>三</span><span className="today">四</span><span>五</span><span>六</span><span>日</span></div>
            <div className="streak-days"><i /><i /><i /><i className="faded" /><i className="faded" /><i className="faded" /><i className="faded" /></div>
          </div>
          <button className="nav-item secondary" type="button" onClick={() => setShowPlanEditor((open) => !open)}><span className="nav-icon"><Icon name="sliders" /></span><span>学习设置</span></button>
          <button className="nav-item secondary" type="button"><span className="nav-icon"><Icon name="help" /></span><span>使用帮助</span></button>
        </div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div><p className="eyebrow">{formatDate()}</p><h1>{greeting}</h1></div>
          <div className="top-actions"><span className="sync-status"><span className="status-dot" />已自动保存</span><button className="icon-button" type="button" aria-label="学习设置" onClick={() => setShowPlanEditor((open) => !open)}><Icon name="sliders" /></button></div>
        </header>

        <div className="dashboard-grid">
          <section className="study-column" aria-label="单词学习区">
            <div className="session-heading"><div><span className="section-kicker">今日学习 · {activePlan.studyNames.length ? activePlan.studyNames.join("、") : "全部词书"}</span><h2>认识这个单词吗？</h2></div><span className="queue-count">{Math.min(targetWordCount, Math.max(1, completed + 1))} / {targetWordCount}</span></div>

            <article className={`word-card ${revealed ? "is-revealed" : ""}`}>
              <div className="word-card-top"><span className="word-tag">{currentWord.tag}</span><span className="card-index">#{String(currentWord.id).padStart(2, "0")}</span></div>
              <div className="word-display"><h3>{currentWord.word}</h3><div className="word-meta"><span>{currentWord.phonetic}</span><b>{currentWord.part}</b></div></div>
              {!revealed ? <p className="prompt">先凭直觉回想它的意思，再选择你的答案</p> : <div className="answer-reveal"><div className="meaning-line"><span className="meaning-label">中文释义</span><strong>{currentWord.meaning}</strong></div><p className="definition">{currentWord.definition}</p><div className="example-block"><span className="example-label">例句</span><p>{currentWord.example}</p><p className="translation">{currentWord.translation}</p></div></div>}
              <div className="card-divider" />
              {!revealed ? <div className="answer-buttons"><button className="answer-button unknown" type="button" onClick={() => answer("unknown")}><span className="answer-symbol">×</span><span><strong>不认识</strong><small>加入待复习</small></span><span className="key-hint">←</span></button><button className="answer-button known" type="button" onClick={() => answer("known")}><span className="answer-symbol">✓</span><span><strong>认识</strong><small>加入已掌握</small></span><span className="key-hint">→</span></button></div> : <div className="revealed-actions"><div className={`answer-note ${lastAnswer}`}><span>{lastAnswer === "known" ? "✓" : "↻"}</span>{lastAnswer === "known" ? "很棒，这个词会在 7 天后再次出现" : "没关系，10 分钟后会再次考察"}</div><button className="next-button" type="button" onClick={chooseNext}>下一个单词 <Icon name="arrow" /></button></div>}
            </article>
            <p className="keyboard-note">使用键盘 <kbd>←</kbd> 不认识 · <kbd>→</kbd> 认识</p>

            <div className="memory-note"><div className="memory-icon"><Icon name="spark" /></div><div><strong>记忆曲线已为你安排</strong><p>根据你的回答，词流会在最容易遗忘的时间点提醒你复习。</p></div><span className="memory-path">{REVIEW_STEPS.map((step) => step.short).join("  ·  ")}</span></div>
          </section>

          <aside className="stats-column" aria-label="学习进度">
            <section className="progress-panel panel"><div className="panel-heading"><div><span className="section-kicker">今日进度</span><h3>学得很稳</h3></div><button type="button" className="more-button" onClick={resetProgress} aria-label="重置学习进度">重置</button></div><div className="ring-row"><div className="progress-ring" style={{ "--progress": `${progressPercent * 3.6}deg` } as React.CSSProperties}><div><strong>{progressPercent}%</strong><span>完成</span></div></div><div className="progress-copy"><strong>{completed} <em>/ {targetWordCount}</em></strong><span>今日已学单词</span><p>{progressPercent >= 100 ? "今日目标已完成" : `还差 ${Math.max(0, targetWordCount - completed)} 个单词`}</p></div></div><div className="progress-bar"><span style={{ width: `${progressPercent}%` }} /></div><div className="goal-row"><span>每日目标</span><div className="goal-actions"><strong>{targetWordCount} 个单词</strong><button type="button" className="goal-edit-button" onClick={() => setShowPlanEditor((open) => !open)}>{showPlanEditor ? "收起" : "调整"}</button></div></div>{showPlanEditor && <div className="chapter-plan-editor"><div className="chapter-plan-field"><label htmlFor="study-chapters">每日考察</label><div className="chapter-input-wrap"><input id="study-chapters" type="number" min="1" max="20" inputMode="numeric" value={studyChapterDraft} onChange={(event) => setStudyChapterDraft(event.target.value.replace(/[^0-9]/g, ""))} onBlur={commitChapterPlan} /><span>个单元</span></div></div><div className="chapter-plan-field"><label htmlFor="review-chapters">复习范围</label><div className="chapter-input-wrap"><input id="review-chapters" type="number" min="0" max="20" inputMode="numeric" value={reviewChapterDraft} onChange={(event) => setReviewChapterDraft(event.target.value.replace(/[^0-9]/g, ""))} onBlur={commitChapterPlan} /><span>个单元</span></div></div><p>本日计划：{activePlan.studyNames.length ? activePlan.studyNames.join("、") : "已完成全部章节"} · {targetWordCount} 个单词</p></div>}<div className="completion-estimate">按当前章节进度，预计 <strong>{estimatedCompletion}</strong> 完成</div></section>

            <section className="queue-panel panel"><div className="panel-heading"><div><span className="section-kicker">我的单词本</span><h3>{activeTab === "review" ? "待复习" : "已掌握"}</h3></div><div className="queue-total">{activeList.length}</div></div><div className="tabs" role="tablist"><button type="button" role="tab" aria-selected={activeTab === "review"} className={activeTab === "review" ? "selected" : ""} onClick={() => setActiveTab("review")}>待复习 <span>{reviewWords.length}</span></button><button type="button" role="tab" aria-selected={activeTab === "mastered"} className={activeTab === "mastered" ? "selected" : ""} onClick={() => setActiveTab("mastered")}>已掌握 <span>{masteredWords.length}</span></button></div><div className="word-list">{activeList.length === 0 ? <div className="empty-list"><span>✦</span><p>{activeTab === "review" ? "答错的词会出现在这里" : "认识的词会出现在这里"}</p></div> : activeList.map((word) => <button className="list-word" type="button" key={word.id} onClick={() => { setCurrentId(word.id); setRevealed(false); setLastAnswer(null); }}><div><strong>{word.word}</strong><span>{word.meaning}</span></div><small>{activeTab === "review" ? formatNextReview(progress[word.id]?.dueAt ?? 0) : "已掌握"}</small></button>)}</div><button className="view-all" type="button" onClick={() => setActiveTab(activeTab === "review" ? "mastered" : "review")}>查看{activeTab === "review" ? "已掌握" : "待复习"} <Icon name="arrow" /></button></section>

            <section className="insight-card"><div className="insight-orb">↗</div><div><span className="section-kicker">小提示</span><p>把单词放进真实语境，记忆会更牢。</p></div></section>
          </aside>
        </div>
        <footer className="app-footer"><span>词流会记住你的每一次选择</span><span>本地学习 · 随时复习</span></footer>
      </section>
      {showBookPanel && <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowBookPanel(false)}><section className={`book-modal ${bookPanelMode === "view" ? "book-modal-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="book-panel-title" onMouseDown={(event) => event.stopPropagation()}>
        {bookPanelMode === "library" && <><div className="modal-heading"><div><span className="section-kicker">词书管理</span><h2 id="book-panel-title">我的词书</h2></div><button type="button" className="modal-close" aria-label="关闭词书窗口" onClick={() => setShowBookPanel(false)}>×</button></div><p className="modal-intro">查看已经导入的词书，或从 TXT 文件创建一套按章节学习的词书。导入新词书后会替换当前自定义词书。</p><div className="book-summary-card"><div className="book-summary-icon"><Icon name="book" /></div><div className="book-summary-copy"><strong>我的自定义词书</strong><span>{customWords.length} 个单词 · {bookChapterGroups.length} 个章节</span></div><div className="book-summary-actions"><button type="button" className="modal-secondary" disabled={!customWords.length} onClick={() => setBookPanelMode("view")}>查看词书</button><button type="button" className="modal-primary" onClick={() => { setImportError(""); setBookPanelMode("import"); }}>导入 TXT</button></div></div><div className="bundled-book-card"><div><strong>2026 BEAT《托福必考2000词》</strong><span>List 01–30 · 2,100 个单词 · 已整理音标</span></div><button type="button" className="link-button" onClick={() => { setBookPanelMode("import"); void loadBundledWordbook(); }}>载入这份词书</button></div>{customWords.length === 0 ? <div className="book-empty"><span>✦</span><strong>还没有自定义词书</strong><p>导入 TXT 后，你的单词会按章节出现在这里。</p></div> : <div className="book-chapter-preview"><span className="section-kicker">章节预览</span>{bookChapterGroups.slice(0, 3).map((group) => <div className="chapter-preview-row" key={group.name}><strong>{group.name}</strong><span>{group.words.length} 个单词</span></div>)}</div>}<div className="book-help-card"><strong>章节格式</strong><p>用 <code>[List 01]</code> 作为章节标题，下面每行填写一个单词。</p></div></>}
        {bookPanelMode === "view" && <><div className="modal-heading"><div><span className="section-kicker">我的词书 · 查看</span><h2 id="book-panel-title">词书内容</h2></div><button type="button" className="modal-close" aria-label="关闭词书窗口" onClick={() => setShowBookPanel(false)}>×</button></div><div className="book-view-toolbar"><span>共 {customWords.length} 个单词 · {bookChapterGroups.length} 个章节</span><button type="button" className="link-button" onClick={() => { setImportError(""); setBookPanelMode("import"); }}>导入 TXT</button></div><div className="chapter-list">{bookChapterGroups.length ? bookChapterGroups.map((group) => <section className="chapter-group" key={group.name}><div className="chapter-group-heading"><strong>{group.name}</strong><span>{group.words.length} 个单词</span></div>{group.words.map((word) => <button className="chapter-word-row" type="button" key={word.id} onClick={() => { setCurrentId(word.id); setRevealed(false); setLastAnswer(null); setShowBookPanel(false); }}><div><strong>{word.word}</strong><span>{word.phonetic} · {word.meaning}</span></div><small>{word.part}</small></button>)}</section>) : <div className="book-empty"><span>✦</span><strong>还没有可查看的单词</strong><p>先导入一份 TXT 词书吧。</p></div>}</div></>}
        {bookPanelMode === "import" && <><div className="modal-heading"><div><span className="section-kicker">我的词书 · 导入</span><h2 id="book-panel-title">导入 TXT 词书</h2></div><button type="button" className="modal-close" aria-label="关闭词书窗口" onClick={() => setShowBookPanel(false)}>×</button></div><p className="modal-intro">支持本地 `.txt` 文件，也可以直接粘贴文本。章节标题会自动成为每日学习单元，导入新内容会替换当前自定义词书。</p><div className="txt-file-row"><input ref={fileInputRef} id="txt-upload" className="sr-only" type="file" accept=".txt,text/plain" onChange={handleFileChange} /><label htmlFor="txt-upload" className="file-picker">选择 TXT 文件</label>{selectedFileName ? <span className="selected-file">{selectedFileName}</span> : <span>也可以直接粘贴到下方</span>}</div><div className="format-guide"><strong>TXT 导入格式（音标为第二列）</strong><code>[List 01]\nsummary | [&apos;sʌməri] | 总结；概要 | n. |\nresilient | /rəˈzilyənt/ | 有韧性的；能迅速恢复的 | adj. | A resilient team recovers quickly.</code><span>章节标题用方括号包住；每行一个单词，字段顺序为：单词 | 音标 | 中文释义 | 词性 | 例句（可选）。音标支持方括号或斜线写法；旧的四列格式也仍然兼容。</span></div><textarea className="import-textarea" aria-label="词书内容" value={importText} onChange={(event) => { setImportText(event.target.value); setImportError(""); }} placeholder={"[List 01]\nsummary | ['sʌməri] | 总结；概要 | n. |\nresilient | /rəˈzilyənt/ | 有韧性的；能迅速恢复的 | adj. | A resilient team recovers quickly."} rows={8} />{importError && <p className="import-error" role="alert">{importError}</p>}<div className="modal-footer"><button type="button" className="link-button" onClick={() => setBookPanelMode("library")}>返回我的词书</button><div><button type="button" className="modal-secondary" onClick={() => setShowBookPanel(false)}>取消</button><button type="button" className="modal-primary" onClick={handleImport}>导入并查看 <Icon name="arrow" /></button></div></div></>}
      </section></div>}
      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}

function chooseNextWord(words: Word[], progress: StoredProgress, currentId?: number) {
  const now = Date.now();
  const due = words.filter((word) => word.id !== currentId && progress[word.id]?.status === "review" && (progress[word.id]?.dueAt ?? 0) <= now);
  if (due.length) return due[0];
  const unseen = words.filter((word) => word.id !== currentId && !progress[word.id]);
  if (unseen.length) return unseen[0];
  const review = words.filter((word) => word.id !== currentId && progress[word.id]?.status === "review");
  if (review.length) return review[0];
  const mastered = words.filter((word) => word.id !== currentId && progress[word.id]?.status === "mastered");
  return mastered[0] ?? words[0];
}
