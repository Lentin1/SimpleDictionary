import { useCallback, useEffect, useState } from "react";
import { answerWord, askLlm, checkIn, deleteBook, getBackupJson, getBookWords, importBook, leaveStudy, loadLlmSettings, loadSnapshot, nextWord, renameBook, saveLlmSettings, saveSchedule, setActiveBook, startStudy, undoAnswer } from "./backend";
import type { AppSnapshot, BookWord, ImportWordInput, LlmMessage, LlmSettings, ScheduleDayInput, StudySessionSnapshot, StudyWord, View } from "./types";
import { parsePdfImport } from "../../lib/pdf-import";

type ThemeMode = "system" | "light" | "dark";

const initialSnapshot: AppSnapshot = {
  appName: "简辞",
  currentBook: null,
  books: [],
  today: {
    date: "",
    studiedCount: 0,
    reviewCount: 0,
    targetCount: 0,
    checkedIn: false,
    studyChapters: [],
      reviewChapters: [],
    },
  schedule: [],
  history: [],
  migratedFromLegacy: false,
};

const emptyLlmSettings: LlmSettings = { endpoint: "", model: "", configured: false };

function formatDate(date: string) {
  if (!date) return "今天";
  const parsed = new Date(`${date}T00:00:00`);
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(parsed);
}

function progress(snapshot: AppSnapshot) {
  const { studiedCount, targetCount } = snapshot.today;
  return targetCount ? Math.min(100, Math.round((studiedCount / targetCount) * 100)) : 0;
}

