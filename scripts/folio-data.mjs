#!/usr/bin/env node
import AdmZip from "adm-zip";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync, backup } from "node:sqlite";
import { access, chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { acquireInstanceLock } from "../packages/data-safety/src/instanceLock.mjs";

const FORMAT = "folio-global-backup";
const VERSION = 1;
const MANIFEST_PATH = "folio-manifest.json";
const MAX_ENTRIES = 50_000;
const MAX_FILE_BYTES = 1024 * 1024 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 1000;
const STORE_KEYS = ["jobs", "books", "readingDatabase", "readingJson", "usage"];
const DATA_FILES = {
  readingDatabase: ["reading", "reading-log.sqlite"],
  readingJson: ["reading", "reading-log.json"],
  usage: ["usage", "ai-budget.json"],
};
const CONFIRMATION = "RESTORE FOLIO DATA";

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    if (!arg.startsWith("--")) throw new Error(`Argumento inesperado: ${arg}`);
    const key = arg.slice(2);
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Falta valor para --${key}`);
    options[key] = value;
    index++;
  }
  if (!["backup", "verify", "restore", "recover"].includes(command)) {
    throw new Error("Uso: folio-data.mjs <backup|verify|restore|recover> --data-dir RUTA [--file ARCHIVO.zip]");
  }
  return { command, options };
}

function within(parent, candidate) {
  const rel = relative(parent, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

async function ensureDataDir(input) {
  if (!input) throw new Error("Indica --data-dir con la ruta de datos de Folio");
  const path = resolve(input);
  await mkdir(path, { recursive: true, mode: 0o700 });
  const details = await lstat(path);
  if (!details.isDirectory() || details.isSymbolicLink()) throw new Error("El directorio de datos debe ser un directorio real, no un enlace simbólico");
  return path;
}


async function writeJsonAtomically(path, value) {
  const tempPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await rename(tempPath, path);
  } finally { await rm(tempPath, { force: true }).catch(() => undefined); }
}

async function exists(path) {
  try { await access(path); return true; }
  catch (error) { if (error?.code === "ENOENT") return false; throw error; }
}

function fileRecord(path, data) {
  return { path, size: data.byteLength, sha256: createHash("sha256").update(data).digest("hex") };
}

function safeArchiveSegment(segment) {
  return Boolean(segment) && segment !== "." && segment !== ".." && !/[\\/\0\u0000-\u001f\u007f:]/u.test(segment);
}

function assertSafeArchivePath(path) {
  if (typeof path !== "string" || !path || path.startsWith("/") || path.includes("\\") || path.includes("\0")) throw new Error(`Ruta ZIP no permitida: ${String(path)}`);
  const parts = path.split("/");
  if (parts.some((part) => !safeArchiveSegment(part))) throw new Error(`Ruta ZIP no permitida: ${path}`);
  if (!new Set(["jobs", "books", "reading", "usage"]).has(parts[0])) throw new Error(`Ruta fuera de las áreas de datos admitidas: ${path}`);
  if (parts[0] === "reading" && !["reading-log.sqlite", "reading-log.json"].includes(parts[1])) throw new Error(`Archivo de lectura no admitido: ${path}`);
  if (parts[0] === "usage" && (parts.length !== 2 || parts[1] !== "ai-budget.json")) throw new Error(`Archivo de uso no admitido: ${path}`);
  if ((parts[0] === "reading" || parts[0] === "usage") && parts.length !== 2) throw new Error(`Ruta ZIP no permitida: ${path}`);
  return parts;
}

async function walkRegularFiles(root, archiveRoot, onFile) {
  if (!await exists(root)) return;
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error(`${root} debe ser un directorio real, sin enlaces simbólicos`);
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (!safeArchiveSegment(entry.name)) throw new Error(`Nombre de archivo no válido en los datos: ${entry.name}`);
      const fullPath = join(directory, entry.name);
      const details = await lstat(fullPath);
      if (details.isSymbolicLink()) throw new Error(`No se permiten enlaces simbólicos en las áreas de datos: ${fullPath}`);
      if (details.isDirectory()) await visit(fullPath);
      else if (details.isFile()) {
        if (/\.(?:tmp|upload|restore|publish)$/i.test(entry.name) || entry.name === ".folio-instance.lock" || /^(?:\.env(?:\..*)?|settings\.json|credentials\.json|openrouter-key(?:\.json)?)$/i.test(entry.name)) continue;
        await onFile(fullPath, `${archiveRoot}/${relative(root, fullPath).split(sep).join("/")}`);
      } else throw new Error(`Tipo de archivo no admitido: ${fullPath}`);
    }
  }
  await visit(root);
}

async function snapshotReadingDatabase(sourcePath, destinationPath) {
  if (!await exists(sourcePath)) return false;
  const sourceInfo = await lstat(sourcePath);
  if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink()) throw new Error("La base de lecturas debe ser un archivo regular, sin enlaces simbólicos");
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  try { await backup(source, destinationPath); }
  finally { source.close(); }
  const snapshot = new DatabaseSync(destinationPath, { readOnly: true });
  try {
    const check = snapshot.prepare("PRAGMA quick_check").get();
    if (!check || Object.values(check)[0] !== "ok") throw new Error("La copia de SQLite no superó PRAGMA quick_check");
  } finally { snapshot.close(); }
  return true;
}

async function buildSnapshot(dataDir, workDir) {
  const zip = new AdmZip();
  const stores = { jobs: await exists(join(dataDir, "jobs")), books: await exists(join(dataDir, "books")), readingDatabase: false, readingJson: false, usage: false };
  const entries = [];
  const files = new Map();
  const addFile = async (fullPath, archivePath) => {
    assertSafeArchivePath(archivePath);
    const data = await readFile(fullPath);
    if (data.byteLength > MAX_FILE_BYTES) throw new Error(`El archivo supera el máximo de ${MAX_FILE_BYTES} bytes: ${archivePath}`);
    entries.push(fileRecord(archivePath, data));
    files.set(archivePath, data);
    zip.addFile(archivePath, data);
  };
  await walkRegularFiles(join(dataDir, "jobs"), "jobs", addFile);
  await walkRegularFiles(join(dataDir, "books"), "books", addFile);

  const sqliteSnapshot = join(workDir, "reading-log.sqlite");
  stores.readingDatabase = await snapshotReadingDatabase(join(dataDir, "reading-log.sqlite"), sqliteSnapshot);
  if (stores.readingDatabase) await addFile(sqliteSnapshot, "reading/reading-log.sqlite");
  for (const [key, [subdir, name]] of Object.entries(DATA_FILES)) {
    const sourcePath = join(dataDir, name);
    if (key === "readingDatabase") continue;
    if (await exists(sourcePath)) {
      const info = await lstat(sourcePath);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${name} debe ser un archivo regular, sin enlaces simbólicos`);
      stores[key] = true;
      await addFile(sourcePath, `${subdir}/${name}`);
    }
  }
  validateJobs(files, stores);
  if (stores.usage) readBudgetLedger(files.get("usage/ai-budget.json"), "El registro IA actual");
  if (entries.length > MAX_ENTRIES) throw new Error(`La copia supera el máximo de ${MAX_ENTRIES} archivos`);
  const totalSize = entries.reduce((sum, entry) => sum + entry.size, 0);
  if (totalSize > MAX_TOTAL_BYTES) throw new Error("La copia supera el tamaño total permitido");
  const manifest = { format: FORMAT, version: VERSION, createdAt: new Date().toISOString(), stores, entries };
  zip.addFile(MANIFEST_PATH, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"));
  return zip;
}

