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
  assert.match(html, /<title>词流 · 记忆曲线背词<\/title>/i);
  assert.match(html, /serendipity/);
  assert.match(html, /认识这个单词吗/);
  assert.match(html, /不认识/);
  assert.match(html, /认识/);
  assert.match(html, /记忆曲线已为你安排/);
  assert.doesNotMatch(html, /Your site is taking shape|codex-preview|SkeletonPreview/);
});

test("keeps progress logic local and removes starter-only assets", async () => {
  const [page, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /localStorage/);
  assert.match(page, /status: "mastered"/);
  assert.match(page, /status: "review"/);
  assert.match(page, /minutesFromNow\(10\)/);
  assert.match(page, /daysFromNow\(7\)/);
  assert.match(page, /getChapterPlan/);
  assert.match(page, /accept="\.txt,text\/plain"/);
  assert.match(page, /每日考察/);
  assert.match(page, /复习范围/);
  assert.match(page, /\[List 01\]/);
  assert.match(page, /音标为第二列/);
  assert.match(page, /setCustomWords\(imported\)/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
});
