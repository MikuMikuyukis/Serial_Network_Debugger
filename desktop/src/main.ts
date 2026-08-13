import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, Menu, shell } from "electron";
import type { FastifyInstance } from "fastify";
import { createApp } from "../../server/src/http/app.js";

const desktopDir = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(desktopDir, "../../server/public");
const host = "127.0.0.1";

let mainWindow: BrowserWindow | null = null;
let backend: FastifyInstance | null = null;
let backendUrl: string | null = null;
let isClosingBackend = false;

function createWindow(url: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: "#f5f7fa",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  const showWindow = (): void => {
    if (!window.isDestroyed()) window.show();
  };
  window.once("ready-to-show", showWindow);
  window.webContents.once("did-finish-load", showWindow);
  window.on("closed", () => {
    mainWindow = null;
  });
  window.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    const target = new URL(targetUrl);
    const applicationOrigin = new URL(url).origin;
    const tool = target.searchParams.get("tool");
    if (target.origin === applicationOrigin
      && target.pathname === "/"
      && (tool === "presets" || tool === "dashboard" || tool === "parser")) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: tool === "parser" ? 1040 : 900,
          height: tool === "parser" ? 760 : 680,
          minWidth: tool === "parser" ? 760 : 560,
          minHeight: 480,
          backgroundColor: "#f5f7fa",
          autoHideMenuBar: true,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            spellcheck: false,
          },
        },
      };
    }
    if (targetUrl.startsWith("https://") || targetUrl.startsWith("http://")) {
      void shell.openExternal(targetUrl);
    }
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, targetUrl) => {
    if (new URL(targetUrl).origin !== new URL(url).origin) event.preventDefault();
  });
  void window.loadURL(url);
  return window;
}

async function startBackend(): Promise<string> {
  const nextBackend = await createApp({
    logger: !app.isPackaged,
    publicDir,
  });
  backend = nextBackend;
  return nextBackend.listen({ host, port: 0 });
}

async function closeBackend(): Promise<void> {
  const currentBackend = backend;
  backend = null;
  backendUrl = null;
  if (currentBackend) await currentBackend.close();
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    try {
      backendUrl = await startBackend();
      mainWindow = createWindow(backendUrl);
    } catch (error) {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      dialog.showErrorBox("Serial Network Debugger 启动失败", message);
      app.quit();
    }

    app.on("activate", () => {
      if (!mainWindow && backendUrl) mainWindow = createWindow(backendUrl);
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  if (!backend || isClosingBackend) return;
  event.preventDefault();
  isClosingBackend = true;
  void closeBackend().finally(() => app.quit());
});