async function writeBackup(dataDir, outputPath) {
  const absoluteOutput = resolve(outputPath);
  const backupsRoot = join(dataDir, "backups");
  if (within(dataDir, absoluteOutput)) {
    if (!within(backupsRoot, absoluteOutput)) throw new Error("Dentro del directorio Folio, las copias solo se pueden escribir en backups/; usa una ruta separada para el archivo ZIP");
    await mkdir(backupsRoot, { recursive: true, mode: 0o700 });
    const info = await lstat(backupsRoot);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("El directorio backups/ debe ser un directorio real, sin enlaces simbólicos");
  }
  if (await exists(absoluteOutput)) throw new Error(`El archivo de destino ya existe; no se sobrescribe: ${absoluteOutput}`);
  await mkdir(dirname(absoluteOutput), { recursive: true, mode: 0o700 });
  const workDir = await mkdtemp(join(dataDir, ".folio-backup-"));
  const temporary = `${absoluteOutput}.${randomUUID()}.tmp`;
  try {
    const zip = await buildSnapshot(dataDir, workDir);
    zip.writeZip(temporary);
    const details = await stat(temporary);
    if (details.size > MAX_TOTAL_BYTES + 64 * 1024 * 1024) throw new Error("El archivo ZIP supera el tamaño máximo permitido");
    await chmod(temporary, 0o600);
    await link(temporary, absoluteOutput);
    await rm(temporary, { force: true });
    return { path: absoluteOutput, size: details.size };
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
    await rm(workDir, { recursive: true, force: true });
  }
}

