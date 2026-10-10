import AdmZip from "adm-zip";
import { createServer as createHttpServer } from "node:http";
import { once } from "node:events";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { test, expect, launchServer } from "./fixtures";

const execFileAsync = promisify(execFile);

function fictionalEpub(paragraphCount = 1) {
  const zip = new AdmZip();
  zip.addFile("mimetype", Buffer.from("application/epub+zip"));
  zip.addFile("META-INF/container.xml", Buffer.from(`<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`));
  zip.addFile("OEBPS/content.opf", Buffer.from(`<?xml version="1.0"?><package version="3.0" unique-identifier="id" xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">fictional-backup</dc:identifier><dc:title>Libro de prueba</dc:title><dc:creator>Autora ficticia</dc:creator><dc:language>en</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>`));
  const paragraphs = Array.from({ length: paragraphCount }, (_, index) => `<p>At dawn Mira opened the old book and found a map below the lighthouse. Fictional passage ${index + 1}.</p>`).join("");
  zip.addFile("OEBPS/chapter.xhtml", Buffer.from(`<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>The quiet lighthouse</h1>${paragraphs}</body></html>`));
  return zip.toBuffer();
}

async function fictionalPdf(pageCount: number) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < pageCount; index++) {
    pdf.addPage().drawText(`Fictional selectable page ${index + 1}. A lighthouse keeper studies the printed map.`, { x: 40, y: 720, font, size: 14 });
  }
  return Buffer.from(await pdf.save());
}

async function runCli(...args: string[]) {
  return execFileAsync(process.execPath, [resolve("scripts/folio-data.mjs"), ...args], { cwd: process.cwd() });
}

async function runCliWithEnv(env: NodeJS.ProcessEnv, ...args: string[]) {
  return execFileAsync(process.execPath, [resolve("scripts/folio-data.mjs"), ...args], { cwd: process.cwd(), env: { ...process.env, ...env } });
}

async function startLocalProvider() {
  const requests: Array<Record<string, unknown>> = [];
  let translationAttempts = 0;
  let failTranslationsAfterFirst = true;
  const provider = createHttpServer((request, response) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => { raw += chunk; });
    request.on("end", () => {
      const body = JSON.parse(raw) as Record<string, unknown>;
      requests.push(body);
      const messages = body.messages as Array<{ role?: string; content?: unknown }> | undefined;
      if (Array.isArray(body.plugins)) {
        const content = messages?.[1]?.content as Array<{ text?: string }> | undefined;
        const text = content?.[0]?.text ?? "";
        const match = text.match(/absolute page numbers: (\[[^\]]+\])/);
        const pages = match ? JSON.parse(match[1]!) as number[] : [];
        response.writeHead(200, { "Content-Type": "application/json" });
        const transcription = { pages: pages.map((page) => ({
          page, html: `<p>Fictional transcription for page ${page}.</p>`, continuesPrevious: false, joinPreviousWord: false, isToc: false, isBlank: false, figures: [],
        })) };
        response.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(transcription) } }] }));
        return;
      }
      if (String(messages?.[0]?.content ?? "").includes("editor literario")) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ glossary: [] }) } }] }));
        return;
      }
      translationAttempts += 1;
      if (failTranslationsAfterFirst && translationAttempts > 1) {
        response.writeHead(503, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "test-only retry outage" }));
        return;
      }
      const prompt = String(messages?.[1]?.content ?? "");
      const match = prompt.match(/Items:\n([\s\S]*)$/);
      const items = match ? JSON.parse(match[1]!) as Array<{ id: string; text: string }> : [];
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items: items.map((item) => ({ id: item.id, text: `Stub ${item.text}` })) }) } }] }));
    });
  });
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  const address = provider.address();
  if (!address || typeof address === "string") throw new Error("No se ha podido iniciar el proveedor local simulado");
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    requests,
    translationAttempts: () => translationAttempts,
    setTranslationFailure: (enabled: boolean) => { failTranslationsAfterFirst = enabled; },
    close: () => new Promise<void>((resolveClose, reject) => provider.close((error) => error ? reject(error) : resolveClose())),
  };
}

