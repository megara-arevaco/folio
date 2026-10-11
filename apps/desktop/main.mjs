import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, session, shell } from "electron";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { readPreferences, writeLanguage } from "./preferences.mjs";
import { createMaintenanceController, runDataTool } from "./maintenance.mjs";

app.setName("Folio");
if (!app.isPackaged && process.env.FOLIO_DESKTOP_USER_DATA) {
  app.setPath("userData", resolve(process.env.FOLIO_DESKTOP_USER_DATA));
}
const root = resolve(import.meta.dirname, "../..");
const profile = app.getPath("userData");
const data = join(profile, "data");
let preferences;
let server;
let window;
let origin;
let dependencies;
let getDependencies;
let shuttingDown = false;
let shutdownComplete = false;
let maintenanceBusy = false;
let restartPending = false;
const text = (es, en) => preferences?.language === "en" ? en : es;
const secureStorageAvailable = () => safeStorage.isEncryptionAvailable() &&
  !(process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text");
const status = () => ({ ...dependencies, secureStorage: secureStorageAvailable() });

const maintenance = createMaintenanceController({
  stop: async () => {
    await server?.close();
    server = undefined;
  },
  run: (command, file) => runDataTool({ root, data, command, file }),
  restart: async () => { restartPending = true; },
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (window?.isMinimized()) window.restore();
    window?.show();
    window?.focus();
  });
  app.on("before-quit", event => {
    if (shutdownComplete) return;
    event.preventDefault();
    // Never interrupt a backup/restore or start another close while it owns the data.
    if (maintenanceBusy || shuttingDown) return;
    shuttingDown = true;
    void (async () => {
      try {
        await server?.close();
        shutdownComplete = true;
        app.quit();
      } catch (error) {
        shuttingDown = false;
        dialog.showErrorBox(text("No se pudo cerrar Folio", "Could not close Folio"), String(error.message ?? error));
      }
    })();
  });
  app.on("window-all-closed", () => app.quit());
  void app.whenReady().then(start).catch(handleStartupError);
}

async function handleStartupError(error) {
  const canRecover = /bloqueo.*abandonado|restauración pendiente/i.test(String(error.message)) &&
    (existsSync(join(data, ".folio-instance.lock")) || existsSync(join(data, ".folio-restore-journal.json")));
  const choice = await dialog.showMessageBox({
    type: "error", title: "Folio", message: text("No se pudo iniciar Folio", "Could not start Folio"),
    detail: `${error.message}\n\n${data}`,
    buttons: canRecover
      ? [text("Cerrar", "Close"), text("Abrir carpeta", "Open folder"), text("Recuperar y reiniciar", "Recover and restart")]
      : [text("Cerrar", "Close"), text("Abrir carpeta", "Open folder")],
    defaultId: 0, cancelId: 0, noLink: true,
  });
  if (choice.response === 1) await shell.openPath(profile);
  if (canRecover && choice.response === 2) {
    try {
      await runDataTool({ root, data, command: "recover" });
      app.relaunch();
    } catch (recoveryError) {
      dialog.showErrorBox(text("No se pudo recuperar Folio", "Recovery failed"), recoveryError.message);
    }
  }
  app.quit();
}

function trusted(event) {
  try {
    return window && !window.isDestroyed() && event.sender === window.webContents &&
      event.senderFrame === window.webContents.mainFrame && new URL(event.senderFrame.url).origin === origin;
  } catch { return false; }
}

function registerBridge() {
  ipcMain.on("folio:bootstrap", event => {
    event.returnValue = trusted(event) ? { language: preferences.language, capabilities: status() } : null;
  });
  ipcMain.handle("folio:language", (event, language) => {
    if (!trusted(event)) throw new Error("Origen de escritorio no autorizado");
    try {
      preferences = writeLanguage(profile, language);
      buildMenu();
      return preferences.language;
    } catch (error) {
      dialog.showErrorBox(text("No se pudo guardar el idioma", "Could not save language"), error.message);
      throw error;
    }
  });
  ipcMain.handle("folio:capabilities", async event => {
    if (!trusted(event)) throw new Error("Origen de escritorio no autorizado");
    dependencies = await getDependencies();
    return status();
  });
  ipcMain.handle("folio:maintenance", (event, command) => {
    if (!trusted(event) || !["backup", "verify", "restore"].includes(command)) {
      throw new Error("Operación de escritorio no autorizada");
    }
    return performMaintenance(command);
  });
}