function validateManifest(manifest) {
  if (!manifest || manifest.format !== FORMAT || manifest.version !== VERSION || !Number.isFinite(Date.parse(manifest.createdAt)) ||
    !manifest.stores || typeof manifest.stores !== "object" || Array.isArray(manifest.stores) ||
    !Array.isArray(manifest.entries) || manifest.entries.length > MAX_ENTRIES) throw new Error("Manifiesto Folio inválido o versión no compatible");
  for (const key of STORE_KEYS) if (typeof manifest.stores[key] !== "boolean") throw new Error(`Manifiesto incompleto: falta stores.${key}`);
  const paths = new Set();
  let total = 0;
  for (const entry of manifest.entries) {
    assertSafeArchivePath(entry?.path);
    if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > MAX_FILE_BYTES || !/^[a-f0-9]{64}$/.test(entry.sha256) || paths.has(entry.path)) {
      throw new Error(`Entrada de manifiesto inválida: ${entry?.path ?? "(sin ruta)"}`);
    }
    paths.add(entry.path);
    total += entry.size;
    if (total > MAX_TOTAL_BYTES) throw new Error("La copia supera el tamaño total permitido");
  }
  const expectedFiles = new Set();
  if (manifest.stores.readingDatabase) expectedFiles.add("reading/reading-log.sqlite");
  if (manifest.stores.readingJson) expectedFiles.add("reading/reading-log.json");
  if (manifest.stores.usage) expectedFiles.add("usage/ai-budget.json");
  for (const path of paths) {
    const parts = path.split("/");
    if (parts[0] === "jobs" && !manifest.stores.jobs || parts[0] === "books" && !manifest.stores.books ||
      parts[0] === "reading" && !expectedFiles.has(path) || parts[0] === "usage" && !expectedFiles.has(path)) throw new Error(`Entrada incompatible con las áreas declaradas: ${path}`);
  }
  for (const path of expectedFiles) if (!paths.has(path)) throw new Error(`Falta el archivo declarado en el manifiesto: ${path}`);
  if (!manifest.stores.jobs && [...paths].some((path) => path.startsWith("jobs/")) || !manifest.stores.books && [...paths].some((path) => path.startsWith("books/"))) throw new Error("Áreas declaradas de forma incoherente");
  return manifest;
}

function isSymlink(entry) {
  const mode = (entry.header.attr >>> 16) & 0xf000;
  return mode === 0xa000;
}