export function App() {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [view, setView] = useState<View>("today");
  const [loading, setLoading] = useState(true);
  const [aiOpen, setAiOpen] = useState(false);
  const [llmSettings, setLlmSettings] = useState(emptyLlmSettings);
  const [aiConversation, setAiConversation] = useState<{ wordKey: string; messages: LlmMessage[] } | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [studySession, setStudySession] = useState<StudySessionSnapshot | null>(null);
  const [bookPreview, setBookPreview] = useState<{ book: AppSnapshot["books"][number]; words: BookWord[] } | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem("jian-ci-sidebar") === "collapsed";
    } catch {
      return false;
    }
  });
  const [theme, setTheme] = useState<ThemeMode>(() => {
    try {
      const saved = window.localStorage.getItem("jian-ci-theme");
      return saved === "light" || saved === "dark" ? saved : "system";
    } catch {
      return "system";
    }
  });
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? false);

  useEffect(() => {
    loadSnapshot()
      .then(setSnapshot)
      .finally(() => setLoading(false));
    loadLlmSettings().then(setLlmSettings);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem("jian-ci-theme", theme);
    } catch {
      // Theme persistence is optional; learning data is stored by the desktop backend.
    }
  }, [theme]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemDark(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem("jian-ci-sidebar", sidebarCollapsed ? "collapsed" : "expanded");
    } catch {
      // Sidebar preference is optional; learning data is stored by the desktop backend.
    }
  }, [sidebarCollapsed]);

  const percent = progress(snapshot);
  const effectiveTheme = theme === "system" ? (systemDark ? "dark" : "light") : theme;

  async function chooseBook(bookId: string) {
    const next = await setActiveBook(bookId);
    setSnapshot(next);
  }

  async function editBook(bookId: string, name: string, note: string) {
    setSnapshot(await renameBook(bookId, name, note));
  }

  async function removeBook(bookId: string) {
    setSnapshot(await deleteBook(bookId));
  }

  async function addBook(name: string, note: string, words: ImportWordInput[]) {
    setSnapshot(await importBook(name, note, words));
  }

  async function savePlan(days: ScheduleDayInput[]) {
    if (!snapshot.today.date) return;
    await saveSchedule(snapshot.today.date, days);
    setSnapshot(await loadSnapshot());
  }

  async function saveAiSettings(endpoint: string, model: string, apiKey: string) {
    const next = await saveLlmSettings(endpoint, model, apiKey);
    setLlmSettings(next);
  }

  async function openBookPreview(bookId: string) {
    const book = snapshot.books.find((item) => item.id === bookId);
    if (!book) return;
    setBookPreview({ book, words: await getBookWords(bookId) });
  }

  async function exportBackup() {
    const payload = await getBackupJson();
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `jian-ci-backup-${snapshot.today.date || "today"}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function handleCheckIn(date: string) {
    try {
      setSnapshot(await checkIn(date));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
  }

  async function openStudy(mode: "learn" | "review", date?: string) {
    const next = await startStudy(mode, date);
    setAiConversation(null);
    setStudySession(next);
    setRevealed(next.revealed);
    setView("learn");
  }

  const handleAnswer = useCallback(async (known: boolean) => {
    if (!studySession?.current) return;
    const next = await answerWord(studySession.current.key, known);
    setStudySession(next);
    setRevealed(next.revealed);
  }, [studySession]);

  const handleNext = useCallback(async () => {
    setAiConversation(null);
    const next = await nextWord();
    setStudySession(next);
    setRevealed(next.revealed);
    if (next.completed) {
      setSnapshot(await loadSnapshot());
      setView("today");
    }
  }, []);

  const handleUndo = useCallback(async () => {
    try {
      const next = await undoAnswer();
      setStudySession(next);
      setRevealed(next.revealed);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
  }, []);

  async function handleLeave() {
    if (studySession) await leaveStudy();
    setAiConversation(null);
    setSnapshot(await loadSnapshot());
    setView("today");
  }

  useEffect(() => {
    if (view !== "learn") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (!studySession?.current) return;
      if (event.key === "ArrowLeft" && !revealed) {
        event.preventDefault();
        void handleAnswer(false);
      } else if (event.key === "ArrowRight" && !revealed) {
        event.preventDefault();
        void handleAnswer(true);
      } else if (event.code === "Space" && revealed) {
        event.preventDefault();
        void handleNext();
      } else if (event.key.toLowerCase() === "z" && revealed) {
        event.preventDefault();
        void handleUndo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleAnswer, handleNext, handleUndo, revealed, studySession, view]);

  const aiWordKey = studySession?.current?.key ?? null;
  const aiMessages = aiWordKey && aiConversation?.wordKey === aiWordKey ? aiConversation.messages : [];

  return (
    <main className={sidebarCollapsed ? "app-shell sidebar-collapsed" : "app-shell"}>
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="book-logo" aria-hidden="true">
            <svg viewBox="0 0 64 64" aria-hidden="true">
              <path d="M8 12h19c7 0 10 4 10 10v31H18c-5.5 0-10-4.5-10-10V12Z" />
              <path d="M56 12H37c-7 0-10 4-10 10v31h19c5.5 0 10-4.5 10-10V12Z" />
              <path className="book-logo-center" d="M32 22v31" />
              <path className="book-logo-line" d="M14 24h13M14 33h13M37 24h13M37 33h13" />
            </svg>
          </div>
          <div className="brand-copy">
            <strong>简辞</strong>
            <small>SIMPLE DICTIONARY</small>
          </div>
          <button
            className="sidebar-toggle"
            type="button"
            aria-label={sidebarCollapsed ? "展开侧边栏" : "折叠侧边栏"}
            title={sidebarCollapsed ? "展开侧边栏" : "折叠侧边栏"}
            onClick={() => setSidebarCollapsed((current) => !current)}
          >
            <svg
              className={sidebarCollapsed ? "sidebar-toggle-icon" : "sidebar-toggle-icon is-reversed"}
              viewBox="0 0 22 24"
              aria-hidden="true"
            >
              <path d="M5 4 14 12 5 20" />
            </svg>
          </button>
        </div>

        <nav className="primary-nav" aria-label="主导航">
          <button className={view === "today" ? "nav-item active" : "nav-item"} onClick={() => setView("today")} title={sidebarCollapsed ? "今日学习" : undefined}>
            <span className="nav-icon">◷</span>
            <span>今日学习</span>
            <b>{snapshot.today.studiedCount} / {snapshot.today.targetCount || "—"}</b>
          </button>
          <button className={view === "books" ? "nav-item active" : "nav-item"} onClick={() => setView("books")} title={sidebarCollapsed ? "我的词书" : undefined}>
            <span className="nav-icon">▤</span>
            <span>我的词书</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <div className="storage-chip">
            <span className="status-dot" />
            <span>本地 SQLite</span>
          </div>
          <small>离线优先 · 数据保存在本机</small>
        </div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">{formatDate(snapshot.today.date)}</p>
            <h1>{timeGreeting()}</h1>
          </div>
          <div className="topbar-meta">
            <span className="migration-badge">{loading ? "正在打开" : "本地数据"}</span>
            <button className="theme-button" aria-label={effectiveTheme === "dark" ? "切换到浅色模式" : "切换到深色模式"} title={effectiveTheme === "dark" ? "切换到浅色模式" : "切换到深色模式"} onClick={() => setTheme(effectiveTheme === "dark" ? "light" : "dark")}>
              {effectiveTheme === "dark" ? <SunIcon /> : <MoonIcon />}
            </button>
          </div>
        </header>

        {view === "today" && (
          <TodayPage snapshot={snapshot} percent={percent} onStart={(mode) => void openStudy(mode)} onSaveSchedule={savePlan} onCheckIn={handleCheckIn} />
        )}
        {view === "books" && (
          <BooksPage snapshot={snapshot} onChoose={chooseBook} onRename={editBook} onDelete={removeBook} onImport={addBook} onView={openBookPreview} onExport={exportBackup} />
        )}
        {view === "learn" && (
          <StudyPage
            session={studySession}
            snapshot={snapshot}
            percent={percent}
            revealed={revealed}
            onAnswer={(known) => void handleAnswer(known)}
            onNext={() => void handleNext()}
            onUndo={() => void handleUndo()}
            onBack={() => void handleLeave()}
            onAi={() => setAiOpen(true)}
          />
        )}
      </section>

      {aiOpen && <AiDrawer key={`${llmSettings.endpoint}|${llmSettings.model}|${llmSettings.configured}`} word={studySession?.current ?? null} answer={studySession?.answer ?? null} settings={llmSettings} messages={aiMessages} onMessagesChange={(messages) => { if (aiWordKey) setAiConversation({ wordKey: aiWordKey, messages }); }} onSaveSettings={saveAiSettings} onClose={() => setAiOpen(false)} />}
      {bookPreview && <BookPreview book={bookPreview.book} words={bookPreview.words} onClose={() => setBookPreview(null)} />}
    </main>
  );
}

function SunIcon() {
  return <svg className="theme-icon sun-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></svg>;
}

function MoonIcon() {
  return <svg className="theme-icon moon-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.2 15.1A8.5 8.5 0 0 1 8.9 3.8a8.5 8.5 0 1 0 11.3 11.3Z" /></svg>;
}

function timeGreeting() {
  const hour = new Date().getHours();
  if (hour < 6) return "夜深了，先好好休息吧";
  if (hour < 11) return "早上好，慢慢开启今天的学习";
  if (hour < 14) return "中午好，记得留一点时间休息";
  if (hour < 19) return "下午好，保持自己的节奏";
  if (hour < 23) return "晚上好，今天也辛苦了";
  return "夜深了，先休息，明天再继续吧";
}

function TodayPage({ snapshot, percent, onStart, onSaveSchedule, onCheckIn }: { snapshot: AppSnapshot; percent: number; onStart: (mode: "learn" | "review", date?: string) => void; onSaveSchedule: (days: ScheduleDayInput[]) => Promise<void>; onCheckIn: (date: string) => Promise<void> }) {
  const [editingPlan, setEditingPlan] = useState(false);
  const today = snapshot.today;
  const calendarDates = buildWeekDates(today.date);
  const yesterday = shiftDate(today.date, -1);
  const tomorrow = shiftDate(today.date, 1);
  const yesterdayPlan = snapshot.schedule.find((day) => day.date === yesterday);
  const tomorrowPlan = snapshot.schedule.find((day) => day.date === tomorrow);
  const yesterdayRecord = snapshot.history.find((item) => item.date === yesterday);
  return (
    <div className="page-stack">
      <section className="hero-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">今日计划</p>
            <h2>把今天的章节学完</h2>
          </div>
          <span className="date-mark">{today.date.slice(5).replace("-", " / ")}</span>
        </div>
        <div className="calendar-strip" aria-label="学习日历">
          {calendarDates.map((date) => {
            const record = snapshot.history.find((item) => item.date === date.date);
            const isToday = date.date === today.date;
            return (
              <div className={isToday ? "calendar-day today" : "calendar-day"} key={date.date}>
                <small>{date.weekday}</small>
                <strong>{date.day}</strong>
                <span className={record?.checkedIn ? "calendar-dot done" : "calendar-dot"} />
                <em>{record?.studiedCount ? `${record.studiedCount} 词` : ""}</em>
              </div>
            );
          })}
        </div>
        <div className="hero-footer">
          <div>
            <span className="eyebrow">{snapshot.currentBook?.name ?? "当前词书"}</span>
            <strong>{today.studiedCount} / {today.targetCount} 个单词</strong>
          </div>
          <div className="hero-actions">
            {today.targetCount > 0 && today.studiedCount >= today.targetCount && !today.checkedIn && <button className="secondary-button" onClick={() => void onCheckIn(today.date)}>今日打卡</button>}
            <button className="primary-button" onClick={() => onStart("learn")}>进入学习 <span>→</span></button>
          </div>
        </div>
      </section>

      <CalendarExplorer snapshot={snapshot} onCheckIn={onCheckIn} />

      <div className="two-column-grid">
        <button className="task-card review" onClick={() => onStart("review")}>
          <span className="task-icon">↻</span>
          <div><small>按章节复习</small><strong>{today.reviewChapters.length ? today.reviewChapters.join("、") : "今天没有到期复习"}</strong></div>
          <span className="arrow">→</span>
        </button>
        <button className="task-card learn" onClick={() => onStart("learn")}>
          <span className="task-icon">＋</span>
          <div><small>学习新词</small><strong>{today.studyChapters.join("、") || "今日暂无新词"}</strong></div>
          <span className="arrow">→</span>
        </button>
      </div>

      {(yesterdayPlan || tomorrowPlan) && <section className="date-task-section">
        <div className="section-heading"><div><p className="eyebrow">跨日任务</p><h3>提前学习与补打卡</h3></div><span className="muted">按章节独立记录</span></div>
        <div className="date-task-grid">
          {yesterdayPlan && !yesterdayRecord?.checkedIn && <article className="date-task-card makeup"><div><span className="date-task-label">昨天 · {yesterday}</span><strong>{yesterdayRecord?.completed ? "昨天任务已完成，可以补打卡" : "昨天还有章节任务"}</strong><small>学习 {yesterdayPlan.studyChapters.join("、") || "无"} · 复习 {yesterdayPlan.reviewChapters.join("、") || "无"}</small></div><div className="date-task-actions"><button className="secondary-button" onClick={() => onStart("review", yesterday)} disabled={!yesterdayPlan.reviewChapters.length}>补做复习</button><button className="secondary-button" onClick={() => onStart("learn", yesterday)} disabled={!yesterdayPlan.studyChapters.length}>补做学习</button>{yesterdayRecord?.completed && <button className="primary-button" onClick={() => void onCheckIn(yesterday)}>补上打卡</button>}</div></article>}
          {tomorrowPlan && <article className="date-task-card ahead"><div><span className="date-task-label">明天 · {tomorrow}</span><strong>提前完成明天的章节</strong><small>学习 {tomorrowPlan.studyChapters.join("、") || "无"} · 复习 {tomorrowPlan.reviewChapters.join("、") || "无"}</small></div><div className="date-task-actions"><button className="secondary-button" onClick={() => onStart("review", tomorrow)} disabled={!tomorrowPlan.reviewChapters.length}>提前复习</button><button className="secondary-button" onClick={() => onStart("learn", tomorrow)} disabled={!tomorrowPlan.studyChapters.length}>提前学习</button></div></article>}
        </div>
      </section>}

      <section className="progress-panel">
        <div className="section-heading">
          <div><p className="eyebrow">今日进度</p><h2>{snapshot.currentBook?.name ?? "当前词书"}</h2></div>
          <span className="progress-percent">{percent}%</span>
        </div>
        <div className="progress-layout">
          <div className="progress-ring" style={{ "--progress": `${percent * 3.6}deg` } as React.CSSProperties}><strong>{percent}%</strong><small>完成</small></div>
          <div><strong className="progress-number">{today.studiedCount} <small>/ {today.targetCount}</small></strong><p>今日计划已学单词</p><p className="muted">还差 {Math.max(0, today.targetCount - today.studiedCount)} 个单词</p></div>
        </div>
        <div className="progress-bar"><span style={{ width: `${percent}%` }} /></div>
        <div className="progress-foot"><span>按章节安排 · {today.studyChapters.length} 个学习章节</span><span>{today.checkedIn ? "今日已打卡" : "完成后可打卡"}</span></div>
      </section>

      <section className="plan-summary">
        <div><p className="eyebrow">章节学习计划</p><strong>每天可安排多个学习章节和复习章节</strong><p>{today.studyChapters.length ? `今天学习 ${today.studyChapters.join("、")}` : "今天暂未安排新词"} · {today.reviewChapters.length ? `复习 ${today.reviewChapters.join("、")}` : "暂无复习章节"}</p></div>
        <button className="secondary-button plan-edit-button" onClick={() => setEditingPlan((value) => !value)}>{editingPlan ? "收起计划" : "编辑章节计划"}</button>
      </section>
      {editingPlan && <ScheduleEditor snapshot={snapshot} onSave={onSaveSchedule} onClose={() => setEditingPlan(false)} />}
    </div>
  );
}

const weekDays = ["一", "二", "三", "四", "五", "六", "日"];

function buildWeekDates(dateKey: string) {
  const safeDateKey = dateKey || new Date().toISOString().slice(0, 10);
  const anchor = new Date(`${safeDateKey}T12:00:00`);
  const mondayOffset = (anchor.getDay() + 6) % 7;
  anchor.setDate(anchor.getDate() - mondayOffset);
  return weekDays.map((weekday, index) => {
    const date = new Date(anchor);
    date.setDate(anchor.getDate() + index);
    return { weekday, day: date.getDate(), date: date.toISOString().slice(0, 10) };
  });
}

function shiftDate(dateKey: string, offset: number) {
  const safeDateKey = dateKey || new Date().toISOString().slice(0, 10);
  const date = new Date(`${safeDateKey}T12:00:00`);
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

function buildMonthDates(dateKey: string) {
  const safeDateKey = dateKey || new Date().toISOString().slice(0, 10);
  const first = new Date(`${safeDateKey.slice(0, 7)}-01T12:00:00`);
  const offset = (first.getDay() + 6) % 7;
  first.setDate(first.getDate() - offset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(first);
    date.setDate(first.getDate() + index);
    return { weekday: weekDays[index % 7], day: date.getDate(), date: date.toISOString().slice(0, 10), inMonth: date.getMonth() === new Date(`${safeDateKey}T12:00:00`).getMonth() };
  });
}

function recordFor(snapshot: AppSnapshot, date: string) {
  return snapshot.history.find((item) => item.date === date);
}

function calendarStatus(snapshot: AppSnapshot, date: string) {
  const record = recordFor(snapshot, date);
  if (record?.checkedIn) return "done";
  if (record?.completed) return "completed";
  if (record?.studiedCount) return "progress";
  return date > snapshot.today.date ? "future" : "missed";
}

function CalendarExplorer({ snapshot, onCheckIn }: { snapshot: AppSnapshot; onCheckIn: (date: string) => Promise<void> }) {
  const effectiveToday = snapshot.today.date || new Date().toISOString().slice(0, 10);
  const [range, setRange] = useState<"month" | "week" | "day">("week");
  const [cursor, setCursor] = useState(effectiveToday);
  const activeCursor = cursor || effectiveToday;
  const todayRecord = recordFor(snapshot, effectiveToday);
  const dates = range === "month" ? buildMonthDates(activeCursor) : range === "week" ? buildWeekDates(activeCursor) : buildWeekDates(activeCursor).filter((item) => item.date === activeCursor);
  const cursorDate = new Date(`${activeCursor}T12:00:00`);
  const title = range === "month" ? `${cursorDate.getFullYear()} 年 ${cursorDate.getMonth() + 1} 月` : range === "week" ? `第 ${cursorDate.getMonth() + 1} 月 · 本周` : `${cursorDate.getMonth() + 1} 月 ${cursorDate.getDate()} 日`;
  function move(direction: number) {
    const date = new Date(`${activeCursor}T12:00:00`);
    if (range === "month") date.setMonth(date.getMonth() + direction);
    else if (range === "week") date.setDate(date.getDate() + direction * 7);
    else date.setDate(date.getDate() + direction);
    setCursor(date.toISOString().slice(0, 10));
  }
  return (
    <section className="calendar-explorer">
      <div className="calendar-explorer-heading"><div><p className="eyebrow">学习日历</p><h3>{title}</h3></div><div className="calendar-explorer-actions"><div className="calendar-range-switcher" role="tablist" aria-label="日历范围">{(["month", "week", "day"] as const).map((value) => <button key={value} role="tab" aria-selected={range === value} className={range === value ? "selected" : ""} onClick={() => setRange(value)}>{value === "month" ? "月" : value === "week" ? "周" : "日"}</button>)}</div><button className="calendar-nav-button" onClick={() => move(-1)} aria-label="上一个时间段">‹</button><button className="calendar-nav-button" onClick={() => setCursor(snapshot.today.date)}>今天</button><button className="calendar-nav-button" onClick={() => move(1)} aria-label="下一个时间段">›</button></div></div>
      {range === "month" && <div className="calendar-month-labels">{weekDays.map((day) => <span key={day}>{day}</span>)}</div>}
      {range !== "day" && <div className={range === "month" ? "calendar-month-grid" : "calendar-explorer-week"}>{dates.map((item) => { const status = calendarStatus(snapshot, item.date); const record = recordFor(snapshot, item.date); return <button type="button" className={`calendar-explorer-day ${status} ${item.date === snapshot.today.date ? "today" : ""} ${"inMonth" in item && !item.inMonth ? "outside" : ""}`} key={item.date} onClick={() => { setCursor(item.date); setRange("day"); }}><small>{range === "week" ? item.weekday : ""}</small><strong>{item.day}</strong><span>{record?.studiedCount ? `${record.studiedCount} 词` : ""}</span><i /></button>; })}</div>}
      {range === "day" && <DayChart record={recordFor(snapshot, activeCursor)} date={activeCursor} />}
      <div className={`calendar-explorer-footer ${todayRecord?.checkedIn ? "done" : ""}`}><span>{todayRecord?.checkedIn ? "今日已打卡" : todayRecord?.completed ? "今日任务已完成" : `今日已学 ${todayRecord?.studiedCount ?? snapshot.today.studiedCount} / ${todayRecord?.targetCount || snapshot.today.targetCount} 个单词`}</span>{todayRecord?.completed && !todayRecord.checkedIn && <button className="secondary-button" onClick={() => void onCheckIn(effectiveToday)}>今日打卡</button>}</div>
    </section>
  );
}

function DayChart({ record, date }: { record?: AppSnapshot["history"][number]; date: string }) {
  const values = record?.hourlyCounts ?? Array.from({ length: 24 }, () => 0);
  const max = Math.max(1, ...values);
  const points = values.map((value, index) => [index / 23 * 100, 88 - value / max * 68] as const);
  const path = smoothChartPath(points);
  return <div className="day-chart-panel"><div className="day-chart-heading"><div><strong>{date === new Date().toISOString().slice(0, 10) ? "今日学习曲线" : `${date} 学习曲线`}</strong><span>{values.reduce((sum, value) => sum + value, 0)} 个单词 · 按完成时间统计</span></div><span className={record?.checkedIn ? "calendar-status-pill done" : "calendar-status-pill"}>{record?.checkedIn ? "已打卡" : record?.completed ? "已完成" : "未完成"}</span></div><div className="day-chart"><svg viewBox="0 0 100 100" role="img" aria-label="按小时统计的学习单词数量"><line x1="0" y1="88" x2="100" y2="88" /><line x1="0" y1="53" x2="100" y2="53" /><line x1="0" y1="18" x2="100" y2="18" /><path d={path} /></svg><div className="day-chart-labels"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div></div></div>;
}

function smoothChartPath(points: ReadonlyArray<readonly [number, number]>) {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0][0]} ${points[0][1]}`;
  let path = `M ${points[0][0]} ${points[0][1]}`;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const middle = (previous[0] + current[0]) / 2;
    path += ` C ${middle} ${previous[1]}, ${middle} ${current[1]}, ${current[0]} ${current[1]}`;
  }
  return path;
}