async function performMaintenance(command) {
  if (maintenanceBusy || shuttingDown) return { status: "busy" };
  maintenanceBusy = true;
  buildMenu();
  let file;
  try {
    if (command === "backup") {
      const selected = await dialog.showSaveDialog(window, {
        title: text("Crear copia de Folio", "Back up Folio"),
        defaultPath: join(app.getPath("documents"), `folio-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`),
        filters: [{ name: "Folio ZIP", extensions: ["zip"] }],
      });
      if (selected.canceled || !selected.filePath) return { status: "cancelled" };
      file = selected.filePath;
      // The CLI publishes without overwriting. Do not remove an existing archive.
      if (existsSync(file)) throw new Error(text("Elige un nombre nuevo: no se sobrescriben copias existentes.", "Choose a new name: existing backups are never overwritten."));
    } else {
      const selected = await dialog.showOpenDialog(window, {
        title: text("Seleccionar copia de Folio", "Choose a Folio backup"),
        properties: ["openFile"], filters: [{ name: "Folio ZIP", extensions: ["zip"] }],
      });
      if (selected.canceled || !selected.filePaths[0]) return { status: "cancelled" };
      file = selected.filePaths[0];
    }
    if (command === "restore") {
      // Verify before stopping the engine or presenting a destructive confirmation.
      await runDataTool({ root, data, command: "verify", file });
    }
    if (command !== "verify") {
      const choice = await dialog.showMessageBox(window, {
        type: command === "restore" ? "warning" : "question", title: "Folio",
        message: command === "restore"
          ? text("¿Restaurar esta copia y sustituir la biblioteca actual?", "Restore this backup and replace the current library?")
          : text("¿Pausar los trabajos y crear una copia?", "Pause jobs and create a backup?"),
        detail: `${file}\n\n${text("Folio se reiniciará. Los trabajos quedarán pausados. Guarda los cambios de formularios antes de continuar. Las claves y preferencias no se incluyen.", "Folio will restart. Jobs will remain paused. Save form changes before continuing. Keys and preferences are not included.")}${command === "restore" ? `\n${text("Se crea una copia previa recuperable en data/backups antes de sustituir datos.", "A recovery backup is created in data/backups before replacing data.")}` : ""}`,
        buttons: [text("Cancelar", "Cancel"), command === "restore" ? text("Restaurar y reiniciar", "Restore and restart") : text("Crear copia y reiniciar", "Back up and restart")],
        defaultId: 0, cancelId: 0, noLink: true,
      });
      if (choice.response !== 1) return { status: "cancelled" };
    }
    window.setProgressBar(2);
    window.setEnabled(false);
    const output = await maintenance.execute(command, file);
    await dialog.showMessageBox(window, {
      type: "info", title: "Folio", message: text("Operación completada", "Operation completed"), detail: output,
    });
    return { status: "success" };
  } catch (error) {
    dialog.showErrorBox(text("No se pudo completar la operación", "Operation failed"), String(error.message ?? error));
    return { status: "error", message: error.message };
  } finally {
    maintenanceBusy = false;
    if (window && !window.isDestroyed()) {
      window.setProgressBar(-1);
      window.setEnabled(true);
    }
    buildMenu();
    if (restartPending) {
      app.relaunch();
      app.quit();
    }
  }
}

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "Folio", submenu: [
      { label: text("Crear copia…", "Back up…"), enabled: !maintenanceBusy, click: () => void performMaintenance("backup") },
      { label: text("Verificar copia…", "Verify backup…"), enabled: !maintenanceBusy, click: () => void performMaintenance("verify") },
      { label: text("Restaurar copia…", "Restore backup…"), enabled: !maintenanceBusy, click: () => void performMaintenance("restore") },
      { label: text("Abrir carpeta de datos", "Open data folder"), click: () => void shell.openPath(data) },
      { type: "separator" }, { role: "quit", label: text("Salir de Folio", "Quit Folio"), enabled: !maintenanceBusy },
    ] },
    { label: text("Editar", "Edit"), submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    { label: text("Ver", "View"), submenu: [{ role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { role: "togglefullscreen" }] },
  ]));
}