async function readAndValidateArchive(filePath) {
  const archivePath = resolve(filePath);
  const archiveInfo = await lstat(archivePath);
  if (!archiveInfo.isFile() || archiveInfo.isSymbolicLink() || archiveInfo.size > MAX_TOTAL_BYTES + 64 * 1024 * 1024) throw new Error("El archivo de copia no es regular o supera el tamaño permitido");
  const zip = new AdmZip(archivePath);
  const zipEntries = zip.getEntries();
  if (zipEntries.length < 1 || zipEntries.length > MAX_ENTRIES + 1) throw new Error("El ZIP tiene una cantidad de entradas no permitida");
  const seen = new Set();
  let expandedTotal = 0;
  let manifestEntry;
  for (const entry of zipEntries) {
    const name = entry.entryName;
    if (entry.isDirectory || isSymlink(entry) || !name || name.endsWith("/")) throw new Error(`No se permiten directorios ni enlaces en el ZIP: ${name}`);
    if (seen.has(name)) throw new Error(`Entrada ZIP duplicada: ${name}`);
    seen.add(name);
    if (name === MANIFEST_PATH) { manifestEntry = entry; continue; }
    assertSafeArchivePath(name);
    const size = entry.header.size;
    const compressed = entry.header.compressedSize;
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_FILE_BYTES || !Number.isSafeInteger(compressed) || compressed < 0 ||
      (size > 0 && (compressed === 0 || size / compressed > MAX_COMPRESSION_RATIO))) throw new Error(`Tamaño o compresión no permitidos: ${name}`);
    expandedTotal += size;
    if (expandedTotal > MAX_TOTAL_BYTES) throw new Error("El ZIP supera el tamaño total descomprimido permitido");
  }
  if (!manifestEntry || manifestEntry.header.size > 10 * 1024 * 1024) throw new Error("Falta el manifiesto versionado o supera el tamaño permitido");
  let manifest;
  try { manifest = validateManifest(JSON.parse(manifestEntry.getData().toString("utf8"))); }
  catch (error) { throw new Error(`No se puede validar el manifiesto: ${error.message}`); }
  const actualPaths = new Set(seen);
  actualPaths.delete(MANIFEST_PATH);
  const expectedPaths = new Set(manifest.entries.map((entry) => entry.path));
  if (actualPaths.size !== expectedPaths.size || [...actualPaths].some((path) => !expectedPaths.has(path))) throw new Error("El ZIP contiene entradas ausentes o no declaradas en el manifiesto");
  const byPath = new Map(zipEntries.map((entry) => [entry.entryName, entry]));
  const files = new Map();
  for (const record of manifest.entries) {
    const entry = byPath.get(record.path);
    if (!entry || entry.header.size !== record.size) throw new Error(`El tamaño no coincide con el manifiesto: ${record.path}`);
    const data = entry.getData();
    const hash = createHash("sha256").update(data).digest("hex");
    if (hash !== record.sha256) throw new Error(`La suma de comprobación no coincide: ${record.path}`);
    files.set(record.path, data);
  }
  validateJobs(files, manifest.stores);
  if (manifest.stores.usage) readBudgetLedger(files.get("usage/ai-budget.json"), "El registro IA del ZIP");
  return { archivePath, manifest, files };
}

function validUsage(value) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    ["requests", "inputTokenBound", "outputTokens"].every((key) => Number.isSafeInteger(value[key]) && value[key] >= 0);
}

function readBudgetLedger(buffer, label) {
  let value;
  try { value = JSON.parse(buffer.toString("utf8")); }
  catch { throw new Error(`${label} está dañado; se rechaza para no reducir límites IA`); }
  const safeKey = (key) => /^[a-zA-Z0-9_-]{1,240}$/.test(key) && !["__proto__", "prototype", "constructor"].includes(key);
  if (!value || value.version !== 1 || !validUsage(value.total) || !validUsage(value.samples) ||
    !value.jobs || typeof value.jobs !== "object" || Array.isArray(value.jobs) || !Object.entries(value.jobs).every(([key, usage]) => safeKey(key) && validUsage(usage)) ||
    !value.sampleOperations || typeof value.sampleOperations !== "object" || Array.isArray(value.sampleOperations) || !Object.entries(value.sampleOperations).every(([key, usage]) => safeKey(key) && validUsage(usage))) {
    throw new Error(`${label} no tiene un formato válido; se rechaza para no reducir límites IA`);
  }
  return value;
}

function mergeBudgetLedgers(left, right) {
  const maxUsage = (a, b) => ({
    requests: Math.max(a?.requests ?? 0, b?.requests ?? 0),
    inputTokenBound: Math.max(a?.inputTokenBound ?? 0, b?.inputTokenBound ?? 0),
    outputTokens: Math.max(a?.outputTokens ?? 0, b?.outputTokens ?? 0),
  });
  const mergeMap = (a, b) => Object.fromEntries([...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].map((key) => [key, maxUsage(a?.[key], b?.[key])]));
  return { version: 1, total: maxUsage(left?.total, right?.total), samples: maxUsage(left?.samples, right?.samples), jobs: mergeMap(left?.jobs, right?.jobs), sampleOperations: mergeMap(left?.sampleOperations, right?.sampleOperations) };
}