test("backup global offline, verificación, restauración explícita, SQLite, originales, checkpoints y revisiones", async ({ page, dataRoot, server }) => {
  const origin = new URL(page.url()).origin;
  const concurrentBackupPath = join(dataRoot, "backups", "must-not-run-while-server-is-active.zip");
  await expect(runCli("backup", "--data-dir", dataRoot, "--file", concurrentBackupPath)).rejects.toThrow(/Folio está activo/);
  await expect(access(concurrentBackupPath)).rejects.toThrow();
  const readingResponse = await page.request.post(`${origin}/api/reading-log`, { data: {
    openLibraryKey: null, title: "Lectura de respaldo ficticia", authors: ["Autora de prueba"], coverUrl: null,
    firstPublishYear: 2026, isbn: null, categories: ["Ficción"],
  } });
  expect(readingResponse.status()).toBe(201);
  const reading = (await readingResponse.json()).data as { id: string };

  const upload = await page.request.post(`${origin}/api/translate`, { multipart: {
    file: { name: "libro-ficticio.epub", mimeType: "application/epub+zip", buffer: fictionalEpub() },
  } });
  expect(upload.status()).toBe(201);
  const { data: { jobId } } = await upload.json();
  await expect.poll(async () => (await (await page.request.get(`${origin}/api/jobs/${jobId}`)).json()).data.status).toBe("done");
  const metadata = await page.request.patch(`${origin}/api/jobs/${jobId}/metadata`, { data: {
    title: "Libro ficticio editado", authors: ["Autora de prueba"], language: "es", publisher: "", description: "",
  } });
  expect(metadata.ok()).toBe(true);
  const revisions = await page.request.get(`${origin}/api/jobs/${jobId}/revisions`);
  expect((await revisions.json()).data.length).toBe(1);
  const legacyBulkDelete = await page.request.delete(`${origin}/api/jobs/completed`);
  expect(legacyBulkDelete.status()).toBe(409);
  expect((await (await page.request.get(`${origin}/api/jobs/${jobId}`)).json()).data.status).toBe("done");

  const pausedUpload = await page.request.post(`${origin}/api/translate`, { multipart: {
    file: { name: "checkpoint-ficticio.epub", mimeType: "application/epub+zip", buffer: fictionalEpub(1800) },
  } });
  expect(pausedUpload.status()).toBe(201);
  const { data: { jobId: pausedJobId } } = await pausedUpload.json();
  await page.request.post(`${origin}/api/jobs/${pausedJobId}/pause`);
  await expect.poll(async () => (await (await page.request.get(`${origin}/api/jobs/${pausedJobId}`)).json()).data.status, { timeout: 30_000 }).toBe("paused");
  const glossary = await page.request.put(`${origin}/api/jobs/${pausedJobId}/glossary`, { data: { glossary: [{ source: "Old Keeper", target: "Antiguo guardián", type: "name" }] } });
  expect(glossary.ok()).toBe(true);
  await writeFile(join(dataRoot, "settings.json"), JSON.stringify({ openRouterApiKey: "sk-or-v1-fake-backup-secret" }));
  await writeFile(join(dataRoot, ".env"), "LLM_API_KEY=sk-or-v1-fake-backup-secret\n");

  await server.close();
  const archivePath = join(dataRoot, "backups", "fictional-global.zip");
  const created = await runCli("backup", "--data-dir", dataRoot, "--file", archivePath);
  expect(created.stdout).toContain("Copia creada:");
  const verified = await runCli("verify", "--file", archivePath);
  expect(verified.stdout).toContain("folio-global-backup v1");
  expect(verified.stdout).toContain("no ha escrito en el directorio de datos");
  const zip = new AdmZip(await readFile(archivePath));
  const archiveNames = zip.getEntries().map((entry) => entry.entryName);
  expect(archiveNames).toContain("reading/reading-log.sqlite");
  expect(archiveNames).toContain(`jobs/${jobId}/input.epub`);
  expect(archiveNames.some((name) => name.startsWith(`jobs/${jobId}/revisions/`) && name.endsWith(".epub"))).toBe(true);
  expect(archiveNames).toContain(`jobs/${pausedJobId}/job.json`);
  expect(archiveNames).not.toContain("settings.json");
  expect(archiveNames).not.toContain(".env");
  expect(zip.toBuffer().includes(Buffer.from("sk-or-v1-fake-backup-secret"))).toBe(false);

  const changed = await launchServer(dataRoot);
  try {
    expect((await changed).origin).toContain("127.0.0.1");
    const deleteJob = await page.request.delete(`${changed.origin}/api/jobs/${jobId}`);
    expect(deleteJob.status()).toBe(204);
    const deleteReading = await page.request.delete(`${changed.origin}/api/reading-log/${reading.id}`);
    expect(deleteReading.status()).toBe(204);
    expect((await (await page.request.get(`${changed.origin}/api/reading-log`)).json()).data).toHaveLength(0);
  } finally { await changed.close(); }
  await expect(access(join(dataRoot, "jobs", jobId, "job.json"))).rejects.toThrow();
  const currentDatabase = await readFile(join(dataRoot, "reading-log.sqlite"));

  await expect(runCli("restore", "--data-dir", dataRoot, "--file", archivePath)).rejects.toThrow(/RESTORE FOLIO DATA/);
  await expect(access(join(dataRoot, "jobs", jobId, "job.json"))).rejects.toThrow();
  expect(await readFile(join(dataRoot, "reading-log.sqlite"))).toEqual(currentDatabase);
  const restoreRoot = join(dataRoot, "restored-copy");
  const restored = await runCli("restore", "--data-dir", restoreRoot, "--file", archivePath, "--confirm", "RESTORE FOLIO DATA");
  expect(restored.stdout).toContain("Copia previa recuperable:");
  const backupFiles = await readdir(join(restoreRoot, "backups"));
  expect(backupFiles.some((name) => name.startsWith("folio-before-restore-"))).toBe(true);
  expect(JSON.parse(await readFile(join(dataRoot, "settings.json"), "utf8")).openRouterApiKey).toBe("sk-or-v1-fake-backup-secret");
  await expect(access(join(restoreRoot, "settings.json"))).rejects.toThrow();
  const restoredRecord = JSON.parse(await readFile(join(restoreRoot, "jobs", jobId, "job.json"), "utf8"));
  expect(restoredRecord.inputFilePath).toBe(join(restoreRoot, "jobs", jobId, "input.epub"));
  expect(restoredRecord.outputFilePath).toBe(join(restoreRoot, "books", restoredRecord.outputFileName));

  const restoredServer = await launchServer(restoreRoot);
  try {
    const jobs = await (await fetch(`${restoredServer.origin}/api/jobs`)).json() as { data: Array<{ id: string; status: string }> };
    expect(jobs.data.find((job) => job.id === jobId)?.status).toBe("done");
    expect(jobs.data.find((job) => job.id === pausedJobId)?.status).toBe("paused");
    expect((await (await fetch(`${restoredServer.origin}/api/jobs/${pausedJobId}/glossary`)).json()).data).toEqual([{ source: "Old Keeper", target: "Antiguo guardián", type: "name" }]);
    expect((await (await fetch(`${restoredServer.origin}/api/reading-log`)).json()).data[0].title).toBe("Lectura de respaldo ficticia");
    const original = await fetch(`${restoredServer.origin}/api/jobs/${jobId}/original/download`);
    expect(original.headers.get("content-type")).toContain("application/epub+zip");
    expect(original.ok).toBe(true);
  } finally { await restoredServer.close(); }
});

