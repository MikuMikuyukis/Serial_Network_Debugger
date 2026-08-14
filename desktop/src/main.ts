import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, Menu, shell } from "electron";
import type { FastifyInstance } from "fastify";
import { createApp } from "../../server/src/http/app.js";
import {
  DESKTOP_HELP,
  desktopUserDataPath,
  isLoopbackHost,
  parseDesktopOptions,
} from "./options.js";

const desktopDir = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(desktopDir, "../../server/public");
const options = readDesktopOptions();
const defaultUserDataPath = app.getPath("userData");
app.setPath("userData", desktopUserDataPath(defaultUserDataPath, options.instanceId));

let mainWindow: BrowserWindow | null = null;
let backend: FastifyInstance | null = null;
let backendUrl: string | null = null;
let isClosingBackend = false;

interface BackendEndpoint {
  windowUrl: string;
  webAddress: string;
}

function createWindow(url: string, windowTitle: string): BrowserWindow {
  const window = new BrowserWindow({
    title: windowTitle,
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
  window.on("page-title-updated", (event) => {
    event.preventDefault();
    window.setTitle(windowTitle);
  });
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

async function startBackend(): Promise<BackendEndpoint> {
  const nextBackend = await createApp({
    logger: !app.isPackaged,
    publicDir,
  });
  backend = nextBackend;
  await nextBackend.listen({ host: options.webHost, port: options.webPort });
  const address = nextBackend.server.address();
  if (!address || typeof address === "string") throw new Error("无法读取 Electron 后端监听端口");
  const localHost = options.webHost === "0.0.0.0"
    ? "127.0.0.1"
    : options.webHost === "::" ? "::1" : options.webHost;
  return {
    windowUrl: httpUrl(localHost, address.port),
    webAddress: httpUrl(options.webHost, address.port),
  };
}

async function closeBackend(): Promise<void> {
  const currentBackend = backend;
  backend = null;
  backendUrl = null;
  if (currentBackend) await currentBackend.close();
}

let mainWindowTitle = "Serial Network Debugger";

const hasInstanceLock = app.requestSingleInstanceLock({ instanceId: options.instanceId });
if (!hasInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  void startDesktop();
}

async function startDesktop(): Promise<void> {
  await app.whenReady();
  Menu.setApplicationMenu(null);
  try {
    const endpoint = await startBackend();
    backendUrl = endpoint.windowUrl;
    mainWindowTitle = `Serial Network Debugger [${options.instanceId}] - Web ${endpoint.webAddress}`;
    process.stdout.write(`${mainWindowTitle}\n`);
    if (!isLoopbackHost(options.webHost)) {
      process.stderr.write("警告：Web 服务正在非回环地址监听，当前没有身份认证，请仅用于可信网络。\n");
    }
    mainWindow = createWindow(backendUrl, mainWindowTitle);
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    dialog.showErrorBox(`Serial Network Debugger [${options.instanceId}] 启动失败`, message);
    app.quit();
  }

  app.on("activate", () => {
    if (!mainWindow && backendUrl) mainWindow = createWindow(backendUrl, mainWindowTitle);
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

function readDesktopOptions(): ReturnType<typeof parseDesktopOptions> {
  try {
    const parsed = parseDesktopOptions(process.argv.slice(app.isPackaged ? 1 : 2));
    if (parsed.help) {
      process.stdout.write(DESKTOP_HELP);
      process.exit(0);
    }
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n\n${DESKTOP_HELP}`);
    process.exit(1);
  }
}

function httpUrl(host: string, port: number): string {
  const formattedHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `http://${formattedHost}:${port}`;
}
