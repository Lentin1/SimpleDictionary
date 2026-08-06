import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

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

test("keeps progress logic local and removes starter-only assets", async () => {
  const [page, tutor, llmRoute, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/WordAiTutor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/llm/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
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