test("ZIP malformado y traversal no modifican datos; un diario incompleto permite recuperar rollback", async ({ dataRoot, server }) => {
  await mkdir(join(dataRoot, "books"), { recursive: true });
  await writeFile(join(dataRoot, "books", "sentinel.epub"), "datos actuales ficticios");
  await server.close();
  const maliciousPath = join(dataRoot, "backups", "traversal.zip");
  await mkdir(join(dataRoot, "backups"), { recursive: true });
  const zip = new AdmZip();
  zip.addFile("books/xx/outside.txt", Buffer.from("no debe escribirse"));
  const maliciousBytes = zip.toBuffer();
  const safeName = Buffer.from("books/xx/outside.txt");
  const traversalName = Buffer.from("books/../outside.txt");
  for (let offset = maliciousBytes.indexOf(safeName); offset >= 0; offset = maliciousBytes.indexOf(safeName, offset + safeName.length)) traversalName.copy(maliciousBytes, offset);
  await writeFile(maliciousPath, maliciousBytes);
  await expect(runCli("restore", "--data-dir", dataRoot, "--file", maliciousPath, "--confirm", "RESTORE FOLIO DATA")).rejects.toThrow(/Ruta ZIP no permitida/);
  expect(await readFile(join(dataRoot, "books", "sentinel.epub"), "utf8")).toBe("datos actuales ficticios");
  await expect(access(join(dataRoot, "outside.txt"))).rejects.toThrow();
  const malformedPath = join(dataRoot, "backups", "malformed.zip");
  await writeFile(malformedPath, "not a zip archive");
  await expect(runCli("verify", "--file", malformedPath)).rejects.toThrow();
  await expect(runCli("restore", "--data-dir", dataRoot, "--file", malformedPath, "--confirm", "RESTORE FOLIO DATA")).rejects.toThrow();
  expect(await readFile(join(dataRoot, "books", "sentinel.epub"), "utf8")).toBe("datos actuales ficticios");
  expect(await readdir(join(dataRoot, "books"))).toEqual(["sentinel.epub"]);
  const symlinkPath = join(dataRoot, "backups", "symlink.zip");
  const symlinkZip = new AdmZip();
  symlinkZip.addFile("books/link.txt", Buffer.from("outside target"));
  const symlinkBytes = symlinkZip.toBuffer();
  const centralDirectory = symlinkBytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  expect(centralDirectory).toBeGreaterThanOrEqual(0);
  symlinkBytes.writeUInt32LE(0xa1ff0000, centralDirectory + 38);
  await writeFile(symlinkPath, symlinkBytes);
  await expect(runCli("verify", "--file", symlinkPath)).rejects.toThrow(/enlaces/);
  const highRatioPath = join(dataRoot, "backups", "high-ratio.zip");
  const highRatioZip = new AdmZip();
  highRatioZip.addFile("books/high-ratio.bin", Buffer.alloc(2 * 1024 * 1024));
  await writeFile(highRatioPath, highRatioZip.toBuffer());
  await expect(runCli("verify", "--file", highRatioPath)).rejects.toThrow(/Tamaño o compresión no permitidos/);
  expect(await readdir(join(dataRoot, "books"))).toEqual(["sentinel.epub"]);

  const transaction = `.folio-restore-${randomUUID()}`;
  const previous = join(dataRoot, transaction, "previous");
  await mkdir(previous, { recursive: true });
  await rename(join(dataRoot, "books"), join(previous, "books"));
  await mkdir(join(dataRoot, "books"), { recursive: true });
  await writeFile(join(dataRoot, "books", "replacement.epub"), "staged replacement");
  await writeFile(join(dataRoot, ".folio-restore-journal.json"), JSON.stringify({
    version: 1, directory: transaction, phase: "applying",
    hadOriginal: { jobs: false, books: true, readingDatabase: false, readingJson: false, usage: false }, applied: ["books"],
  }));
  await expect(launchServer(dataRoot)).rejects.toThrow(/restauración pendiente/);
  await expect(access(join(dataRoot, ".folio-instance.lock"))).rejects.toThrow();
  expect(await readdir(join(dataRoot, "books"))).toEqual(["replacement.epub"]);
  const recovered = await runCli("recover", "--data-dir", dataRoot);
  expect(recovered.stdout).toContain("Se recuperó el estado de una restauración interrumpida");
  expect(await readdir(join(dataRoot, "books"))).toEqual(["sentinel.epub"]);
  expect(await readFile(join(dataRoot, "books", "sentinel.epub"), "utf8")).toBe("datos actuales ficticios");
});

