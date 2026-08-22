import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { shouldSubmitAiQuestion } from "../v2/src/ai-input.ts";
import { selectPronunciationVoice } from "../v2/src/speech-voice.ts";
import { DEFAULT_SHORTCUTS, findMatchingShortcut, findShortcutConflict, formatShortcut, normalizeShortcut, parseShortcutBindings, shouldIgnoreShortcutEvent } from "../v2/src/shortcuts.ts";
import { studySenses } from "../v2/src/word-meaning.ts";

test("does not submit an AI question while an input method is composing", () => {
  assert.equal(shouldSubmitAiQuestion({ key: "Enter", isComposing: true, keyCode: 13 }, false), false);
  assert.equal(shouldSubmitAiQuestion({ key: "Enter", isComposing: false, keyCode: 229 }, false), false);
  assert.equal(shouldSubmitAiQuestion({ key: "Enter", isComposing: false, keyCode: 13 }, true), false);
  assert.equal(shouldSubmitAiQuestion({ key: "Enter", isComposing: false, keyCode: 13 }, false), true);
  assert.equal(shouldSubmitAiQuestion({ key: "a", isComposing: false, keyCode: 65 }, false), false);
});

test("prefers Samantha for word pronunciation and falls back to English", () => {
  const voices = [
    { name: "Alex", lang: "en-US" },
    { name: "Samantha (Enhanced)", lang: "en-US" },
    { name: "Daniel", lang: "en-GB" },
  ];
  assert.equal(selectPronunciationVoice(voices)?.name, "Samantha (Enhanced)");
  assert.equal(selectPronunciationVoice(voices.filter((voice) => !voice.name.includes("Samantha")))?.name, "Alex");
  assert.equal(selectPronunciationVoice([{ name: "Daniel", lang: "en-GB" }])?.name, "Daniel");
});

test("normalizes and displays single-key and macOS shortcut combinations", () => {
  const shortcut = normalizeShortcut({ key: "a", code: "KeyA", metaKey: true, shiftKey: true });
  assert.deepEqual(shortcut, { key: "A", code: "KeyA", meta: true, ctrl: false, alt: false, shift: true });
  assert.equal(formatShortcut(shortcut), "⌘ ⇧ A");
  assert.equal(findMatchingShortcut({ key: "A", code: "KeyA", metaKey: true, shiftKey: true }, { ...DEFAULT_SHORTCUTS, openAi: shortcut }), "openAi");
});

test("rejects duplicate shortcuts and falls back from invalid persisted data", () => {
  const duplicate = { ...DEFAULT_SHORTCUTS, openAi: { ...DEFAULT_SHORTCUTS.undo } };
  assert.equal(findShortcutConflict(duplicate, "openAi", duplicate.openAi), "undo");
  assert.deepEqual(parseShortcutBindings("not-json"), DEFAULT_SHORTCUTS);
  assert.deepEqual(parseShortcutBindings(JSON.stringify({ version: 0, shortcuts: DEFAULT_SHORTCUTS })), DEFAULT_SHORTCUTS);
  assert.deepEqual(parseShortcutBindings(JSON.stringify({ version: 1, shortcuts: duplicate })), DEFAULT_SHORTCUTS);
  assert.deepEqual(parseShortcutBindings(JSON.stringify({ version: 1, shortcuts: { ...DEFAULT_SHORTCUTS, openAi: { key: "Meta", code: "MetaLeft", meta: false, ctrl: false, alt: false, shift: false } } })), DEFAULT_SHORTCUTS);
});

test("ignores IME composition and editable shortcut targets", () => {
  assert.equal(shouldIgnoreShortcutEvent({ key: "A", isComposing: true }), true);
  assert.equal(shouldIgnoreShortcutEvent({ key: "A", keyCode: 229 }), true);
  assert.equal(shouldIgnoreShortcutEvent({ key: "A" }), false);
});

