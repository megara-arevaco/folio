import { _electron as electron } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const profile = await mkdtemp(join(tmpdir(), "folio-desktop-smoke-"));
const archive = join(profile, "backup.zip");
let desktop;
const options = {
  // Playwright otherwise adds --no-sandbox implicitly, yielding a false positive.
  chromiumSandbox: process.env.FOLIO_TEST_NO_SANDBOX !== "1",
  ...(process.env.FOLIO_TEST_EXECUTABLE ? { executablePath: resolve(process.env.FOLIO_TEST_EXECUTABLE) } : {}),
  args: [...(process.env.FOLIO_TEST_EXECUTABLE ? [] : [resolve(".")]), ...(process.env.FOLIO_TEST_NO_SANDBOX === "1" ? ["--no-sandbox"] : [])],
  env: {
    ...process.env, XDG_CONFIG_HOME: profile, APPDATA: profile, LOCALAPPDATA: profile,
    FOLIO_DESKTOP_USER_DATA: profile, LLM_API_KEY: "", FOLIO_ALLOWED_ORIGINS: "",
    PDF_RENDER_COMMAND: "folio-missing-tool-test", EBOOK_CONVERT_COMMAND: "folio-missing-tool-test", GIO_COMMAND: "folio-missing-tool-test",
  }, timeout: 30000,
};

async function launch() {
  desktop = await electron.launch(options);
  const page = await desktop.firstWindow();
  await page.waitForLoadState("networkidle");
  await page.setViewportSize({ width: 1280, height: 900 });
  return page;
}

async function stop() {
  await desktop.evaluate(({ app }) => app.quit());
  await desktop.close();
  desktop = undefined;
}

async function stubDialogs(file, response = 1) {
  await desktop.evaluate(({ app, dialog }, { file, response }) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    dialog.showMessageBox = async () => ({ response });
    dialog.showErrorBox = (_title, message) => { console.error("Smoke native error:", message); };
    // Test the requested restart by reopening explicitly with the same disposable profile.
    app.relaunch = () => {};
  }, { file, response });
}

async function operationThatRestarts(page, command) {
  // The renderer is destroyed by app.quit once maintenance completes.
  await page.evaluate(command => window.folioDesktop.maintenance(command), command).catch(() => {});
  await desktop.close();
  desktop = undefined;
}

try {
  let page = await launch();
  const sandboxDisabled = await desktop.evaluate(({ app }) => app.commandLine.hasSwitch("no-sandbox"));
  assert.equal(sandboxDisabled, process.env.FOLIO_TEST_NO_SANDBOX === "1");
  console.log(sandboxDisabled ? "WARNING: sandbox explicitly disabled for this isolated test." : "Electron launched without --no-sandbox.");
  if (process.platform === "linux" && !sandboxDisabled) {
    const rendererPid = await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getOSProcessId());
    const processStatus = await readFile(`/proc/${rendererPid}/status`, "utf8");
    assert.match(processStatus, /^NoNewPrivs:\s+1$/m);
    assert.match(processStatus, /^Seccomp:\s+2$/m);
    console.log("Linux renderer: NoNewPrivs=1, Seccomp=2 (filter active).");
  }
  const data = await desktop.evaluate(({ app }) => `${app.getPath("userData")}/data`);
  const origin = new URL(page.url()).origin;
  assert.equal(await page.evaluate(() => typeof window.require), "undefined");
  assert.equal((await fetch(`${origin}/api/jobs`)).status, 401);
  assert.equal(await page.evaluate(async () => (await fetch("/api/jobs")).status), 200);
  const preferences = await desktop.evaluate(({ BrowserWindow }) => {
    const options = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return { sandbox: options.sandbox, contextIsolation: options.contextIsolation, nodeIntegration: options.nodeIntegration };
  });
  assert.deepEqual(preferences, { sandbox: true, contextIsolation: true, nodeIntegration: false });
  assert.equal(await page.evaluate(() => window.folioDesktop.capabilities.poppler), false);
  await assert.rejects(page.evaluate(() => window.folioDesktop.maintenance("delete")));
  assert.equal((await page.request.get(origin)).status(), 401);
  await page.goto(`${origin}/settings`);
  await page.getByRole("heading", { name: "Funciones de este equipo" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Crear copia…" }).count(), 1);
  assert.equal(await page.getByRole("button", { name: "Copiar comando de copia" }).count(), 0);
  if (process.env.FOLIO_TEST_SCREENSHOTS === "1") {
    await mkdir("test-results/desktop", { recursive: true });
    for (const width of [1280, 760]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: `test-results/desktop/settings-${width}.png`, fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("combobox", { name: "Idioma" }).selectOption("en");
  await page.getByRole("heading", { name: "Features on this computer" }).waitFor();
  // Ensure the async preference write has completed before closing the profile.
  await page.evaluate(() => window.folioDesktop.setLanguage("en"));
  await mkdir(join(data, "books"), { recursive: true });
  await writeFile(join(data, "books", "example.epub"), "original-book");
  await stubDialogs(archive, 0);
  assert.deepEqual(await page.evaluate(() => window.folioDesktop.maintenance("backup")), { status: "cancelled" });
  assert.equal(await page.evaluate(async () => (await fetch("/api/jobs")).status), 200);
  await stubDialogs(archive);
  await operationThatRestarts(page, "backup");
  assert.ok((await readFile(archive)).length > 0);
  await assert.rejects(fetch(`${origin}/api/jobs`));
  console.log("Desktop backup passed: cancel is harmless, confirmed backup closes the API.");

  await writeFile(join(data, "books", "example.epub"), "changed-book");
  page = await launch();
  assert.equal(await page.evaluate(() => document.documentElement.lang), "en");
  assert.equal(await page.evaluate(() => window.folioDesktop.language), "en");
  await page.goto(`${new URL(page.url()).origin}/settings`);
  await stubDialogs(archive);
  assert.deepEqual(await page.evaluate(() => window.folioDesktop.maintenance("verify")), { status: "success" });
  assert.equal(await page.evaluate(async () => (await fetch("/api/jobs")).status), 200);
  await stubDialogs(archive, 0);
  assert.deepEqual(await page.evaluate(() => window.folioDesktop.maintenance("restore")), { status: "cancelled" });
  assert.equal(await readFile(join(data, "books", "example.epub"), "utf8"), "changed-book");
  // Preferences are profile-local, not overwritten by a restored library.
  await page.getByRole("combobox", { name: "Language" }).selectOption("es");
  await page.evaluate(() => window.folioDesktop.setLanguage("es"));
  await stubDialogs(archive);
  await operationThatRestarts(page, "restore");
  assert.equal(await readFile(join(data, "books", "example.epub"), "utf8"), "original-book");
  page = await launch();
  assert.equal(await page.evaluate(() => document.documentElement.lang), "es");
  assert.equal(await page.evaluate(async () => (await fetch("/api/jobs")).status), 200);
  const finalOrigin = new URL(page.url()).origin;
  await stop();
  await assert.rejects(fetch(`${finalOrigin}/api/jobs`));
  console.log("Desktop smoke passed: sandbox preferences, narrow bridge, missing-tool diagnostics, locale persistence, verify/restore and ordered shutdown.");
} finally {
  await desktop?.close();
  await rm(profile, { recursive: true, force: true });
}