test("una limpieza fallida tras commit conserva datos; el API espera recuperación CLI idempotente", async ({ dataRoot }) => {
  const books = join(dataRoot, "books");
  await mkdir(books, { recursive: true });
  await writeFile(join(books, "libro-ficticio.epub"), "contenido confirmado de la copia");
  const archive = join(dataRoot, "backups", "restore-cleanup-fixture.zip");
  await runCli("backup", "--data-dir", dataRoot, "--file", archive);
  await writeFile(join(books, "libro-ficticio.epub"), "contenido anterior que debe sustituirse");

  const preload = join(dataRoot, "fail-committed-cleanup.cjs");
  const journalPath = join(dataRoot, ".folio-restore-journal.json");
  await writeFile(preload, `
    const fs = require("node:fs");
    const { syncBuiltinESMExports } = require("node:module");
    const originalRm = fs.promises.rm;
    const dataRoot = ${JSON.stringify(dataRoot)};
    const journalPath = ${JSON.stringify(journalPath)};
    let injected = false;
    fs.promises.rm = async function (path, ...args) {
      const value = String(path);
      if (!injected && value.startsWith(dataRoot + "/.folio-restore-")) {
        const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
        if (journal.phase === "committed" && value === dataRoot + "/" + journal.directory) {
          injected = true;
          await originalRm(value + "/previous", { recursive: true, force: true });
          const error = new Error("fallo parcial de limpieza inyectado por la prueba");
          error.code = "EIO";
          throw error;
        }
      }
      return originalRm.call(fs.promises, path, ...args);
    };
    syncBuiltinESMExports();
  `);
  const nodeOptions = `${process.env.NODE_OPTIONS ?? ""} --require=${preload}`.trim();
  await expect(runCliWithEnv({ NODE_OPTIONS: nodeOptions }, "restore", "--data-dir", dataRoot, "--file", archive, "--confirm", "RESTORE FOLIO DATA"))
    .rejects.toThrow(/quedó confirmada, pero falló la limpieza recuperable/);
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as { phase: string; directory: string };
  expect(journal.phase).toBe("committed");
  expect(await readFile(join(books, "libro-ficticio.epub"), "utf8")).toBe("contenido confirmado de la copia");
  await expect(access(join(dataRoot, journal.directory, "previous"))).rejects.toThrow();
  await expect(access(join(dataRoot, journal.directory))).resolves.toBeUndefined();
  await expect(launchServer(dataRoot)).rejects.toThrow(/restauración pendiente/);
  await expect(access(join(dataRoot, ".folio-instance.lock"))).rejects.toThrow();
  expect(await readFile(join(books, "libro-ficticio.epub"), "utf8")).toBe("contenido confirmado de la copia");

  const recovered = await runCli("recover", "--data-dir", dataRoot);
  expect(recovered.stdout).toContain("limpió una restauración confirmada");
  await expect(access(journalPath)).rejects.toThrow();
  await expect(access(join(dataRoot, journal.directory))).rejects.toThrow();
  expect(await readFile(join(books, "libro-ficticio.epub"), "utf8")).toBe("contenido confirmado de la copia");
  const alreadyRecovered = await runCli("recover", "--data-dir", dataRoot);
  expect(alreadyRecovered.stdout).toContain("No hay ninguna restauración pendiente");
  const api = await launchServer(dataRoot);
  await api.close();
});