test("keeps every imported meaning when formatting study senses", () => {
  assert.deepEqual(
    studySenses({
      word: "rate",
      phonetic: "[reɪt]",
      part: "n. v.",
      meaning: "n. 比率；v. 速度；估价；定级",
      chapter: "List 01",
      senses: [{ part: "n.", meaning: "比率" }, { part: "v.", meaning: "速度" }],
    }),
    [{ part: "n.", meaning: "比率" }, { part: "v.", meaning: "速度；估价；定级" }],
  );

  assert.deepEqual(
    studySenses({
      word: "light",
      phonetic: "[laɪt]",
      part: "n. adj.",
      meaning: "光；轻的",
      chapter: "List 01",
      senses: [{ part: "n.", meaning: "光" }, { part: "adj.", meaning: "轻的" }],
    }),
    [{ part: "n.", meaning: "光" }, { part: "adj.", meaning: "轻的" }],
  );

  assert.deepEqual(
    studySenses({
      word: "charge",
      phonetic: "[tʃɑːrdʒ]",
      part: "n. v.",
      meaning: "费用；掌管；电荷；装满；充电",
      chapter: "List 01",
      senses: [{ part: "n.", meaning: "费用" }, { part: "v.", meaning: "掌管" }],
    }),
    [{ part: "n. v.", meaning: "费用；掌管；电荷；装满；充电" }],
  );

  assert.deepEqual(
    studySenses({
      word: "light",
      phonetic: "[laɪt]",
      part: "n. adj.",
      meaning: "光；adj. 轻的",
      chapter: "List 01",
    }),
    [{ part: "n.", meaning: "光" }, { part: "adj.", meaning: "轻的" }],
  );

  assert.deepEqual(
    studySenses({
      word: "test",
      phonetic: "",
      part: "n.",
      meaning: "nonsense",
      chapter: "List 01",
    }),
    [{ part: "n.", meaning: "nonsense" }],
  );

  assert.deepEqual(
    studySenses({
      word: "test",
      phonetic: "",
      part: "n.",
      meaning: "n.onsense",
      chapter: "List 01",
    }),
    [{ part: "n.", meaning: "n.onsense" }],
  );
});

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

async function requestLlm(body) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("llm-test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/api/llm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

async function requestPronunciation(body) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("pronunciation-test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/api/pronunciation-demo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the vocab learning experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>简辞 · 按章节背单词<\/title>/i);
  assert.match(html, /本周打卡/);
  assert.match(html, /复习旧词/);
  assert.match(html, /学习新词/);
  assert.match(html, /提前学习明天/);
  assert.match(html, /学习日历/);
  assert.match(html, /今日学习进度/);
  assert.doesNotMatch(html, /Your site is taking shape|codex-preview|SkeletonPreview/);
});

test("validates LLM requests before contacting a provider", async () => {
  const missing = await requestLlm({});
  assert.equal(missing.status, 400);
  assert.match((await missing.json()).error, /缺少接口/);

  const unsafe = await requestLlm({
    endpoint: "http://example.com/v1/chat/completions",
    model: "test-model",
    word: { word: "resilient" },
    messages: [{ role: "user", content: "怎么记？" }],
  });
  assert.equal(unsafe.status, 400);
  assert.match((await unsafe.json()).error, /HTTPS/);
});