async function start() {
  preferences = readPreferences(profile);
  mkdirSync(data, { recursive: true, mode: 0o700 });
  Object.assign(process.env, {
    FOLIO_ENV_FILE: join(profile, "desktop.env"), FOLIO_DATA_DIR: data,
    JOBS_TMP_ROOT: join(data, "jobs"), OUTPUT_DIR: join(data, "books"),
    READING_DB_PATH: join(data, "reading-log.sqlite"), READING_LOG_PATH: join(data, "reading-log.json"),
    FOLIO_SETTINGS_PATH: join(data, "settings.json"), FOLIO_WEB_ROOT: join(root, "apps/web/dist"),
    TESSDATA_PREFIX: app.isPackaged ? join(process.resourcesPath, "ocr") : root,
    FOLIO_DESKTOP_TOKEN: randomBytes(32).toString("hex"), LLM_MOCK: "false", PDF_CONVERSION_PROVIDER: "local",
  });
  const { createServer, configureSettingsSecretCodec, getRuntimeDependencies } = await import("../../dist/desktop/api.mjs");
  getDependencies = getRuntimeDependencies;
  dependencies = await getDependencies();
  configureSettingsSecretCodec({
    encrypt(value) {
      if (!secureStorageAvailable()) throw new Error("Configura un llavero seguro del sistema antes de guardar una clave IA.");
      return safeStorage.encryptString(value).toString("base64");
    },
    decrypt(value) {
      if (!secureStorageAvailable()) throw new Error("El almacén seguro no está disponible; desbloquea el llavero del sistema.");
      return safeStorage.decryptString(Buffer.from(value, "base64"));
    },
  });
  server = await createServer();
  origin = await server.listen({ host: "127.0.0.1", port: 0 });
  registerBridge();
  const desktopSession = session.fromPartition("folio-desktop");
  desktopSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  desktopSession.setPermissionCheckHandler(() => false);
  desktopSession.on("will-download", (_event, item) => item.setSaveDialogOptions({ title: text("Guardar archivo de Folio", "Save Folio file") }));
  desktopSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders };
    delete headers["X-Folio-Desktop-Token"];
    delete headers["x-folio-desktop-token"];
    if (new URL(details.url).origin === origin) headers["X-Folio-Desktop-Token"] = process.env.FOLIO_DESKTOP_TOKEN;
    callback({ requestHeaders: headers });
  });
  desktopSession.webRequest.onHeadersReceived((details, callback) => {
    if (new URL(details.url).origin !== origin) return callback({});
    callback({ responseHeaders: {
      ...details.responseHeaders,
      "Content-Security-Policy": ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"],
    } });
  });
  window = new BrowserWindow({
    title: "Folio", width: 1280, height: 900, minWidth: 760, minHeight: 600,
    show: false, backgroundColor: "#f9f5ed",
    webPreferences: {
      session: desktopSession, nodeIntegration: false, contextIsolation: true,
      sandbox: true, webSecurity: true, devTools: !app.isPackaged,
      preload: join(root, "apps/desktop/preload.cjs"),
    },
  });
  window.on("close", event => { if (maintenanceBusy) event.preventDefault(); });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== origin) event.preventDefault();
  });
  window.webContents.on("will-attach-webview", event => event.preventDefault());
  buildMenu();
  window.once("ready-to-show", () => window.show());
  await window.loadURL(origin);
}