function ScheduleEditor({ snapshot, onSave, onClose }: { snapshot: AppSnapshot; onSave: (days: ScheduleDayInput[]) => Promise<void>; onClose: () => void }) {
  const chapters = snapshot.currentBook?.chapters ?? [];
  const initialDays: ScheduleDayInput[] = snapshot.schedule.length
    ? snapshot.schedule.map((day) => ({ dayIndex: day.dayIndex, date: day.date, studyChapters: day.studyChapters, reviewChapters: day.reviewChapters }))
    : chapters.slice(0, 14).map((chapter, index) => ({ dayIndex: index, date: scheduleDate(snapshot.today.date, index), studyChapters: [chapter], reviewChapters: [] }));
  const [days, setDays] = useState<ScheduleDayInput[]>(initialDays);
  const [saving, setSaving] = useState(false);

  function toggleChapter(dayIndex: number, field: "studyChapters" | "reviewChapters", chapter: string) {
    setDays((current) => current.map((day) => {
      if (day.dayIndex !== dayIndex) return day;
      const selected = day[field].includes(chapter);
      return { ...day, [field]: selected ? day[field].filter((value) => value !== chapter) : [...day[field], chapter] };
    }));
  }

  async function commit() {
    setSaving(true);
    try {
      await onSave(days);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="schedule-editor">
      <div className="schedule-editor-heading"><div><p className="eyebrow">按天安排</p><h3>学习与复习章节</h3><p>同一天可以选择多个章节；绿色表示已经选中。</p></div><button className="drawer-close-button" onClick={onClose} aria-label="关闭章节计划">×</button></div>
      <div className="schedule-day-list">
        {days.map((day) => (
          <article className={day.date === snapshot.today.date ? "schedule-day today" : "schedule-day"} key={day.dayIndex}>
            <div className="schedule-day-heading"><strong>第 {day.dayIndex + 1} 天</strong><span>{day.date ?? "待定"}{day.date === snapshot.today.date ? " · 今天" : ""}</span></div>
            <div className="schedule-field"><span>学习新词</span><div className="chapter-chip-list">{chapters.map((chapter) => <button type="button" className={day.studyChapters.includes(chapter) ? "chapter-chip selected" : "chapter-chip"} aria-pressed={day.studyChapters.includes(chapter)} onClick={() => toggleChapter(day.dayIndex, "studyChapters", chapter)} key={`study-${day.dayIndex}-${chapter}`}>{chapter}</button>)}</div></div>
            <div className="schedule-field"><span>复习章节</span><div className="chapter-chip-list">{chapters.map((chapter) => <button type="button" className={day.reviewChapters.includes(chapter) ? "chapter-chip selected" : "chapter-chip"} aria-pressed={day.reviewChapters.includes(chapter)} onClick={() => toggleChapter(day.dayIndex, "reviewChapters", chapter)} key={`review-${day.dayIndex}-${chapter}`}>{chapter}</button>)}</div></div>
          </article>
        ))}
      </div>
      <div className="schedule-editor-actions"><span>计划会保存到本机，不会改变已有学习记录。</span><button className="primary-button" onClick={() => void commit()} disabled={saving}>{saving ? "正在保存" : "保存章节计划"}</button></div>
    </section>
  );
}

function scheduleDate(start: string, offset: number) {
  const date = new Date(`${start}T00:00:00`);
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

function BooksPage({ snapshot, onChoose, onRename, onDelete, onImport, onView, onExport }: { snapshot: AppSnapshot; onChoose: (id: string) => void; onRename: (id: string, name: string, note: string) => void; onDelete: (id: string) => void; onImport: (name: string, note: string, words: ImportWordInput[]) => void; onView: (id: string) => Promise<void>; onExport: () => Promise<void> }) {
  async function handleImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const words = file.name.toLowerCase().endsWith(".pdf")
      ? (await parsePdfImport(file, 1)).imported.map((word) => ({ legacyId: String(word.id), chapter: word.chapter, word: word.word, phonetic: word.phonetic, part: word.part, meaning: word.meaning, senses: word.senses, example: word.example, tag: word.tag }))
      : parseTxtBook(await file.text());
    if (!words.length) {
      window.alert("没有识别到单词。格式示例：\n[List 01]\nsummary | [ˈsʌməri] | 总结；概要 | n. |");
      return;
    }
    const name = file.name.replace(/\.txt$/i, "").trim() || "导入词书";
    onImport(name, "从本地 TXT 导入", words);
  }

  function handleRename(book: AppSnapshot["books"][number]) {
    const name = window.prompt("词书名称", book.name)?.trim();
    if (!name) return;
    const note = window.prompt("词书备注", book.note) ?? book.note;
    onRename(book.id, name, note);
  }

  function handleDelete(book: AppSnapshot["books"][number]) {
    if (window.confirm(`确定删除“${book.name}”吗？这套词书的学习进度也会删除。`)) onDelete(book.id);
  }

  return (
    <div className="page-stack">
      <section className="page-heading"><p className="eyebrow">本地词书</p><h2>我的词书</h2><p>词书、学习进度与章节计划保存在本机，更新词书不会覆盖已经完成的学习记录。</p></section>
      <div className="book-list">
        {snapshot.books.map((book) => (
          <article className={book.active ? "book-card active" : "book-card"} key={book.id}>
            <div className="book-card-icon">▤</div>
            <div className="book-card-copy"><h3>{book.name}</h3><p>{book.wordCount} 个单词 · {book.chapterCount} 个章节</p><small>{book.masteredCount} 个已掌握</small></div>
            <div className="book-card-actions">{book.active ? <span className="active-label">正在使用</span> : <button onClick={() => onChoose(book.id)}>切换</button>}<button onClick={() => void onView(book.id)}>查看词书</button><button onClick={() => handleRename(book)}>改名</button><button className="danger-button" onClick={() => handleDelete(book)}>删除</button></div>
          </article>
        ))}
      </div>
      <section className="import-card"><div><p className="eyebrow">导入与备份</p><h3>管理本地词书</h3><p>TXT 使用“[List 01]”章节标题，下一行填写“单词 | 音标 | 中文释义 | 词性 | 例句”。导入会创建独立词书，不会覆盖已有进度。</p></div><div className="import-actions"><button className="secondary-button" onClick={() => void onExport()}>导出备份</button><label className="primary-button file-button">导入 TXT / PDF<input type="file" accept=".txt,.pdf,text/plain,application/pdf" onChange={handleImport} /></label></div></section>
    </div>
  );
}

function parseTxtBook(raw: string): ImportWordInput[] {
  let chapter = "未分类";
  const words: ImportWordInput[] = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const heading = line.match(/^\[([^\]]+)\]$/);
    if (heading) {
      chapter = heading[1].trim();
      continue;
    }
    const columns = line.split("|").map((column) => column.trim());
    if (columns.length < 2) continue;
    const [word, phonetic, meaning, part, example] = columns;
    if (!word || !meaning) continue;
    words.push({ chapter, word, phonetic, meaning, part, example, tag: "自定义" });
  }
  return words;
}