test("dos starters no borran un lock stale; recover CLI explícito lo reclama y los PIDs inválidos fallan cerrados", async ({ dataRoot }) => {
  const lockPath = join(dataRoot, ".folio-instance.lock");
  const stale = JSON.stringify({ pid: 2147483647, role: "api", token: randomUUID(), startedAt: new Date().toISOString() });
  await writeFile(lockPath, stale);
  const starters = await Promise.allSettled([launchServer(dataRoot), launchServer(dataRoot)]);
  expect(starters.every((result) => result.status === "rejected")).toBe(true);
  expect(await readFile(lockPath, "utf8")).toBe(stale);
  await expect(runCli("backup", "--data-dir", dataRoot, "--file", join(dataRoot, "should-not-exist.zip"))).rejects.toThrow(/abandonado/);
  expect(await readFile(lockPath, "utf8")).toBe(stale);
  const recovered = await runCli("recover", "--data-dir", dataRoot);
  expect(recovered.stdout).toContain("No hay ninguna restauración pendiente");
  await expect(access(lockPath)).rejects.toThrow();

  const invalidPids = [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1];
  for (const pid of invalidPids) {
    const invalid = JSON.stringify({ pid, role: "api", token: randomUUID(), startedAt: new Date().toISOString() });
    await writeFile(lockPath, invalid);
    await expect(launchServer(dataRoot)).rejects.toThrow(/dañado|PID inválido/);
    expect(await readFile(lockPath, "utf8")).toBe(invalid);
    await rm(lockPath);
  }

  await writeFile(lockPath, stale);
  const simultaneousRecoveries = await Promise.allSettled([
    runCli("recover", "--data-dir", dataRoot),
    runCli("recover", "--data-dir", dataRoot),
  ]);
  expect(simultaneousRecoveries.some((result) => result.status === "fulfilled")).toBe(true);
  await expect(access(lockPath)).rejects.toThrow();
  await expect(access(join(dataRoot, ".folio-instance.guard"))).rejects.toThrow();
});

