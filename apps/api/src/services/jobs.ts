import { ResourceLocks, fileOperations } from "./shared/files";
import { createWriteStream } from "node:fs";
import { access, copyFile, mkdir, readdir, rename, rm, stat, link } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import type { MultipartFile } from "@fastify/multipart";
import { processEpub } from "./epub";
import { processPdfToEpub } from "./pdf";
import type { GlossaryEntry, Job, JobKind, JobProgress, PublicJob } from "../types";
import { buildJobPaths } from "./jobs/paths";
import { JobPersistence, readJobsFromDisk } from "./jobs/persistence";
import { getJobDir, getJobsTmpRoot } from "./jobs/paths";
import { createJobQueue } from "./jobs/queue";
import { createJobRunner } from "./jobs/runner";
import { stopJobTimer, markPaused, markPausing, markFailed, markDone, prepareResume } from "./jobs/state";
export { buildJobPaths } from "./jobs/paths";
export type { PersistedJobRecord } from "./jobs/persistence";

const jobOperations = new ResourceLocks();
export function withJobOperation<T>(id: string, operation: () => Promise<T>): Promise<T> {
  return jobOperations.run(id, operation);
}

const jobs = new Map<string, Job>();
const persistence = new JobPersistence();
const persistJob = (job: Job) => persistence.persist(job);
const reportPersistenceError = (error: unknown) => console.error("Error al guardar o ejecutar un trabajo", error);
const schedulePersist = (job: Job) => { void persistJob(job).catch(reportPersistenceError); };
const queue = createJobQueue({ jobs, persistJob, schedulePersist,
  processJob: (id) => runJob(id), onError: reportPersistenceError });
const runJob = createJobRunner({ processEpub, processPdfToEpub, getJob,
  isActive: queue.isActive, enterRun: queue.enterRun, leaveRun: queue.leaveRun,
  persistJob, schedulePersist,
  readTranslatedItems: (job) => persistence.readCheckpoint(job),
  persistTranslatedItems: (job, items) => persistence.checkpoint(job, items),
  updateJobStatus, updateJobProgress, setJobOutput, setJobError, setJobPaused,
  insertPausedJobIntoQueue: queue.insertPausedJobIntoQueue });
export const reorderQueuedJob = queue.reorderQueuedJob;
export const startQueuedJob = queue.startQueuedJob;
export const startJobProcessing = queue.startJobProcessing;

export async function loadJobsFromDisk(rootDir = getJobsTmpRoot()) {
  const loaded = await readJobsFromDisk(rootDir);
  for (const job of loaded.jobs) jobs.set(job.id, job);
  for (const error of loaded.errors) console.warn(`Trabajo ${error.directory} conservado sin cargar: ${error.message}`);
  return loaded;
}