function splitPartLabels(value: string) {
  return value.match(/(?:vt\.?\/?vi\.?|vi\.?\/?vt\.?|adj\.?|adv\.?|prep\.?|pron\.?|conj\.?|num\.?|det\.?|aux\.?|art\.?|modal\.?|n\.?|v\.?)/gi)?.map((part) => part.endsWith(".") ? part : `${part}.`) ?? [];
}

function studySenses(word: StudyWord) {
  if (word.senses?.length) return word.senses;
  const parts = splitPartLabels(word.part);
  const meanings = word.meaning.split(/[；;]/).map((meaning) => meaning.trim()).filter(Boolean);
  if (parts.length > 1 && parts.length === meanings.length) return parts.map((part, index) => ({ part, meaning: meanings[index] ?? "" }));
  return [{ part: word.part.trim() || "—", meaning: word.meaning.trim() || word.definition?.trim() || "—" }];
}

function BookPreview({ book, words, onClose }: { book: AppSnapshot["books"][number]; words: BookWord[]; onClose: () => void }) {
  const [chapter, setChapter] = useState("全部章节");
  const visibleWords = chapter === "全部章节" ? words : words.filter((word) => word.chapter === chapter);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="book-preview-modal" role="dialog" aria-modal="true" aria-label={`${book.name}词书内容`}>
        <div className="drawer-heading"><div><p className="eyebrow">词书内容</p><h2>{book.name}</h2><p className="modal-subtitle">{book.wordCount} 个单词 · {book.chapterCount} 个章节 · 已掌握 {book.masteredCount} 个</p></div><button onClick={onClose} aria-label="关闭词书预览">×</button></div>
        <div className="book-preview-toolbar"><label>查看章节<select value={chapter} onChange={(event) => setChapter(event.target.value)}><option>全部章节</option>{book.chapters.map((name) => <option key={name}>{name}</option>)}</select></label><span>{visibleWords.length} 个词条</span></div>
        <div className="book-word-table" role="table">
          <div className="book-word-row book-word-header" role="row"><span>单词</span><span>音标</span><span>词性</span><span>中文释义</span></div>
          {visibleWords.map((word) => <div className="book-word-row" role="row" key={word.key}><strong>{word.word}</strong><span className="phonetic-small">{word.phonetic || "—"}</span><span>{word.part || "—"}</span><span>{word.meaning || word.definition || "—"}</span></div>)}
        </div>
      </section>
    </div>
  );
}