function validateJobs(files, stores) {
  if (!stores.jobs) return;
  const jobRecords = [...files.keys()].filter((path) => /^jobs\/[^/]+\/job\.json$/.test(path));
  const jobDirs = new Set([...files.keys()].filter((path) => path.startsWith("jobs/")).map((path) => path.split("/")[1]));
  if (jobDirs.size !== jobRecords.length) throw new Error("Cada carpeta de trabajo debe contener un registro job.json");
  for (const path of jobRecords) {
    const [, id] = path.split("/");
    if (!/^[a-zA-Z0-9_-]{1,240}$/.test(id) || ["__proto__", "prototype", "constructor"].includes(id)) throw new Error(`Identificador de trabajo inválido o reservado: ${id}`);
    let record;
    try { record = JSON.parse(files.get(path).toString("utf8")); }
    catch { throw new Error(`Registro job.json dañado: ${id}`); }
    const kind = record.kind ?? "epub-translation";
    const inputName = kind === "pdf-conversion" ? "input.pdf" : "input.epub";
    if (record.id !== id || !["epub-translation", "pdf-conversion"].includes(kind) ||
      !["pending", "processing", "pausing", "paused", "done", "error"].includes(record.status) ||
      typeof record.inputFilePath !== "string" || typeof record.inputFileName !== "string" || !record.inputFileName || record.inputFileName.length > 500 || /[\\/\0\u0000-\u001f\u007f]/u.test(record.inputFileName) ||
      typeof record.outputFilePath !== "string" || !record.outputFilePath.toLowerCase().endsWith(".epub") ||
      record.outputFileName !== null && (typeof record.outputFileName !== "string" || basename(record.outputFilePath) !== record.outputFileName || /[\\/\0]/.test(record.outputFileName)) ||
      record.status === "done" && !record.outputFileName ||
      !record.progress || !Number.isSafeInteger(record.progress.current) || record.progress.current < 0 || !Number.isSafeInteger(record.progress.total) || record.progress.total < 0 || typeof record.progress.message !== "string" ||
      !Number.isSafeInteger(record.checkpointBatchIndex) || record.checkpointBatchIndex < 0 || typeof record.createdAt !== "string" || !Number.isFinite(Date.parse(record.createdAt)) ||
      record.error !== null && typeof record.error !== "string" ||
      record.glossary !== undefined && (!Array.isArray(record.glossary) || record.glossary.length > 100 || !record.glossary.every((entry) => entry && typeof entry.source === "string" && entry.source.length <= 300 && typeof entry.target === "string" && entry.target.length <= 300)) ||
      record.completedChapters !== undefined && (!Array.isArray(record.completedChapters) || !record.completedChapters.every((entry) => typeof entry === "string")) ||
      record.translationMemory !== undefined && (!record.translationMemory || typeof record.translationMemory !== "object" || Array.isArray(record.translationMemory) || !Object.values(record.translationMemory).every((entry) => typeof entry === "string"))) {
      throw new Error(`Registro de trabajo inválido: ${id}`);
    }
    const original = `jobs/${id}/${inputName}`;
    if (!files.has(original)) throw new Error(`Falta el original del trabajo ${id}`);
    if (record.status === "done" && record.outputFileName && !files.has(`books/${record.outputFileName}`) && !files.has(`jobs/${id}/${record.outputFileName}`)) {
      throw new Error(`Falta el resultado del trabajo ${id}`);
    }
  }
}

async function verifySqlitePayload(files, workDir) {
  const data = files.get("reading/reading-log.sqlite");
  if (!data) return;
  const path = join(workDir, "reading-verify.sqlite");
  await writeFile(path, data, { mode: 0o600, flag: "wx" });
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const result = database.prepare("PRAGMA quick_check").get();
    if (!result || Object.values(result)[0] !== "ok") throw new Error("La base SQLite incluida no superó PRAGMA quick_check");
  } finally { database.close(); await rm(path, { force: true }); }
}

async function verifyArchive(filePath) {
  const validated = await readAndValidateArchive(filePath);
  const workDir = await mkdtemp(join(tmpdir(), "folio-verify-"));
  try { await verifySqlitePayload(validated.files, workDir); }
  finally { await rm(workDir, { recursive: true, force: true }); }
  return validated;
}

const TARGETS = [
  { key: "jobs", target: (root) => join(root, "jobs"), staged: (root) => join(root, "jobs"), directory: true, expected: (manifest) => manifest.stores.jobs },
  { key: "books", target: (root) => join(root, "books"), staged: (root) => join(root, "books"), directory: true, expected: (manifest) => manifest.stores.books },
  { key: "readingDatabase", target: (root) => join(root, "reading-log.sqlite"), staged: (root) => join(root, "reading-log.sqlite"), directory: false, expected: (manifest) => manifest.stores.readingDatabase },
  { key: "readingJson", target: (root) => join(root, "reading-log.json"), staged: (root) => join(root, "reading-log.json"), directory: false, expected: (manifest) => manifest.stores.readingJson },
  { key: "usage", target: (root) => join(root, "ai-budget.json"), staged: (root) => join(root, "ai-budget.json"), directory: false, expected: (manifest) => manifest.stores.usage },
];

