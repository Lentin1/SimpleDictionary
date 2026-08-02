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

test("server-renders the vocab learning experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>简辞 · 按章节背单词<\/title>/i);
  assert.match(html, /本周打卡/);
  assert.match(html, /复习旧词/);
  assert.match(html, /学习新词/);
  assert.match(html, /学习日历/);
  assert.match(html, /今日学习进度/);
  assert.doesNotMatch(html, /Your site is taking shape|codex-preview|SkeletonPreview/);
});

test("keeps progress logic local and removes starter-only assets", async () => {
  const [page, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /localStorage/);
  assert.match(page, /vocab-flow-book-state-v1/);
  assert.match(page, /vocab-flow-study-history-v1/);
  assert.match(page, /satisfies StoredBookState/);
  assert.match(page, /status: "mastered"/);
  assert.match(page, /status: "review"/);
  assert.match(page, /normalizeProgress/);
  assert.match(page, /StoredBookEntry/);
  assert.match(page, /getTimeGreeting/);
  assert.match(page, /夜深了，早点休息，明天再继续吧/);
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
