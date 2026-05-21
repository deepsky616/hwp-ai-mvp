const { app, BrowserWindow, shell } = require("electron");
const http = require("node:http");
const path = require("node:path");
const next = require("next");
const {
  DEFAULT_HOST,
  DEFAULT_PORT,
  buildNextServerOptions,
  resolveDesktopUrl,
  shouldStartLocalNextServer,
} = require("./launcher.cjs");

let nextServer = null;
let httpServer = null;
let callbackServer = null;

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function startCallbackServer(nextPort) {
  if (callbackServer) return;

  const server = http.createServer(async (req, res) => {
    const { pathname, query } = new URL(req.url, "http://localhost:1455");
    if (pathname !== "/auth/callback") {
      res.writeHead(404);
      res.end();
      return;
    }
    try {
      const apiUrl = `http://${DEFAULT_HOST}:${nextPort}/api/codex/login/callback?${query.toString()}`;
      const apiRes = await fetch(apiUrl);
      const result = await apiRes.json();
      const ok = result.ok === true;
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        ok
          ? "<html><body style='font-family:sans-serif;text-align:center;padding:60px'><h2>✅ 로그인이 완료되었습니다.</h2><p>이 창을 닫고 앱으로 돌아가세요.</p></body></html>"
          : `<html><body style='font-family:sans-serif;text-align:center;padding:60px'><h2>❌ 오류가 발생했습니다.</h2><p>${result.error ?? ""}</p></body></html>`,
      );
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<html><body>서버 오류</body></html>");
    }
  });

  server.on("error", (err) => {
    console.warn("[callback-server] 포트 1455 실패:", err.message);
  });

  server.listen(1455, "127.0.0.1", () => {
    callbackServer = server;
  });
}

async function startNextServer(appRoot) {
  if (!shouldStartLocalNextServer(process.env)) return resolveDesktopUrl(process.env, DEFAULT_PORT);

  const options = buildNextServerOptions({
    appRoot,
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    packaged: app.isPackaged,
  });

  nextServer = next(options);
  const handler = nextServer.getRequestHandler();
  await nextServer.prepare();

  httpServer = http.createServer((request, response) => handler(request, response));
  await listen(httpServer, DEFAULT_HOST, DEFAULT_PORT);

  return resolveDesktopUrl(process.env, DEFAULT_PORT);
}

function createWindow(url) {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    title: "HWP AI 편집기",
    backgroundColor: "#0f172a",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    shell.openExternal(targetUrl);
    return { action: "deny" };
  });

  window.loadURL(url);
}

app.whenReady().then(async () => {
  const appRoot = path.resolve(__dirname, "..", "..");
  const url = await startNextServer(appRoot);
  startCallbackServer(DEFAULT_PORT);
  createWindow(url);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(url);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (httpServer) httpServer.close();
  if (callbackServer) callbackServer.close();
});