async function checkCurrentTargets(dataDir) {
  for (const target of TARGETS) {
    const path = target.target(dataDir);
    if (!await exists(path)) continue;
    const info = await lstat(path);
    if (info.isSymbolicLink() || target.directory && !info.isDirectory() || !target.directory && !info.isFile()) {
      throw new Error(`La ruta actual no es del tipo esperado o es un enlace: ${path}`);
    }
  }
}

async function preserveMonotonicBudget(dataDir, stageRoot, manifest) {
  const currentPath = join(dataDir, "ai-budget.json");
  const stagedPath = join(stageRoot, "ai-budget.json");
  const currentExists = await exists(currentPath);
  const restoredExists = manifest.stores.usage;
  if (!currentExists && !restoredExists) return;
  const current = currentExists ? readBudgetLedger(await readFile(currentPath), "El registro IA actual") : null;
  const restored = restoredExists ? readBudgetLedger(await readFile(stagedPath), "El registro IA restaurado") : null;
  const merged = mergeBudgetLedgers(current, restored);
  await writeJsonAtomically(stagedPath, merged);
  manifest.stores.usage = true;
}

async function stageArchive(dataDir, transactionDir, validated) {
  const stageRoot = join(transactionDir, "stage");
  await mkdir(stageRoot, { mode: 0o700 });
  if (validated.manifest.stores.jobs) await mkdir(join(stageRoot, "jobs"), { mode: 0o700 });
  if (validated.manifest.stores.books) await mkdir(join(stageRoot, "books"), { mode: 0o700 });
  for (const record of validated.manifest.entries) {
    const parts = assertSafeArchivePath(record.path);
    let stagePath;
    if (parts[0] === "jobs" || parts[0] === "books") stagePath = join(stageRoot, parts[0], ...parts.slice(1));
    else if (parts[0] === "reading") stagePath = join(stageRoot, parts[1]);
    else stagePath = join(stageRoot, "ai-budget.json");
    if (!within(stageRoot, stagePath)) throw new Error(`Ruta de staging fuera de alcance: ${record.path}`);
    await mkdir(dirname(stagePath), { recursive: true, mode: 0o700 });
    const data = validated.files.get(record.path);
    await writeFile(stagePath, data, { flag: "wx", mode: 0o600 });
  }
  if (validated.manifest.stores.readingDatabase) await verifySqlitePayload(validated.files, transactionDir);
  for (const target of TARGETS) {
    if (!target.expected(validated.manifest)) continue;
    const stagePath = target.staged(stageRoot);
    const info = await lstat(stagePath).catch((error) => { if (error?.code === "ENOENT") return null; throw error; });
    if (!info || target.directory && !info.isDirectory() || !target.directory && !info.isFile()) throw new Error(`Falta el área de datos de staging: ${target.key}`);
  }
  return stageRoot;
}

async function rollbackTransaction(dataDir, journalPath, journal) {
  const transactionDir = join(dataDir, journal.directory);
  const previousRoot = join(transactionDir, "previous");
  for (const target of [...TARGETS].reverse()) {
    if (!journal.hadOriginal[target.key]) continue;
    const previous = join(previousRoot, target.key);
    if (!await exists(previous)) continue;
    const live = target.target(dataDir);
    await rm(live, { recursive: target.directory, force: true });
    await rename(previous, live);
  }
  for (const target of TARGETS) {
    if (journal.hadOriginal[target.key]) continue;
    const stagePath = target.staged(join(transactionDir, "stage"));
    const live = target.target(dataDir);
    if (!await exists(stagePath) && await exists(live)) await rm(live, { recursive: target.directory, force: true });
  }
  await rm(transactionDir, { recursive: true, force: true });
  await rm(journalPath, { force: true });
}

async function cleanupCommittedRestore(dataDir, journalPath, journal) {
  // Keep the committed journal until its transaction directory is gone. Both removals are idempotent.
  await rm(join(dataDir, journal.directory), { recursive: true, force: true });
  await rm(journalPath, { force: true });
}

