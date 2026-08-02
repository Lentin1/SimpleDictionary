import { app, BrowserWindow } from "electron";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Readable } from "node:stream";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let localServer;

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".webp": "image/webp",
};

function distributionRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "vocab-flow-dist")
    : path.join(projectRoot, "dist");
}

function requestHeaders(request) {
  const headers = new Headers();
  Object.entries(request.headers).forEach(([key, value]) => {
    if (value) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  });
  return headers;
}

async function serveAsset(request, clientRoot) {
  const parsedUrl = new URL(request.url);
  const requestedPath = decodeURIComponent(parsedUrl.pathname).replace(/^\/+/, "");
  const candidate = path.resolve(clientRoot, requestedPath || "index.html");
  if (candidate !== clientRoot && !candidate.startsWith(`${clientRoot}${path.sep}`)) {
    return new Response("Not Found", { status: 404 });
  }
  try {
    const stat = await fs.stat(candidate);
    if (!stat.isFile()) return new Response("Not Found", { status: 404 });
    const body = await fs.readFile(candidate);
    return new Response(body, {
      headers: { "Content-Type": MIME_TYPES[path.extname(candidate).toLowerCase()] ?? "application/octet-stream" },
    });
  } catch {
    return new Response("Not Found", { status: 404 });
  }
}

async function writeResponse(outgoing, response, method) {
  outgoing.statusCode = response.status;
  response.headers.forEach((value, key) => outgoing.setHeader(key, value));
  if (!response.body || method === "HEAD") {
    outgoing.end();
    return;
  }
  Readable.fromWeb(response.body).pipe(outgoing);
}

async function startLocalServer() {
  const outputRoot = distributionRoot();
  const handlerPath = path.join(outputRoot, "server", "index.js");
  const clientRoot = path.join(outputRoot, "client");
  const { default: handler } = await import(pathToFileURL(handlerPath).href);
  const env = { ASSETS: { fetch: (request) => serveAsset(request, clientRoot) } };

  localServer = http.createServer(async (incoming, outgoing) => {
    try {
      const method = incoming.method ?? "GET";
      const pathname = new URL(incoming.url ?? "/", "http://127.0.0.1").pathname;
      const body = method === "GET" || method === "HEAD" ? undefined : Readable.toWeb(incoming);
      const request = new Request(`http://${incoming.headers.host ?? "127.0.0.1"}${incoming.url ?? "/"}`, {
        method,
        headers: requestHeaders(incoming),
        body,
        duplex: body ? "half" : undefined,
      });

      // Vinext emits a static-asset signal for some requests, but direct browser
      // requests for CSS/JS/fonts still need to be served from the packaged client.
      if (pathname !== "/") {
        const assetResponse = await serveAsset(request, clientRoot);
        if (assetResponse.status !== 404) {
          await writeResponse(outgoing, assetResponse, method);
          return;
        }
      }

      const response = await handler.fetch(request, env, {
        passThroughOnException() {},
        waitUntil() {},
      });
      await writeResponse(outgoing, response, method);
    } catch (error) {
      console.error("Local Vocab Flow server error", error);
      outgoing.statusCode = 500;
      outgoing.end("Vocab Flow failed to render this page.");
    }
  });

  await new Promise((resolve, reject) => {
    localServer.once("error", reject);
    localServer.listen(0, "127.0.0.1", resolve);
  });
  const address = localServer.address();
  if (!address || typeof address === "string") throw new Error("Unable to determine local server port");
  return `http://127.0.0.1:${address.port}/`;
}

async function createWindow() {
  const url = await startLocalServer();
  const window = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 900,
    minHeight: 680,
    resizable: true,
    title: "简辞 · 按章节背单词",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await window.loadURL(url);
}

app.whenReady().then(async () => {
  await createWindow();
  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  localServer?.close();
});
