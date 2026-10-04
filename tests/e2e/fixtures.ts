import { test as base, _electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const test = base.extend<{ desktop: ElectronApplication; page: Page; dataRoot: string }>({
  dataRoot: async ({}, use) => {
    const root = await mkdtemp(join(tmpdir(), "folio-e2e-"));
    try { await use(root); } finally { await rm(root, { recursive: true, force: true }); }
  },
  desktop: async ({ dataRoot }, use) => {
    const desktop = await launchDesktop(dataRoot);
    try { await use(desktop); } finally { await desktop.close(); }
  },
  page: async ({ desktop }, use) => { await use(await desktop.firstWindow()); },
});
export { expect } from "@playwright/test";

export async function launchDesktop(dataRoot: string): Promise<ElectronApplication> {
  return _electron.launch({
      executablePath: process.env.FOLIO_E2E_EXECUTABLE,
      args: [...(process.env.FOLIO_E2E_EXECUTABLE ? [] : [resolve("dist/desktop/main.cjs")]), ...(process.env.FOLIO_E2E_NO_SANDBOX === "true" ? ["--no-sandbox"] : [])],
      env: { ...process.env, FOLIO_DATA_DIR: dataRoot, EPUB_TRANSLATOR_STANDALONE: "false",
        LLM_MOCK: "true", LLM_API_KEY: "", PDF_CONVERSION_PROVIDER: "local", PDF_OCR: "false",
        JOBS_TMP_ROOT: join(dataRoot, "jobs"), OUTPUT_DIR: join(dataRoot, "books"),
        READING_DB_PATH: join(dataRoot, "reading-log.sqlite"), READING_LOG_PATH: join(dataRoot, "reading-log.json"),
        EBOOK_DEVICE_ROOTS: join(dataRoot, "devices"), DEVICE_BRIDGE_URL: "" },
    });
}