function StudyPage({ session, snapshot, percent, revealed, onAnswer, onNext, onUndo, onBack, onAi }: { session: StudySessionSnapshot | null; snapshot: AppSnapshot; percent: number; revealed: boolean; onAnswer: (known: boolean) => void; onNext: () => void; onUndo: () => void; onBack: () => void; onAi: () => void }) {
  const word = session?.current;
  const sessionDate = session?.date && snapshot.today.date ? taskDateLabel(session.date, snapshot.today.date) : "今日计划";
  const [speakingWordKey, setSpeakingWordKey] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }, [word?.key]);

  useEffect(() => () => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  const speakWord = useCallback(() => {
    if (!word || typeof window === "undefined" || !("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") return;
    const synthesis = window.speechSynthesis;
    synthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word.word);
    const voices = synthesis.getVoices();
    const englishVoice = voices.find((voice) => /^en-US/i.test(voice.lang)) ?? voices.find((voice) => /^en/i.test(voice.lang));
    if (englishVoice) {
      utterance.voice = englishVoice;
      utterance.lang = englishVoice.lang;
    } else {
      utterance.lang = "en-US";
    }
    utterance.rate = 0.82;
    utterance.pitch = 1;
    utterance.onstart = () => setSpeakingWordKey(word.key);
    utterance.onend = () => setSpeakingWordKey(null);
    utterance.onerror = () => setSpeakingWordKey(null);
    setSpeakingWordKey(word.key);
    synthesis.speak(utterance);
  }, [word]);

  return (
    <div className="study-page">
      <div className="study-heading"><div><p className="eyebrow">{sessionDate} · {session?.mode === "review" ? "复习" : "学习"} · {word?.chapter ?? "按章节"}</p><h2>{session?.mode === "review" ? "复习旧词" : "学习新词"}</h2></div><div className="study-heading-actions"><span>{session?.remainingCount ?? 0} 个待完成</span><button className="secondary-button" onClick={onBack}>退出学习</button></div></div>
      <article className={revealed ? "study-card revealed" : "study-card"}>
        <div className="study-card-top"><span className="tag">TOEFL</span><button className="ai-trigger" onClick={onAi}>问问 AI</button></div>
        {word ? <div className="word-center"><h2>{word.word}</h2><div className="phonetic-row"><p className="phonetic">{word.phonetic}</p><button type="button" className={`pronounce-button ${speakingWordKey === word.key ? "is-speaking" : ""}`} aria-label={`播放 ${word.word} 的发音`} title="使用系统语音播放" onClick={speakWord}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h3l4 3V7l-4 3H4Z" /><path d="M15 9.5a4 4 0 0 1 0 5M17.5 7a7.5 7.5 0 0 1 0 10" /></svg></button></div>{revealed ? <div className="meaning-list" aria-label="词性和释义">{studySenses(word).map((sense, index) => <div className="meaning-line" key={`${sense.part}-${index}`}><b>{sense.part}</b><strong>{sense.meaning}</strong></div>)}</div> : <p className="hint">先回想它的意思，再选择你的答案</p>}</div> : <div className="word-center empty-state"><h2>今天完成了</h2><p className="meaning">这一章节的任务已完成</p></div>}
        {word && (!revealed ? <div className="answer-grid"><button className="answer unknown" onClick={() => onAnswer(false)}><strong>不认识</strong><small>查看释义，并放到队尾复习</small></button><button className="answer known" onClick={() => onAnswer(true)}><strong>认识</strong><small>查看释义，并继续下一个</small></button></div> : <div className="revealed-actions"><span className="answer-status">{session?.answer === "unknown" ? "✓ 已加入本章队尾" : "✓ 已记录本章学习进度"}</span><div className="revealed-action-buttons"><button className="secondary-button undo-button" onClick={onUndo}>撤销选择 <kbd>Z</kbd></button><button className="primary-button next-button" onClick={onNext}>下一个单词 <kbd>Space</kbd> <span>→</span></button></div></div>)}
      </article>
      <p className="keyboard-hint">使用键盘 <kbd>←</kbd> 不认识 · <kbd>→</kbd> 认识 · <kbd>Space</kbd> 查看 / 下一个 · <kbd>Z</kbd> 撤销</p>
      <section className="progress-panel study-lower-panel">
        <div className="section-heading"><div><p className="eyebrow">今日进度</p><h2>{snapshot.currentBook?.name ?? "当前词书"}</h2></div><span className="progress-percent">{percent}%</span></div>
        <div className="progress-bar"><span style={{ width: `${percent}%` }} /></div>
        <div className="progress-foot"><span>{snapshot.today.studiedCount} / {snapshot.today.targetCount} 个今日计划单词</span><span>{Math.max(0, snapshot.today.targetCount - snapshot.today.studiedCount)} 个待完成</span></div>
      </section>
      <section className="wordbook-summary"><div><p className="eyebrow">我的词书</p><h3>{snapshot.currentBook?.name ?? "当前词书"}</h3><p>{snapshot.currentBook?.wordCount ?? 0} 个单词 · {snapshot.currentBook?.chapterCount ?? 0} 个章节 · 已掌握 {snapshot.currentBook?.masteredCount ?? 0} 个</p></div><button className="secondary-button">查看词书</button></section>
    </div>
  );
}

function taskDateLabel(date: string, today: string) {
  if (date === today) return "今日计划";
  if (date < today) return "昨日补做";
  return "明日提前";
}

function AiDrawer({ word, answer, settings, messages, onMessagesChange, onSaveSettings, onClose }: { word: StudySessionSnapshot["current"]; answer: StudySessionSnapshot["answer"]; settings: LlmSettings; messages: LlmMessage[]; onMessagesChange: (messages: LlmMessage[]) => void; onSaveSettings: (endpoint: string, model: string, apiKey: string) => Promise<void>; onClose: () => void }) {
  const [endpoint, setEndpoint] = useState(settings.endpoint);
  const [model, setModel] = useState(settings.model);
  const [apiKey, setApiKey] = useState("");
  const [question, setQuestion] = useState("");
  const [thinking, setThinking] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(!settings.configured);

  async function saveSettings() {
    try {
      await onSaveSettings(endpoint, model, apiKey);
      setApiKey("");
      setSettingsOpen(false);
    } catch (error) {
      onMessagesChange([...messages, { role: "assistant", content: error instanceof Error ? error.message : String(error) }]);
    }
  }

  async function send(rawQuestion: string) {
    const content = rawQuestion.trim();
    if (!content || !word || thinking) return;
    const nextMessages: LlmMessage[] = [...messages, { role: "user", content }];
    onMessagesChange(nextMessages);
    setQuestion("");
    setThinking(true);
    try {
      // Let the pending state paint before starting the native LLM request.
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      const reply = await askLlm(word, answer, nextMessages);
      onMessagesChange([...nextMessages, { role: "assistant", content: reply.trim() }]);
    } catch (error) {
      onMessagesChange([...nextMessages, { role: "assistant", content: error instanceof Error ? error.message : String(error) }]);
    } finally {
      setThinking(false);
    }
  }

  return (
    <aside className="ai-drawer">
      <div className="drawer-heading">
        <div><h2>AI英語先生</h2></div>
        <button onClick={onClose} aria-label="关闭 AI 面板">×</button>
      </div>
      <div className="ai-word-context"><strong>{word?.word ?? "当前单词"}</strong><span>{word?.part} · {word?.meaning}</span></div>
      {settingsOpen ? (
        <div className="ai-settings-form">
          <p className="eyebrow">首次使用先配置</p>
          <label>OpenAI 兼容接口<input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://api.example.com/v1" /></label>
          <label>模型名称<input value={model} onChange={(event) => setModel(event.target.value)} placeholder="gpt-4o-mini" /></label>
          <label>API Key<input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="保存到 macOS 钥匙串" /></label>
          <button className="primary-button" onClick={() => void saveSettings()}>保存配置</button>
          <small>地址必须使用 HTTPS；localhost 可使用 HTTP。密钥不会写入词书或备份。</small>
        </div>
      ) : (
        <>
          <div className="ai-message assistant"><AiMessageContent content="你可以问我这个词的用法、近义词，或让它出一道小测验。" /></div>
          <div className="ai-thread" aria-live="polite">
            {messages.map((message, index) => <div className={message.role === "user" ? "ai-message user" : "ai-message assistant"} key={message.role + "-" + index}><AiMessageContent content={message.content} /></div>)}
            {thinking && <div className="ai-message assistant ai-thinking" role="status"><AiMessageContent content="思考中…" /></div>}
          </div>
          <div className="ai-input-row">
            <input value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void send(question); }} placeholder="问问这个词……" />
            <button onClick={() => void send(question)} disabled={thinking}>发送</button>
          </div>
          <div className="ai-drawer-footer"><small>API 密钥由 macOS 钥匙串保护。</small><button className="link-button" onClick={() => setSettingsOpen(true)}>修改配置</button></div>
        </>
      )}
    </aside>
  );
}