test("el backup rechaza IDs reservados y ledgers con claves prototype-unsafe", async ({ dataRoot }) => {
  await mkdir(join(dataRoot, "backups"), { recursive: true });
  const jobId = "__proto__";
  const jobDir = join(dataRoot, "jobs", jobId);
  await mkdir(jobDir, { recursive: true });
  await writeFile(join(jobDir, "input.epub"), "original ficticio");
  await writeFile(join(jobDir, "job.json"), JSON.stringify({
    id: jobId, kind: "epub-translation", status: "paused", inputFilePath: join(jobDir, "input.epub"), inputFileName: "libro.epub",
    outputFilePath: join(jobDir, "translated-libro.epub"), outputFileName: null, progress: { current: 0, total: 1, message: "paused" },
    checkpointBatchIndex: 0, createdAt: new Date().toISOString(), error: null,
  }));
  await expect(runCli("backup", "--data-dir", dataRoot, "--file", join(dataRoot, "backups", "reserved-job.zip"))).rejects.toThrow(/reservado/);

  await rm(join(dataRoot, "jobs"), { recursive: true, force: true });
  const usage = { requests: 1, inputTokenBound: 100, outputTokens: 100 };
  const unsafeLedger = JSON.parse(JSON.stringify({ version: 1, total: usage, samples: usage, jobs: {}, sampleOperations: {} }));
  Object.defineProperty(unsafeLedger.jobs, "__proto__", { value: usage, enumerable: true });
  await writeFile(join(dataRoot, "ai-budget.json"), JSON.stringify(unsafeLedger));
  await expect(runCli("backup", "--data-dir", dataRoot, "--file", join(dataRoot, "backups", "unsafe-ledger.zip"))).rejects.toThrow(/registro IA actual no tiene un formato válido/);
});