async function recoverIfNeeded(dataDir) {
  const journalPath = join(dataDir, ".folio-restore-journal.json");
  if (!await exists(journalPath)) return false;
  let journal;
  try { journal = JSON.parse(await readFile(journalPath, "utf8")); }
  catch { throw new Error("El diario de restauración está dañado; conserva los datos y solicita revisión manual"); }
  if (journal.version !== 1 || typeof journal.directory !== "string" || !/^\.folio-restore-[a-f0-9-]+$/.test(journal.directory) ||
    !journal.hadOriginal || STORE_KEYS.some((key) => typeof journal.hadOriginal[key] !== "boolean") || !["applying", "committed"].includes(journal.phase)) {
    throw new Error("El diario de restauración no es válido; no se modifica ningún dato");
  }
  const transactionPath = join(dataDir, journal.directory);
  if (await exists(transactionPath)) {
    const transactionInfo = await lstat(transactionPath);
    if (!transactionInfo.isDirectory() || transactionInfo.isSymbolicLink()) throw new Error("El directorio de transacción no es un directorio real; no se modifica ningún dato");
  }
  if (journal.phase === "committed") await cleanupCommittedRestore(dataDir, journalPath, journal);
  else await rollbackTransaction(dataDir, journalPath, journal);
  return true;
}

async function applyRestore(dataDir, transactionDir, stageRoot, manifest) {
  const journalPath = join(dataDir, ".folio-restore-journal.json");
  const hadOriginal = {};
  for (const target of TARGETS) hadOriginal[target.key] = await exists(target.target(dataDir));
  const journal = { version: 1, directory: basename(transactionDir), phase: "applying", hadOriginal, applied: [] };
  await writeJsonAtomically(journalPath, journal);
  try {
    const previousRoot = join(transactionDir, "previous");
    await mkdir(previousRoot, { mode: 0o700 });
    for (const target of TARGETS) {
      const live = target.target(dataDir);
      const previous = join(previousRoot, target.key);
      if (hadOriginal[target.key]) await rename(live, previous);
      if (target.expected(manifest)) await rename(target.staged(stageRoot), live);
      journal.applied.push(target.key);
      await writeJsonAtomically(journalPath, journal);
    }
    journal.phase = "committed";
    await writeJsonAtomically(journalPath, journal);
  } catch (error) {
    // A commit write can have an ambiguous result if the filesystem reports an error after rename.
    // Never roll back if the durable journal already says committed.
    let durablePhase;
    try { durablePhase = JSON.parse(await readFile(journalPath, "utf8")).phase; }
    catch { /* An unreadable commit record is ambiguous: preserve the tree for explicit recovery. */ }
    if (durablePhase !== "applying") {
      throw new Error(`La restauración no se revirtió porque el estado del commit no es verificable (${String(durablePhase ?? "desconocido")}). Conserva los datos y ejecuta folio-data.mjs recover --data-dir "${dataDir}"`);
    }
    try { await rollbackTransaction(dataDir, journalPath, journal); }
    catch (rollbackError) {
      throw new Error(`La restauración falló (${error.message}) y el rollback necesita recuperación: ${rollbackError.message}. Ejecuta folio-data.mjs recover --data-dir "${dataDir}"`);
    }
    throw new Error(`La restauración se revirtió sin sustituir los datos actuales: ${error.message}`);
  }

  try { await cleanupCommittedRestore(dataDir, journalPath, journal); }
  catch (error) {
    // Commit is final: cleanup is recoverable and must never invoke rollback.
    throw new Error(`La restauración quedó confirmada, pero falló la limpieza recuperable (${error.message}). Los datos confirmados se conservan; ejecuta folio-data.mjs recover --data-dir "${dataDir}"`);
  }
}