export function createJob(
  inputFileName: string,
  kind: JobKind = "epub-translation",
): Job {
  const id = randomUUID();
  const paths = buildJobPaths(id, inputFileName, kind);
  const job: Job = {
    id,
    kind,
    status: "pending",
    progress: { current: 0, total: 0, message: "Pendiente" },
    checkpointBatchIndex: 0,
    inputFileName,
    inputFilePath: paths.inputFilePath,
    outputFilePath: paths.outputFilePath,
    outputFileName: null,
    error: null,
    glossary: [],
    completedChapters: [],
    translationMemory: {},
    queueOrder: null,
    elapsedMs: 0,
    lastProgressAt: new Date(),
    archived: false,
    createdAt: new Date(),
    startedAt: null,
    completedAt: null,
  };
  jobs.set(job.id, job);
  schedulePersist(job);
  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function listJobs(): Job[] {
  function priority(job: Job): number {
    if (job.kind === "epub-translation" && job.status === "processing") return 0;
    if (job.kind === "epub-translation" && job.status === "pausing") return 1;
    if (job.kind === "epub-translation" && (job.status === "paused" || job.status === "pending")) return 2;
    if (job.status === "processing") return 3;
    if (job.status === "pausing") return 4;
    if (job.status === "paused" || job.status === "pending") return 5;
    return 6;
  }

  return Array.from(jobs.values()).sort((left, right) => {
    const priorityDifference = priority(left) - priority(right);
    if (priorityDifference) return priorityDifference;
    const leftIsQueued = left.status === "pending" || left.status === "paused";
    const rightIsQueued = right.status === "pending" || right.status === "paused";
    if (leftIsQueued && rightIsQueued && left.kind === right.kind) {
      return (left.queueOrder ?? Number.MAX_SAFE_INTEGER) - (right.queueOrder ?? Number.MAX_SAFE_INTEGER);
    }
    return right.createdAt.getTime() - left.createdAt.getTime();
  });
}

export function deleteJob(id: string): Promise<"deleted" | "processing" | "missing"> {
  return withJobOperation(id, async () => {
    const job = jobs.get(id);
    return job ? fileOperations.run(job.outputFilePath, () => deleteJobUnlocked(id)) : "missing";
  });
}

async function deleteJobUnlocked(id: string): Promise<"deleted" | "processing" | "missing"> {
  const job = jobs.get(id);
  if (!job) return "missing";
  if (queue.isActive(id) || job.status === "processing") return "processing";

  // Remove from visibility before yielding so no new operation can schedule writes.
  jobs.delete(id);
  queue.remove(job);
  await persistence.delete(job);
  if (resolve(job.outputFilePath) !== resolve(getJobDir(job), basename(job.outputFilePath))) {
    await rm(job.outputFilePath, { force: true });
  }
  return "deleted";
}

export async function archiveCompletedJobs(): Promise<number> {
  const completed = Array.from(jobs.values()).filter((job) => job.status === "done" && !job.archived);
  await Promise.all(completed.map((job) => setJobArchived(job.id, true)));
  return completed.length;
}

export function setJobArchived(id: string, archived: boolean): Promise<Job | "missing" | "not-ready"> {
  return withJobOperation(id, async () => {
    const job = jobs.get(id);
    if (!job) return "missing";
    if (job.status !== "done") return "not-ready";
    const previous = job.archived;
    job.archived = archived;
    try { await persistJob(job); }
    catch (error) { job.archived = previous; throw error; }
    return job;
  });
}

export async function deleteCompletedJobs(): Promise<number> {
  const completedJobIds = Array.from(jobs.values())
    .filter((job) => job.status === "done")
    .map((job) => job.id);

  await Promise.all(completedJobIds.map((jobId) => deleteJob(jobId)));
  return completedJobIds.length;
}

export function renameJobOutput(id: string, requestedFileName: string): Promise<Job | "missing" | "not-ready" | "exists" | "invalid"> {
  return withJobOperation(id, async () => {
    const job = jobs.get(id);
    return job ? fileOperations.run(job.outputFilePath, () => renameJobOutputUnlocked(id, requestedFileName)) : "missing";
  });
}

async function renameJobOutputUnlocked(
  id: string,
  requestedFileName: string,
): Promise<Job | "missing" | "not-ready" | "exists" | "invalid"> {
  const job = jobs.get(id);
  if (!job) return "missing";
  if (job.status !== "done" || !job.outputFileName) return "not-ready";

  const baseName = basename(requestedFileName.trim()).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-");
  if (!baseName || baseName === "." || baseName === ".." || Buffer.byteLength(baseName) > 200) return "invalid";
  const outputFileName = baseName.toLowerCase().endsWith(".epub") ? baseName : `${baseName}.epub`;
  if (outputFileName === job.outputFileName) return job;
  const outputFilePath = resolve(dirname(job.outputFilePath), outputFileName);
  try {
    await access(outputFilePath);
    return "exists";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  try { await link(job.outputFilePath, outputFilePath); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return "exists"; throw error; }
  const previousPath = job.outputFilePath;
  const previousName = job.outputFileName;
  job.outputFileName = outputFileName;
  job.outputFilePath = outputFilePath;
  try { await persistJob(job); }
  catch (error) {
    job.outputFileName = previousName;
    job.outputFilePath = previousPath;
    await rm(outputFilePath, { force: true });
    throw error;
  }
  await rm(previousPath);
  return job;
}

export type JobRevision = { id: string; createdAt: string; fileName: string };

const revisionIdPattern = /^\d{13}-[0-9a-f-]{36}$/;

export function getJobRevisionPath(job: Job, revisionId: string): string | null {
  if (!revisionIdPattern.test(revisionId)) return null;
  return resolve(getJobDir(job), "revisions", `${revisionId}.epub`);
}

export async function createJobRevision(job: Job): Promise<JobRevision> {
  if (job.status !== "done" || !job.outputFileName) throw new Error("El EPUB no está disponible para crear una versión");
  const id = `${Date.now()}-${randomUUID()}`;
  const revisionPath = resolve(getJobDir(job), "revisions", `${id}.epub`);
  await mkdir(dirname(revisionPath), { recursive: true });
  await copyFile(job.outputFilePath, revisionPath);
  const details = await stat(revisionPath);
  return { id, createdAt: details.mtime.toISOString(), fileName: job.outputFileName };
}

export async function listJobRevisions(job: Job): Promise<JobRevision[]> {
  const directory = resolve(getJobDir(job), "revisions");
  let names: string[];
  try { names = await readdir(directory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const revisions = await Promise.all(names.flatMap((name) => {
    const id = name.endsWith(".epub") ? name.slice(0, -5) : "";
    const path = id ? getJobRevisionPath(job, id) : null;
    return path ? [stat(path).then((details) => ({ id, createdAt: details.mtime.toISOString(), fileName: job.outputFileName ?? name })).catch(() => null)] : [];
  }));
  return revisions.filter((revision): revision is JobRevision => revision !== null)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function restoreJobRevision(job: Job, revisionId: string): Promise<boolean> {
  if (job.status !== "done" || !job.outputFileName) return false;
  const revisionPath = getJobRevisionPath(job, revisionId);
  if (!revisionPath) return false;
  try { await access(revisionPath); }
  catch { return false; }
  await createJobRevision(job);
  const temporaryPath = `${job.outputFilePath}.${randomUUID()}.restore`;
  try {
    await copyFile(revisionPath, temporaryPath);
    await rename(temporaryPath, job.outputFilePath);
  } finally { await rm(temporaryPath, { force: true }).catch(() => undefined); }
  return true;
}

export async function setJobGlossary(id: string, entries: GlossaryEntry[]): Promise<Job | "missing" | "not-editable" | "invalid"> {
  const job = jobs.get(id);
  if (!job) return "missing";
  if (job.kind !== "epub-translation" || !["pending", "paused", "error"].includes(job.status)) return "not-editable";
  if (!Array.isArray(entries) || entries.length > 100) return "invalid";
  const seen = new Set<string>();
  const normalized: GlossaryEntry[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry.source !== "string" || typeof entry.target !== "string" ||
        entry.source.trim().length === 0 || entry.source.trim().length > 300 ||
        entry.target.trim().length === 0 || entry.target.trim().length > 300 ||
        entry.type !== undefined && !["name", "place", "term", "title"].includes(entry.type)) return "invalid";
    const source = entry.source.trim();
    const key = source.toLocaleLowerCase();
    if (seen.has(key)) return "invalid";
    seen.add(key);
    normalized.push({ source, target: entry.target.trim(), ...(entry.type ? { type: entry.type } : {}) });
  }
  const previous = job.glossary;
  job.glossary = normalized;
  try { await persistJob(job); }
  catch (error) { job.glossary = previous; throw error; }
  return job;
}

export function serializeJob(job: Job): PublicJob {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    progress: job.progress,
    inputFileName: job.inputFileName,
    outputFileName: job.outputFileName,
    error: job.error,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    elapsedMs: job.elapsedMs,
    lastProgressAt: job.lastProgressAt?.toISOString() ?? null,
    archived: job.archived,
    downloadUrl: job.status === "done" ? `/api/jobs/${job.id}/download` : undefined,
  };
}

export function updateJobStatus(id: string, status: Job["status"]): void {
  const job = jobs.get(id);
  if (job) {
    job.status = status;
    job.lastProgressAt = new Date();
    if (status === "processing" && !job.startedAt) {
      job.startedAt = new Date();
    }
    schedulePersist(job);
  }
}

export function updateJobProgress(id: string, progress: JobProgress): void {
  const job = jobs.get(id);
  if (job) {
    job.progress = progress;
    job.lastProgressAt = new Date();
    schedulePersist(job);
  }
}

export function setJobPaused(id: string): void {
  const job = jobs.get(id);
  if (job) {
    markPaused(job);
    job.lastProgressAt = new Date();
    schedulePersist(job);
  }
}

export function setJobPausing(id: string): void {
  const job = jobs.get(id);
  if (job) {
    markPausing(job);
    job.lastProgressAt = new Date();
    schedulePersist(job);
  }
}

export function setJobError(id: string, error: string): void {
  const job = jobs.get(id);
  if (job) {
    markFailed(job, error);
    job.lastProgressAt = new Date();
    schedulePersist(job);
  }
}

export function setJobOutput(id: string, outputFilePath: string): void {
  const job = jobs.get(id);
  if (job) {
    job.outputFilePath = outputFilePath;
    job.outputFileName = basename(outputFilePath);
    job.lastProgressAt = new Date();
    markDone(job);
    schedulePersist(job);
  }
}

export async function persistJobUpload(
  job: Job,
  file: MultipartFile,
): Promise<void> {
  const paths = buildJobPaths(job.id, job.inputFileName, job.kind);
  await mkdir(paths.jobDir, { recursive: true });
  const temporaryInputPath = `${paths.inputFilePath}.${randomUUID()}.upload`;
  try {
    await pipeline(file.file, createWriteStream(temporaryInputPath));
    if (file.file.truncated) throw new Error("El archivo supera el tamaño permitido");
    await rename(temporaryInputPath, paths.inputFilePath);
  } finally { await rm(temporaryInputPath, { force: true }).catch(() => undefined); }
  job.inputFilePath = paths.inputFilePath;
  job.outputFilePath = paths.outputFilePath;
  await persistJob(job);
}

export async function restoreJobsFromDisk(): Promise<void> {
  await loadJobsFromDisk();

  queue.restore();
}

export async function prepareJobsForShutdown(): Promise<void> {
  for (const job of jobs.values()) {
    if (job.status === "processing" || job.status === "pausing" || job.status === "pending") {
      markPaused(job);
      job.progress = { ...job.progress, message: "Pausada tras cerrar el servidor" };
      job.lastProgressAt = new Date();
      schedulePersist(job);
    }
  }
  await queue.stop();
  await persistence.flush();
}

/** Stops visible work immediately; the worker exits at its next safe checkpoint. */
export async function pauseActiveJobs(): Promise<void> {
  const activeJobs = Array.from(jobs.values()).filter(
    (job) => job.status === "processing" || job.status === "pausing",
  );

  await Promise.all(activeJobs.map(async (job) => {
    stopJobTimer(job);
    job.status = "paused";
    job.progress = {
      ...job.progress,
      message: job.kind === "pdf-conversion" ? "Conversión pausada" : "Traducción pausada",
    };
    job.lastProgressAt = new Date();
    await persistJob(job);
  }));
}

export function pauseJob(id: string): Job | undefined {
  const job = getJob(id);
  if (!job) {
    return undefined;
  }

  if (job.status === "pending") {
    job.queueOrder = null;
    setJobPaused(id);
  } else if (job.status === "processing") {
    setJobPausing(id);
  }

  return job;
}

export function resumeJob(id: string): Job | undefined {
  const job = getJob(id);
  if (!job) {
    return undefined;
  }

  if (queue.isActive(id)) return job;
  if (job.status === "paused" || job.status === "error") {
    const alreadyQueued = queue.has(job.id);
    prepareResume(job);
    schedulePersist(job);
    if (alreadyQueued) void queue.drain(job.kind);
    else { job.queueOrder = -1; void startJobProcessing(id).catch(reportPersistenceError); }
  }
  return job;
}