test("proxies a contextual word question to a local compatible LLM", async () => {
  let authorization = "";
  let providerBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const headers = new Headers(init?.headers);
    authorization = headers.get("authorization") ?? "";
    providerBody = JSON.parse(String(init?.body ?? "{}"));
    return Response.json({ choices: [{ message: { content: "resilient 可以联想为受压后又弹回原状。" } }] });
  };
  try {
    const response = await requestLlm({
      endpoint: "https://llm.example/v1",
      model: "local-test-model",
      apiKey: "local-secret",
      answer: "unknown",
      word: { word: "resilient", phonetic: "/rɪˈzɪliənt/", senses: [{ part: "adj.", meaning: "有韧性的" }] },
      messages: [{ role: "user", content: "怎么记？" }],
    });
    assert.equal(response.status, 200);
    assert.match((await response.json()).content, /弹回原状/);
    assert.equal(authorization, "Bearer local-secret");
    assert.equal(providerBody.model, "local-test-model");
    assert.match(providerBody.messages[0].content, /用户刚才选择：不认识/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects pronunciation proxy targets outside the explicit allowlist", async () => {
  const response = await requestPronunciation({
    endpoint: "https://127.0.0.1/internal",
    apiKey: "not-used",
    text: "hello",
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /只允许 TokenDance 或 MiniMax/);
});

test("keeps progress logic local and removes starter-only assets", async () => {
  const [page, tutor, llmRoute, pronunciationRoute, packageJson, v2App, v2Styles, v2LiquidStyles, v2Main, v2Shortcuts, rustDb] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/WordAiTutor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/llm/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/pronunciation-demo/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../v2/src/app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../v2/src/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../v2/src/liquid-glass.css", import.meta.url), "utf8"),
    readFile(new URL("../v2/src/main.tsx", import.meta.url), "utf8"),
    readFile(new URL("../v2/src/shortcuts.ts", import.meta.url), "utf8"),
    readFile(new URL("../src-tauri/src/db.rs", import.meta.url), "utf8"),
  ]);

  assert.match(page, /localStorage/);
  assert.match(page, /simpleDictionaryDesktop/);
  assert.match(page, /WordAiTutor/);
  assert.match(page, /with-ai-sidebar/);
  assert.match(tutor, /答题后可以继续追问/);
  assert.match(tutor, /simple-dictionary-llm-settings-v1/);
  assert.match(tutor, /\/api\/llm/);
  assert.match(tutor, /正在思考/);
  assert.doesNotMatch(tutor, /正在想一想/);
  assert.match(tutor, /renderInlineMarkdown/);
  assert.match(llmRoute, /chat\/completions/);
  assert.match(llmRoute, /只围绕当前单词回答/);
  assert.match(llmRoute, /Authorization: `Bearer \$\{apiKey\}`/);
  assert.match(pronunciationRoute, /ALLOWED_ENDPOINT_HOSTS/);
  assert.match(pronunciationRoute, /redirect: "error"/);
  assert.match(pronunciationRoute, /parsed\.protocol !== "https:"/);
  assert.doesNotMatch(pronunciationRoute, /raw\.slice/);
  assert.match(page, /serializedBookState/);
  assert.match(page, /vocab-flow-book-state-v1/);
  assert.match(page, /vocab-flow-study-history-v1/);
  assert.match(page, /satisfies StoredBookState/);
  assert.match(page, /status: "mastered"/);
  assert.match(page, /status: "review"/);
  assert.match(page, /normalizeProgress/);
  assert.match(page, /StoredBookEntry/);
  assert.match(page, /PART_SEQUENCE_PATTERN/);
  assert.doesNotMatch(page, /PART_SEQUENCE_PATTERN = [^\n]*\|v\|vt\|vi/);
  assert.match(page, /getTimeGreeting/);
  assert.match(page, /还没休息吗？先睡一会儿，单词明天再学也来得及/);
  assert.match(page, /buildSmoothChartPath/);
  assert.match(page, /dayChartPath/);
  assert.match(page, /switchBook/);
  assert.match(page, /\{completed\} \/ \{targetWordCount\}/);
  assert.match(page, /saveBookName/);
  assert.match(page, /deleteBook/);
  assert.match(page, /编辑词书名称/);
  assert.match(page, /删除词书/);
  assert.match(page, /createTestBook/);
  assert.match(page, /TEST_BOOK_ID/);
  assert.match(page, /编辑名称/);
  assert.match(page, /简辞/);
  assert.match(page, /className="brand-mark"><Icon name="book"/);
  assert.match(page, /sidebarCollapsed/);
  assert.match(page, /className="sidebar-toggle"/);
  assert.match(page, /className="nav-label"/);
  assert.doesNotMatch(page, /学习计划设置|className="icon-button"|className="top-actions"/);
  assert.match(page, /StoredSessionState/);
  assert.match(page, /exitSession/);
  assert.match(page, /退出学习/);
  assert.match(page, /当前学习进度已保存/);
  assert.match(page, /getScheduledChapterPlan/);
  assert.match(page, /buildDefaultChapterSchedule/);
  assert.match(page, /bookSignature/);
  assert.match(page, /shouldShowDefinition/);
  assert.match(page, /shouldShowExample/);
  assert.match(page, /event\.code === "Space"/);
  assert.match(page, /event\.key\.toLowerCase\(\) === "z"/);
  assert.match(page, /className="meaning-sense-list"/);
  assert.match(page, /getWordSenses/);
  assert.match(page, /answer-note answer-note-top/);
  assert.doesNotMatch(page, /className="card-index"/);
  assert.match(page, /accept="\.txt,\.pdf,text\/plain,application\/pdf"/);
  assert.match(page, /parsePdfImport/);
  assert.match(page, /导出备份/);
  assert.match(page, /导入备份/);
  assert.doesNotMatch(page, /已自动保存|sync-status/);
  assert.match(page, /学习章节/);
  assert.match(page, /复习章节/);
  assert.match(page, /每日章节计划/);
  assert.match(page, /今日任务选择/);
  assert.match(page, /session-calendar-panel/);
  assert.match(page, /calendar-view-switcher/);
  assert.match(page, /calendar-month-grid/);
  assert.match(page, /calendar-day-view/);
  assert.match(page, /hourlyCounts/);
  assert.match(page, /复习旧词/);
  assert.match(page, /学习新词/);
  assert.match(page, /学习日历/);
  assert.match(page, /今日打卡/);
  assert.match(page, /补做昨天/);
  assert.match(page, /补上昨天打卡/);
  assert.match(page, /提前学习明天/);
  assert.match(page, /startSession\("review", tomorrow\)/);
  assert.match(page, /startSession\("learn", yesterday\)/);
  assert.match(page, /learnedWordIds/);
  assert.match(page, /reviewedWordIds/);
  assert.match(page, /restoreStoredSession/);
  assert.match(page, /targetCount: learnWords\.length \+ reviewWords\.length/);
  assert.match(page, /每天可直接点击多个学习章节/);
  assert.match(page, /chapter-picker/);
  assert.match(page, /aria-pressed/);
  assert.match(page, /review-list-preview/);
  assert.match(page, /今日复习列表/);
  assert.match(v2App, /onStart=\{\(mode, date\) => void openStudy\(mode, date\)\}/);
  assert.match(v2App, /onStart\("review", activeDate\)/);
  assert.match(v2App, /onStart\("learn", activeDate\)/);
  assert.match(v2App, /onClick=\{\(\) => onSelectDate\(item\.date\)\}/);
  assert.doesNotMatch(v2App, /setRange\("day"\)/);
  assert.doesNotMatch(v2App, /补做复习/);
  assert.doesNotMatch(v2App, /补做学习/);
  assert.match(v2App, /补上打卡/);
  assert.doesNotMatch(v2App, /提前复习/);
  assert.doesNotMatch(v2App, /提前学习/);
  assert.match(v2App, /onStart: \(mode: "learn" \| "review", date\?: string\) =>/);
  assert.match(v2App, /scrollIntoView\(\{ behavior: "smooth", block: "end" \}\)/);
  assert.match(v2App, /questionInputRef\.current\?\.focus\(\)/);
  assert.match(v2App, /voiceschanged/);
  assert.match(v2App, /synthesis\.resume\(\)/);
  assert.match(v2App, /speechWatchdogRef/);
  assert.doesNotMatch(v2App, /Youdao|youdao|有道/);
  assert.match(v2App, /AI_AUDIO_CACHE_LIMIT = 8/);
  assert.match(v2App, /snapshot\.currentBook\?\.id/);
  assert.match(v2App, /word\.word,/);
  assert.match(v2App, /llmSettings\.endpoint,/);
  assert.match(v2App, /disposeAiAudioEntry/);
  assert.match(v2App, /audio\.preload = "auto"/);
  assert.match(v2App, /void speakAiWord\(word, request, \(\) => speakSystemWord\(word, request\)\)/);
  assert.match(v2App, /AI 失败时回退到现有语音/);
  assert.match(v2App, /proofreadBook/);
  assert.match(v2App, /proofread-progress/);
  assert.match(v2App, /proofread-progress-bar/);
  assert.match(v2App, /proofread-window/);
  assert.match(v2App, /从断点继续/);
  assert.match(v2App, /最多自动尝试 3 次/);
  assert.match(rustDb, /MAX_PROOFREAD_ATTEMPTS: u32 = 3/);
  assert.match(v2App, /AI 校对/);
  assert.match(v2App, /确认应用所选修正/);
  assert.match(v2App, /maxAttempts = 4/);
  assert.match(v2App, /onCompositionStart/);
  assert.match(v2App, /jian-ci-auto-pronounce-after-answer/);
  assert.match(v2App, /if \(autoPronounceAfterAnswer\) speakWord\(answeredWord\);/);
  assert.match(v2App, />答题后发音</);
  assert.match(v2App, /view === "settings"/);
  assert.match(v2App, /value: "system", label: "跟随系统"/);
  assert.match(v2App, /value: "light", label: "浅色"/);
  assert.match(v2App, /value: "dark", label: "深色"/);
  assert.match(v2App, /document\.documentElement\.dataset\.theme = theme/);
  assert.match(v2App, /media\.addEventListener\("change", onChange\)/);
  assert.match(v2App, /留空则保留钥匙串中的原密钥/);
  assert.match(v2App, /label: "怎么记忆"/);
  assert.match(v2App, /label: "怎么用"/);
  assert.match(v2App, /label: "派生词"/);
  assert.match(v2App, /label: "词根"/);
  assert.match(v2App, /onClick=\{\(\) => void send\(suggestion\.prompt\)\}/);
  assert.match(v2App, /disabled=\{thinking \|\| !word\}/);
  assert.match(v2App, /view === "vocabulary"/);
  assert.match(v2App, />生词本</);
  assert.match(v2App, /vocabularyWords\.length/);
  assert.match(v2App, /setVocabularyWord\(wordKey, saved\)/);
  assert.match(v2App, /startVocabularyStudy\(\)/);
  assert.match(v2App, /studySession\.mode === "vocabulary"/);
  assert.match(v2App, /还没有收藏生词/);
  assert.match(v2App, /单词、词性或释义/);
  assert.match(v2App, /全部章节/);
  assert.match(v2App, /<BookmarkIcon filled=\{saved\} \/>/);
  assert.match(v2App, /book\.active && <button[^>]+bookmark-button/);
  assert.match(v2App, /不认识的单词会移到队尾/);
  assert.match(v2Shortcuts, /jian-ci-shortcuts-v1/);
  assert.match(v2App, /恢复默认/);
  assert.match(v2App, /请按键…/);
  assert.match(v2App, /findMatchingShortcut\(event, shortcuts\)/);
  assert.match(v2App, /shouldIgnoreShortcutEvent\(event\)/);
  assert.match(v2App, /action === "answerUnknown" && !revealed/);
  assert.match(v2App, /action === "answerKnown" && !revealed/);
  assert.match(v2App, /action === "advance" && revealed/);
  assert.match(v2App, /action === "undo" && revealed/);
  assert.match(v2App, /action === "pronounce"/);
  assert.match(v2App, /action === "openAi"/);
  assert.match(v2App, /shortcutActionLabel\(conflict\)/);
  assert.match(v2App, /formatShortcut\(shortcuts\.openAi\)/);
  assert.match(v2Shortcuts, /version !== 1/);
  assert.match(v2Shortcuts, /findShortcutConflict/);
  assert.match(v2Styles, /\.sidebar \{ position: sticky; top: 0;/);
  assert.match(v2Styles, /\.ai-conversation \{[^}]*overflow-y: auto;/);
  assert.match(v2Styles, /\.auto-pronounce-toggle input:checked \+ \.toggle-track/);
  assert.match(v2Styles, /\.theme-option-grid/);
  assert.match(v2Styles, /\.ai-suggestion-list \{[^}]*grid-template-columns: repeat\(4,/);
  assert.match(v2Styles, /\.shortcut-list \{/);
  assert.match(v2Styles, /\.shortcut-capture\.recording/);
  assert.match(v2Styles, /\.vocabulary-card \{/);
  assert.match(v2Styles, /\.bookmark-button\.saved/);
  assert.match(v2Styles, /\.sidebar-collapsed \.nav-item b/);
  assert.match(v2Main, /liquid-glass\.css/);
  assert.match(v2App, /dataset\.effectiveTheme/);
  assert.match(v2App, /ai-drawer-backdrop/);
  assert.match(v2App, /className="sidebar-toolbar"/);
  assert.match(v2App, /aria-expanded=\{!sidebarCollapsed\}/);
  assert.match(v2App, /className="nav-section-label">学习/);
  assert.match(v2App, /className="nav-section-label">词汇/);
  assert.match(v2App, /className="nav-section-label">偏好/);
  assert.match(v2LiquidStyles, /backdrop-filter/);
  assert.match(v2LiquidStyles, /border-right: 1px solid var\(--liquid-line\)/);
  assert.match(v2LiquidStyles, /\.sidebar-panel-icon/);
  assert.match(v2LiquidStyles, /prefers-reduced-motion/);
  assert.match(v2LiquidStyles, /--cyberpunk_dark_mode-color-1:\s*#0f172a/);
  assert.match(v2LiquidStyles, /--cyberpunk_dark_mode-color-2:\s*#1e293b/);
  assert.match(v2LiquidStyles, /--cyberpunk_dark_mode-color-3:\s*#38bdf8/);
  assert.match(v2LiquidStyles, /--cyberpunk_dark_mode-color-4:\s*#c084fc/);
  assert.match(v2LiquidStyles, /--cyberpunk_dark_mode-color-5:\s*#f472b6/);
  assert.match(v2LiquidStyles, /\.task-card\.review \.task-icon \{ background: var\(--secondary-fill\)/);
  assert.match(v2LiquidStyles, /\.task-card\.learn \.task-icon \{ background: var\(--accent-fill\)/);
  assert.match(v2LiquidStyles, /\.book-card-actions \.danger-button[^}]+var\(--danger-soft\)[^}]+var\(--danger-text\)/);
  assert.match(v2LiquidStyles, /:root\[data-effective-theme\] \.calendar-explorer-day \{[^}]+background: var\(--liquid-control\)/);
  assert.doesNotMatch(v2LiquidStyles, /#1a2c33|#1c4e45|#285449|#55c9a5/);
  assert.match(v2LiquidStyles, /--liquid-surface:\s*color-mix\(in srgb, var\(--cyberpunk_dark_mode-color-2\) 96%, var\(--cyberpunk_dark_mode-color-1\)\)/);
  assert.match(v2LiquidStyles, /--liquid-glass-strong:\s*color-mix\(in srgb, var\(--cyberpunk_dark_mode-color-2\) 97%, transparent\)/);
  assert.doesNotMatch(page, /multiple size=\{3\}/);
  assert.doesNotMatch(page, /按住 Command 可多选/);
  assert.doesNotMatch(page, /<span className="nav-badge muted">\{customWords\.length\}<\/span>/);
  assert.doesNotMatch(page, /记忆曲线|REVIEW_STEPS|daysFromNow|minutesFromNow|memory-settings-button/);
  assert.match(page, /\[List 01\]/);
  assert.match(page, /音标为第二列/);
  assert.match(page, /setCustomWords\(imported\)/);
  assert.match(page, /已学 \{learnedWords\.length\} 个/);
  assert.match(packageJson, /"main": "desktop\/main\.mjs"/);
  assert.match(packageJson, /desktop:dist/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
});

test("keeps the Electron storage origin stable across launches", async () => {
  const [desktopMain, preload] = await Promise.all([
    readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8"),
    readFile(new URL("../desktop/preload.cjs", import.meta.url), "utf8"),
  ]);

  assert.match(desktopMain, /const LOCAL_SERVER_PORT = \d+;/);
  assert.match(desktopMain, /localServer\.listen\(LOCAL_SERVER_PORT, "127\.0\.0\.1"/);
  assert.doesNotMatch(desktopMain, /localServer\.listen\(0,/);
  assert.match(desktopMain, /simple-dictionary-state\.json/);
  assert.doesNotMatch(desktopMain, /webContents\.debugger|DOMStorage\./);
  assert.match(desktopMain, /preload\.cjs/);
  assert.match(preload, /contextBridge\.exposeInMainWorld\("simpleDictionaryDesktop"/);
  assert.match(preload, /simple-dictionary:load-state/);
  assert.match(preload, /simple-dictionary:save-state/);
});
