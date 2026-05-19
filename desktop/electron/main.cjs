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

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
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
});
