import { test as base } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";

export async function launchServer(dataRoot: string) {
  const child = spawn(process.execPath, [resolve("dist/api/start.js")], {
    env: { ...process.env, HOST: "127.0.0.1", PORT: "0", FOLIO_DATA_DIR: dataRoot,
      FOLIO_ENV_FILE: join(dataRoot, ".env"), LLM_MOCK: "true", LLM_API_KEY: "",
      PDF_CONVERSION_PROVIDER: "local", PDF_OCR: "false",
      JOBS_TMP_ROOT: join(dataRoot, "jobs"), OUTPUT_DIR: join(dataRoot, "books"),
      READING_DB_PATH: join(dataRoot, "reading-log.sqlite"), READING_LOG_PATH: join(dataRoot, "reading-log.json"),
      EBOOK_DEVICE_ROOTS: join(dataRoot, "devices"), DEVICE_BRIDGE_URL: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let timer: ReturnType<typeof setTimeout>;
  const close = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000);
    try { await exited; } finally { clearTimeout(timeout); }
  };
  try {
    const origin = await new Promise<string>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Folio no arranca: ${output}`)), 30_000);
      child.on("error", reject);
      child.on("exit", () => reject(new Error(output)));
      child.stderr.on("data", data => { output += data.toString(); });
      child.stdout.on("data", data => {
        output += data.toString();
        const match = output.match(/Server listening at (http:\/\/127\.0\.0\.1:\d+)/);
        if (match) resolve(match[1]);
      });
    });
    return { origin, close };
  } catch (error) { await close(); throw error; }
  finally { clearTimeout(timer!); }
}

export const test = base.extend<{ dataRoot: string; server: Awaited<ReturnType<typeof launchServer>> }>({
  dataRoot: async ({}, use) => {
    const root = await mkdtemp(join(tmpdir(), "folio-e2e-"));
    try { await use(root); } finally { await rm(root, { recursive: true, force: true }); }
  },
  server: async ({ dataRoot }, use) => {
    const server = await launchServer(dataRoot);
    try { await use(server); } finally { await server.close(); }
  },
  page: async ({ page, server }, use) => { await page.goto(server.origin); await use(page); },
});
export { expect } from "@playwright/test";
