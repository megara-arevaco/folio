import { _electron as electron, chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";

// Real app.relaunch after backup; only the file/confirmation dialogs are simulated.
// A fixed ephemeral CDP port lets the test attach to the NEW process, without Node access.
const profile = await mkdtemp(join(tmpdir(), "folio-relaunch-"));
const backup = join(profile, "backup.zip");
const listener = createServer();
await new Promise(resolve => listener.listen(0, "127.0.0.1", resolve));
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
let desktop;
let relaunchedBrowser;
let replacementPid;
const bounded = promise => Promise.race([promise, new Promise(resolve => setTimeout(resolve, 3000))]);
async function waitForExit(pid) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { process.kill(pid, 0); }
    catch (error) { if (error.code === "ESRCH") return; throw error; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Test process ${pid} did not exit`);
}
try {
  desktop = await electron.launch({
    ...(process.env.FOLIO_TEST_EXECUTABLE ? { executablePath: resolve(process.env.FOLIO_TEST_EXECUTABLE) } : {}),
    args: process.env.FOLIO_TEST_EXECUTABLE ? [] : [resolve(".")],
    chromiumSandbox: true,
    env: { ...process.env, XDG_CONFIG_HOME: profile, APPDATA: profile, LOCALAPPDATA: profile,
      FOLIO_DESKTOP_USER_DATA: profile, LLM_API_KEY: "", FOLIO_ALLOWED_ORIGINS: "" },
    timeout: 30000,
  });
  const page = await desktop.firstWindow();
  await page.waitForLoadState("networkidle");
  const originalPid = desktop.process().pid;
  const data = await desktop.evaluate(({ app }) => `${app.getPath("userData")}/data`);
  const originalOrigin = new URL(page.url()).origin;
  await page.evaluate(() => window.folioDesktop.setLanguage("en"));
  await mkdir(join(data, "books"), { recursive: true });
  await writeFile(join(data, "books", "example.epub"), "relaunch-example");
  await desktop.evaluate(({ app, dialog }, { backup, port }) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: backup });
    dialog.showMessageBox = async () => ({ response: 1 });
    dialog.showErrorBox = (_title, message) => console.error("Relaunch test error:", message);
    const realRelaunch = app.relaunch.bind(app);
    // Do not inherit Playwright's Node inspector arguments into the new process.
    app.relaunch = () => realRelaunch({ args: [`--remote-debugging-port=${port}`, "--enable-automation"] });
  }, { backup, port });
  void page.evaluate(() => window.folioDesktop.maintenance("backup")).catch(() => {});
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) { ready = true; break; }
    } catch { /* The old process is closing and the replacement has not bound yet. */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(ready, "A new Electron process must start after maintenance");
  relaunchedBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = relaunchedBrowser.contexts()[0];
  const newPage = context.pages()[0] ?? await context.waitForEvent("page");
  await newPage.waitForURL(/^http:\/\/127\.0\.0\.1:\d+/);
  await newPage.waitForLoadState("networkidle");
  assert.equal(await newPage.evaluate(() => document.documentElement.lang), "en");
  assert.equal(await newPage.evaluate(async () => (await fetch("/api/jobs")).status), 200);
  assert.equal(await readFile(join(data, "books", "example.epub"), "utf8"), "relaunch-example");
  assert.ok((await readFile(backup)).length > 0);
  await assert.rejects(fetch(`${originalOrigin}/api/jobs`));
  // The API instance lock records the PID of the replacement main process.
  const lock = JSON.parse(await readFile(join(data, ".folio-instance.lock"), "utf8"));
  assert.notEqual(lock.pid, originalPid);
  assert.equal(lock.role, "api");
  replacementPid = lock.pid;
  const session = await relaunchedBrowser.newBrowserCDPSession();
  const commandLine = await session.send("Browser.getBrowserCommandLine");
  assert.ok(!commandLine.arguments.includes("--no-sandbox"));
  await bounded(newPage.close());
  await waitForExit(replacementPid);
  replacementPid = undefined;
  await assert.rejects(readFile(join(data, ".folio-instance.lock")), { code: "ENOENT" });
  await bounded(relaunchedBrowser.close());
  relaunchedBrowser = undefined;
  await bounded(desktop.close());
  desktop = undefined;
  console.log(`Real relaunch passed: PID ${originalPid} -> ${lock.pid}; language, library and backup retained; sandbox not disabled; replacement closed cleanly.`);
} finally {
  if (relaunchedBrowser) {
    const session = await relaunchedBrowser.newBrowserCDPSession().catch(() => null);
    if (session) await bounded(session.send("Browser.close").catch(() => {}));
    await bounded(relaunchedBrowser.close());
  }
  if (replacementPid) {
    try { process.kill(replacementPid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; }
  }
  if (desktop) await bounded(desktop.close());
  await rm(profile, { recursive: true, force: true });
}