function AiMessageContent({ content }: { content: string }) {
  return <div className="ai-message-content">{content.split(/\r?\n/).map((line, index) => {
    const text = line.trim();
    if (!text) return <span className="ai-markdown-gap" aria-hidden="true" key={`gap-${index}`} />;

    const heading = text.match(/^#{1,3}\s+(.+)$/);
    if (heading) return <p className="ai-markdown-heading" key={`heading-${index}`}>{renderInlineAiMarkdown(heading[1])}</p>;

    const bullet = text.match(/^[-*•]\s+(.+)$/);
    if (bullet) return <p className="ai-markdown-list" key={`bullet-${index}`}><span>•</span><span>{renderInlineAiMarkdown(bullet[1])}</span></p>;

    const numbered = text.match(/^(\d+)[.)]\s+(.+)$/);
    if (numbered) return <p className="ai-markdown-list" key={`numbered-${index}`}><span>{numbered[1]}.</span><span>{renderInlineAiMarkdown(numbered[2])}</span></p>;

    return <p key={`paragraph-${index}`}>{renderInlineAiMarkdown(text)}</p>;
  })}</div>;
}

function renderInlineAiMarkdown(text: string) {
  return text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*)/g).filter(Boolean).map((token, index) => {
    if (token.startsWith("**") && token.endsWith("**")) {
      return <strong key={`strong-${index}`}>{token.slice(2, -2)}</strong>;
    }
    if (token.startsWith("`") && token.endsWith("`")) {
      return <code key={`code-${index}`}>{token.slice(1, -1)}</code>;
    }
    if (token.startsWith("*") && token.endsWith("*")) {
      return <em key={`em-${index}`}>{token.slice(1, -1)}</em>;
    }
    return token;
  });
}