test("los EPUB generados por PDF conservan metadatos, versiones, original PDF, lecturas y opciones de dispositivo", async ({ page }) => {
  const pdf = await fictionalPdf(1);
  const origin = new URL(page.url()).origin;
  const conversion = await page.request.post(`${origin}/api/pdf/convert`, { multipart: {
    file: { name: "origen-ficticio.pdf", mimeType: "application/pdf", buffer: pdf },
  } });
  expect(conversion.status()).toBe(201);
  const { data: { jobId } } = await conversion.json();
  await expect.poll(async () => (await (await page.request.get(`${origin}/api/jobs/${jobId}`)).json()).data.status).toBe("done");
  const original = await page.request.get(`${origin}/api/jobs/${jobId}/original/download`);
  expect(original.ok()).toBe(true);
  expect(original.headers()["content-type"]).toContain("application/pdf");
  expect(Buffer.compare(Buffer.from(await original.body()), pdf)).toBe(0);
  const metadata = await page.request.get(`${origin}/api/jobs/${jobId}/metadata`);
  expect(metadata.ok()).toBe(true);
  expect((await metadata.json()).data.title).toContain("origen-ficticio");
  const changed = await page.request.patch(`${origin}/api/jobs/${jobId}/metadata`, { data: {
    title: "Resultado PDF convertido", authors: ["Autora de prueba"], language: "es", publisher: "", description: "",
  } });
  expect(changed.ok()).toBe(true);
  expect((await (await page.request.get(`${origin}/api/jobs/${jobId}/revisions`)).json()).data).toHaveLength(1);

  await page.goto(`${origin}/format`);
  await page.getByRole("button", { name: "Editar metadatos", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Metadatos", exact: true })).toBeVisible();
  await expect(page.getByText("origen-ficticio.pdf", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Descargar original" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Versiones anteriores" })).toBeVisible();
  await expect(page.getByText(/No hay destinos conectados/)).toBeVisible();
  await page.getByRole("button", { name: "Añadir a lecturas", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Lecturas", exact: true }).first()).toBeVisible();
  await expect(page.getByText("Resultado PDF convertido", { exact: true })).toBeVisible();
});

test("reservas de muestras, retries LLM y peticiones PDF agotan límites sin enviar llamadas extra, también tras reiniciar", async ({ page, dataRoot, server }) => {
  const provider = await startLocalProvider();
  await server.close();
  let api = await launchServer(dataRoot, {
    LLM_MOCK: "false", LLM_API_BASE_URL: provider.url, LLM_API_KEY: "sk-or-v1-local-fake-only", LLM_MODEL: "test/local-stub",
    PDF_CONVERSION_PROVIDER: "openrouter", PDF_PAGES_PER_BATCH: "1", AI_BUDGET_MAX_JOB_REQUESTS: "2", LLM_MAX_OUTPUT_TOKENS: "1000",
  });
  try {
    const pdf = await fictionalPdf(3);
    const pdfPreview = await page.request.post(`${api.origin}/api/previews/pdf-conversion`, { multipart: {
      file: { name: "vista-ficticia.pdf", mimeType: "application/pdf", buffer: pdf },
    } });
    expect(pdfPreview.ok()).toBe(true);
    expect((await pdfPreview.json()).data.pages).toHaveLength(3);
    const epubPreview = await page.request.post(`${api.origin}/api/previews/epub-translation`, { multipart: {
      file: { name: "vista-ficticia.epub", mimeType: "application/epub+zip", buffer: fictionalEpub() },
    } });
    expect(epubPreview.ok()).toBe(true);
    const requestWithOutputLimit = provider.requests.find((body) => body.max_tokens === 1000);
    expect(requestWithOutputLimit).toBeDefined();
    const previewBudget = await (await page.request.get(`${api.origin}/api/preflight`)).json();
    expect(previewBudget.data.aiBudget.usage.samples.requests).toBe(4);

    const upload = await page.request.post(`${api.origin}/api/translate`, { multipart: {
      file: { name: "retry-ficticio.epub", mimeType: "application/epub+zip", buffer: fictionalEpub() },
    } });
    const { data: { jobId } } = await upload.json();
    await expect.poll(async () => (await (await page.request.get(`${api.origin}/api/jobs/${jobId}`)).json()).data.status).toBe("error");
    const llmError = (await (await page.request.get(`${api.origin}/api/jobs/${jobId}`)).json()).data.error as string;
    expect(llmError).toContain("Límite de llamadas IA agotado");
    const pdfUpload = await page.request.post(`${api.origin}/api/pdf/convert`, { multipart: {
      file: { name: "presupuesto-ficticio.pdf", mimeType: "application/pdf", buffer: pdf },
    } });
    const { data: { jobId: pdfJobId } } = await pdfUpload.json();
    await expect.poll(async () => (await (await page.request.get(`${api.origin}/api/jobs/${pdfJobId}`)).json()).data.status).toBe("error");
    const pdfJob = (await (await page.request.get(`${api.origin}/api/jobs/${pdfJobId}`)).json()).data;
    expect(pdfJob.error).toContain("Límite de llamadas IA agotado");
    expect(pdfJob.progress.current).toBe(2);
    const callsBeforeRestart = provider.requests.length;
    expect(callsBeforeRestart).toBe(8);
    expect(provider.translationAttempts()).toBe(2); // glossary request plus one failed translation; the retry was rejected before HTTP.
    const epubCompletedAt = (await (await page.request.get(`${api.origin}/api/jobs/${jobId}`)).json()).data.completedAt;
    const pdfCompletedAt = (await (await page.request.get(`${api.origin}/api/jobs/${pdfJobId}`)).json()).data.completedAt;

    await api.close();
    api = await launchServer(dataRoot, {
      LLM_MOCK: "false", LLM_API_BASE_URL: provider.url, LLM_API_KEY: "sk-or-v1-local-fake-only", LLM_MODEL: "test/local-stub",
      PDF_CONVERSION_PROVIDER: "openrouter", PDF_PAGES_PER_BATCH: "1", AI_BUDGET_MAX_JOB_REQUESTS: "2", LLM_MAX_OUTPUT_TOKENS: "1000",
    });
    await page.request.post(`${api.origin}/api/jobs/${jobId}/resume`);
    await page.request.post(`${api.origin}/api/jobs/${pdfJobId}/resume`);
    await expect.poll(async () => (await (await page.request.get(`${api.origin}/api/jobs/${jobId}`)).json()).data.completedAt).not.toBe(epubCompletedAt);
    await expect.poll(async () => (await (await page.request.get(`${api.origin}/api/jobs/${pdfJobId}`)).json()).data.completedAt).not.toBe(pdfCompletedAt);
    await expect.poll(async () => (await (await page.request.get(`${api.origin}/api/jobs/${pdfJobId}`)).json()).data.status).toBe("error");
    expect(provider.requests.length).toBe(callsBeforeRestart);
    const afterRestartBudget = await (await page.request.get(`${api.origin}/api/preflight`)).json();
    expect(afterRestartBudget.data.aiBudget.usage.deployment.requests).toBe(8);
  } finally {
    await api.close();
    await provider.close();
  }
});

test("el límite global persiste y la restauración no rebaja reservas ni permite enviar peticiones extra", async ({ page, dataRoot, server }) => {
  const provider = await startLocalProvider();
  provider.setTranslationFailure(false);
  await server.close();
  let api = await launchServer(dataRoot, {
    LLM_MOCK: "false", LLM_API_BASE_URL: provider.url, LLM_API_KEY: "sk-or-v1-local-fake-only", LLM_MODEL: "test/local-stub",
    AI_BUDGET_MAX_REQUESTS: "2",
  });
  try {
    const first = await page.request.post(`${api.origin}/api/previews/epub-translation`, { multipart: {
      file: { name: "muestra-global.epub", mimeType: "application/epub+zip", buffer: fictionalEpub() },
    } });
    expect(first.ok()).toBe(true);
    expect(provider.requests.length).toBe(1);
    await api.close();
    const oldArchive = join(dataRoot, "backups", "global-before-increment.zip");
    await runCli("backup", "--data-dir", dataRoot, "--file", oldArchive);
    api = await launchServer(dataRoot, {
      LLM_MOCK: "false", LLM_API_BASE_URL: provider.url, LLM_API_KEY: "sk-or-v1-local-fake-only", LLM_MODEL: "test/local-stub",
      AI_BUDGET_MAX_REQUESTS: "2",
    });
    const second = await page.request.post(`${api.origin}/api/previews/epub-translation`, { multipart: {
      file: { name: "muestra-global-reinicio.epub", mimeType: "application/epub+zip", buffer: fictionalEpub() },
    } });
    expect(second.ok()).toBe(true);
    expect(provider.requests.length).toBe(2);
    await api.close();
    const restored = await runCli("restore", "--data-dir", dataRoot, "--file", oldArchive, "--confirm", "RESTORE FOLIO DATA");
    expect(restored.stdout).toContain("Copia previa recuperable:");
    api = await launchServer(dataRoot, {
      LLM_MOCK: "false", LLM_API_BASE_URL: provider.url, LLM_API_KEY: "sk-or-v1-local-fake-only", LLM_MODEL: "test/local-stub",
      AI_BUDGET_MAX_REQUESTS: "2",
    });
    const third = await page.request.post(`${api.origin}/api/previews/epub-translation`, { multipart: {
      file: { name: "muestra-global-tras-restore.epub", mimeType: "application/epub+zip", buffer: fictionalEpub() },
    } });
    expect(third.status()).toBe(429);
    expect((await third.json()).error).toContain("Límite de llamadas IA agotado");
    expect(provider.requests.length).toBe(2);
    const budget = await (await page.request.get(`${api.origin}/api/preflight`)).json();
    expect(budget.data.aiBudget.usage.deployment.requests).toBe(2);
  } finally {
    await api.close();
    await provider.close();
  }
});

test("diagnostica, pierde y reconecta un puente local simulado sin hardware", async ({ page, dataRoot, server }) => {
  let reachable = true;
  const bridge = createHttpServer((request, response) => {
    if (request.url !== "/devices") { response.writeHead(404).end(); return; }
    response.writeHead(reachable ? 200 : 503, { "Content-Type": "application/json" });
    response.end(reachable ? JSON.stringify({ ok: true, data: [] }) : JSON.stringify({ ok: false }));
  });
  bridge.listen(0, "127.0.0.1");
  await once(bridge, "listening");
  const address = bridge.address();
  if (!address || typeof address === "string") throw new Error("No se ha iniciado el stub de puente local");
  await server.close();
  const api = await launchServer(dataRoot, { DEVICE_BRIDGE_URL: `http://127.0.0.1:${address.port}`, DEVICE_BRIDGE_TOKEN: "test-only-local-bridge" });
  try {
    await page.goto(`${api.origin}/device`);
    await expect(page.getByText("Puente del equipo disponible.")).toBeVisible();
    reachable = false;
    await page.getByRole("button", { name: "Actualizar" }).click();
    await expect(page.getByText("El puente del equipo no responde; revisa que siga ejecutándose.")).toBeVisible();
    reachable = true;
    await page.getByRole("button", { name: "Actualizar" }).click();
    await expect(page.getByText("Puente del equipo disponible.")).toBeVisible();
  } finally {
    await api.close();
    await new Promise<void>((resolveClose, reject) => bridge.close((error) => error ? reject(error) : resolveClose()));
  }
});