async function restoreArchive(dataDir, filePath, confirmation) {
  if (confirmation !== CONFIRMATION) throw new Error(`Restaurar reemplaza jobs, books y lecturas. Repite con --confirm "${CONFIRMATION}"`);
  const validated = await verifyArchive(filePath);
  await checkCurrentTargets(dataDir);
  const backupPath = join(dataDir, "backups", `folio-before-restore-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`);
  await mkdir(dirname(backupPath), { recursive: true, mode: 0o700 });
  const current = await writeBackup(dataDir, backupPath);
  const transactionDir = join(dataDir, `.folio-restore-${randomUUID()}`);
  await mkdir(transactionDir, { mode: 0o700 });
  try {
    const stageRoot = await stageArchive(dataDir, transactionDir, validated);
    await preserveMonotonicBudget(dataDir, stageRoot, validated.manifest);
    for (const record of validated.manifest.entries) {
      if (!record.path.startsWith("jobs/") || !record.path.endsWith("/job.json")) continue;
      const parts = record.path.split("/");
      const jobId = parts[1];
      const path = join(stageRoot, "jobs", jobId, "job.json");
      const job = JSON.parse(await readFile(path, "utf8"));
      const kind = job.kind ?? "epub-translation";
      const inputName = kind === "pdf-conversion" ? "input.pdf" : "input.epub";
      job.kind = kind;
      job.inputFilePath = join(dataDir, "jobs", jobId, inputName);
      const outputName = basename(job.outputFilePath);
      job.outputFilePath = validated.files.has(`books/${outputName}`)
        ? join(dataDir, "books", outputName)
        : join(dataDir, "jobs", jobId, outputName);
      job.lastProgressAt ??= job.progress?.updatedAt ?? job.createdAt;
      if (["pending", "processing", "pausing"].includes(job.status)) {
        job.status = "paused";
        job.startedAt = null;
        job.progress = { ...job.progress, message: "Pausada tras restaurar la copia" };
      }
      await writeJsonAtomically(path, job);
    }
    await applyRestore(dataDir, transactionDir, stageRoot, validated.manifest);
    return { backupPath: current.path, archivePath: resolve(filePath) };
  } catch (error) {
    if (await exists(transactionDir) && !await exists(join(dataDir, ".folio-restore-journal.json"))) await rm(transactionDir, { recursive: true, force: true });
    throw error;
  }
}

function assertCanonicalLocations(dataDir) {
  const configuredRoot = process.env.FOLIO_DATA_DIR;
  if (configuredRoot && resolve(configuredRoot) !== dataDir) throw new Error("--data-dir no coincide con FOLIO_DATA_DIR del entorno");
  const expected = {
    JOBS_TMP_ROOT: join(dataDir, "jobs"),
    OUTPUT_DIR: join(dataDir, "books"),
    READING_DB_PATH: join(dataDir, "reading-log.sqlite"),
    READING_LOG_PATH: join(dataDir, "reading-log.json"),
  };
  for (const [name, defaultPath] of Object.entries(expected)) {
    if (process.env[name] && resolve(process.env[name]) !== defaultPath) throw new Error(`${name} apunta fuera del formato global soportado; se rechaza una copia incompleta`);
  }
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (command === "verify") {
    if (!options.file) throw new Error("Indica --file con el archivo ZIP");
    const { manifest } = await verifyArchive(options.file);
    console.log(`Copia válida: formato ${manifest.format} v${manifest.version}; ${manifest.entries.length} archivos; ${manifest.createdAt}.`);
    console.log("La validación no ha escrito en el directorio de datos.");
    return;
  }
  const dataDir = await ensureDataDir(options["data-dir"]);
  assertCanonicalLocations(dataDir);
  const release = await acquireInstanceLock(dataDir, `folio-data:${command}`, command === "recover");
  try {
    if (command !== "recover" && await exists(join(dataDir, ".folio-restore-journal.json"))) {
      throw new Error(`Hay una restauración pendiente; no se modifica ningún dato. Ejecuta primero folio-data.mjs recover --data-dir "${dataDir}".`);
    }
    if (command === "backup") {
      const output = options.file ? resolve(options.file) : join(dataDir, "backups", `folio-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`);
      const result = await writeBackup(dataDir, output);
      console.log(`Copia creada: ${result.path} (${result.size} bytes).`);
      console.log("settings.json, archivos .env y claves de proveedores no se incluyen.");
    } else if (command === "restore") {
      if (!options.file) throw new Error("Indica --file con el archivo ZIP");
      const result = await restoreArchive(dataDir, options.file, options.confirm);
      console.log(`Restauración completada desde ${result.archivePath}.`);
      console.log(`Copia previa recuperable: ${result.backupPath}`);
      console.log("Los trabajos activos/en cola se han dejado pausados; no se han iniciado procesos remotos.");
    } else if (command === "recover") {
      const recovered = await recoverIfNeeded(dataDir);
      console.log(recovered ? "Se recuperó el estado de una restauración interrumpida o se limpió una restauración confirmada." : "No hay ninguna restauración pendiente de recuperar.");
    }
  } finally { await release(); }
}

main().catch((error) => {
  console.error(`Folio data: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
