import { app, BrowserWindow, dialog, Menu, shell } from "electron";
import { mkdirSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { join, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { localFiles } from "./localFiles";
import fastifyStatic from "@fastify/static";

app.setName("Folio");
const dataRoot = process.env.FOLIO_DATA_DIR ? resolve(process.env.FOLIO_DATA_DIR) : app.getPath("userData");
app.setPath("userData", dataRoot);
mkdirSync(dataRoot, { recursive: true });
// Load configuration before the services read it. Never use the installation as writable storage.
try { loadEnvFile(join(dataRoot, ".env")); } catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
process.env.FOLIO_DESKTOP = "true";
process.env.JOBS_TMP_ROOT ??= join(dataRoot, "jobs");
process.env.READING_DB_PATH ??= join(dataRoot, "reading-log.sqlite");
process.env.READING_LOG_PATH ??= join(dataRoot, "reading-log.json");
process.env.OUTPUT_DIR ??= join(dataRoot, "books");
process.chdir(dataRoot);
let server: FastifyInstance | undefined;
let origin = "";
let closing = false;

async function openWindow() {
  const window = new BrowserWindow({
    title: "Folio", width: 1440, height: 960, minWidth: 800, minHeight: 600,
    backgroundColor: "#fbf7f0", icon: join(__dirname, "icon.png"), show: false,
    webPreferences: { preload: join(__dirname, "preload.cjs"), nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !url.startsWith(origin + "/")) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== origin) event.preventDefault();
  });
  window.webContents.on("will-prevent-unload", (event) => {
    const choice = dialog.showMessageBoxSync(window, {
      type: "question", title: "Cerrar Folio", message: "Hay trabajos sin terminar.",
      detail: "Se guardará el progreso para poder reanudarlo al abrir Folio.",
      buttons: ["Seguir trabajando", "Salir"], defaultId: 0, cancelId: 0,
    });
    if (choice === 1) event.preventDefault();
  });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.once("ready-to-show", () => window.show());
  await window.loadURL(origin);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
      { label: "Archivo", submenu: [{ role: "close" }] },
      { label: "Editar", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
      { label: "Ver", submenu: [{ role: "reload" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { role: "togglefullscreen" }] },
    ]));
    const { createServer } = require("./api.cjs") as { createServer: (options: { localFiles: typeof localFiles }) => Promise<FastifyInstance> };
    server = await createServer({ localFiles });
    // Reject cross-origin requests to the local API, including simple form submissions.
    server.addHook("onRequest", async (request, reply) => {
      if (request.headers.origin && request.headers.origin !== origin) {
        return reply.code(403).send({ ok: false, error: "Origen no autorizado" });
      }
      if (request.headers.host !== new URL(origin).host) {
        return reply.code(403).send({ ok: false, error: "Host no autorizado" });
      }
    });
    server.addHook("onSend", async (_request, reply, payload) => {
      reply.header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'");
      return payload;
    });
    await server.register(fastifyStatic, { root: resolve(__dirname, "../../apps/web/dist") });
    server.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) return reply.code(404).send({ ok: false, error: "Ruta desconocida" });
      return reply.sendFile("index.html");
    });
    origin = await server.listen({ host: "127.0.0.1", port: 0 });
    await openWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void openWindow();
    });
  }).catch(async (error) => {
    console.error(error);
    dialog.showErrorBox("No se ha podido iniciar Folio", String(error));
    await server?.close();
    app.exit(1);
  });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
  app.on("will-quit", (event) => {
    if (closing || !server) return;
    event.preventDefault();
    closing = true;
    void server.close().finally(() => app.exit(0));
  });
}
