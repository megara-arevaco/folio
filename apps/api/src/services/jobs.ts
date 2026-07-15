import { createWriteStream } from "node:fs";
import { access, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import type { MultipartFile } from "@fastify/multipart";
import { PauseRequestedError, processEpub, type TextItem } from "./epub";
import { processPdfToEpub } from "./pdf";
import { Job, JobKind, JobProgress, PublicJob } from "../types";

const jobs = new Map<string, Job>();
const activeRuns = new Set<string>();
const jobQueues: Record<JobKind, string[]> = {
  "epub-translation": [],
  "pdf-conversion": [],
};
const queuedJobIds = new Set<string>();
const workerRunning: Record<JobKind, boolean> = {
  "epub-translation": false,
  "pdf-conversion": false,
};
const persistenceChains = new Map<string, Promise<void>>();

function getJobsTmpRoot(): string {
  return process.env.JOBS_TMP_ROOT
    ? resolve(process.env.JOBS_TMP_ROOT)
    : resolve(process.cwd(), "tmp", "jobs");
}

function getOutputRoot(jobDir: string): string {
  return process.env.OUTPUT_DIR ? resolve(process.env.OUTPUT_DIR) : jobDir;
}

function getJobDir(job: Pick<Job, "inputFilePath">): string {
  return dirname(job.inputFilePath);
}

type JobPaths = {
  jobDir: string;
  metadataFilePath: string;
  checkpointFilePath: string;
  inputFilePath: string;
  outputFilePath: string;
  outputFileName: string;
};

function getJobFileNames(kind: JobKind) {
  if (kind === "pdf-conversion") {
    return {
      inputFileName: "input.pdf",
      outputPrefix: "converted-",
    };
  }

  return {
    inputFileName: "input.epub",
    outputPrefix: "translated-",
  };
}

export type PersistedJobRecord = {
  id: string;
  kind?: JobKind;
  status: Job["status"];
  progress: JobProgress;
  checkpointBatchIndex: number;
  inputFileName: string;
  outputFileName: string | null;
  inputFilePath: string;
  outputFilePath: string;
  error: string | null;
  glossary?: Job["glossary"];
  completedChapters?: string[];
  translationMemory?: Job["translationMemory"];
  queueOrder?: number | null;
  elapsedMs?: number;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
};

function sanitizeOutputFileName(inputFileName: string, kind: JobKind): string {
  const normalized = basename(inputFileName).replace(/[^a-zA-Z0-9._-]/g, "-");
  const outputBaseName = normalized.replace(/\.[^.]+$/i, "");
  const prefix = getJobFileNames(kind).outputPrefix;
  const extension = ".epub";
  const maxFileNameLength = 200;
  const availableBaseLength = maxFileNameLength - prefix.length - extension.length;

  if (outputBaseName.length <= availableBaseLength) {
    return `${prefix}${outputBaseName}${extension}`;
  }

  const fingerprint = createHash("sha256").update(normalized).digest("hex").slice(0, 12);
  const shortenedBase = outputBaseName.slice(0, availableBaseLength - fingerprint.length - 1);
  return `${prefix}${shortenedBase}-${fingerprint}${extension}`;
}

export function buildJobPaths(
  jobId: string,
  inputFileName: string,
  kind: JobKind = "epub-translation",
): JobPaths {
  const jobDir = resolve(getJobsTmpRoot(), jobId);
  const outputFileName = sanitizeOutputFileName(inputFileName, kind);
  const jobFileNames = getJobFileNames(kind);

  return {
    jobDir,
    metadataFilePath: resolve(jobDir, "job.json"),
    checkpointFilePath: resolve(jobDir, "translated-items.json"),
    inputFilePath: resolve(jobDir, jobFileNames.inputFileName),
    outputFilePath: resolve(getOutputRoot(jobDir), outputFileName),
    outputFileName,
  };
}

function toPersistedJobRecord(job: Job): PersistedJobRecord {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    progress: job.progress,
    checkpointBatchIndex: job.checkpointBatchIndex,
    inputFileName: job.inputFileName,
    outputFileName: job.outputFileName,
    inputFilePath: job.inputFilePath,
    outputFilePath: job.outputFilePath,
    error: job.error,
    glossary: job.glossary,
    completedChapters: job.completedChapters,
    translationMemory: job.translationMemory,
    queueOrder: job.queueOrder,
    elapsedMs: job.elapsedMs,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
  };
}

function fromPersistedJobRecord(record: PersistedJobRecord): Job {
  const wasInFlight =
    record.status === "pending" || record.status === "processing" || record.status === "pausing";
  const createdAt = new Date(record.createdAt);

  // A process cannot safely continue work that belonged to a previous server
  // instance.  Keep its checkpoint and make an explicit user action required
  // before it can run again.
  const wasActive = record.status === "processing" || record.status === "pausing";

  return {
    id: record.id,
    kind: record.kind ?? "epub-translation",
    status: wasActive ? "paused" : record.status,
    progress: wasActive
      ? { ...record.progress, message: "Pausada tras reiniciar el servidor" }
      : record.progress,
    checkpointBatchIndex: record.checkpointBatchIndex,
    inputFileName: record.inputFileName,
    outputFileName: record.outputFileName,
    inputFilePath: record.inputFilePath,
    outputFilePath: record.outputFilePath,
    error: record.error,
    glossary: record.glossary ?? [],
    completedChapters: record.completedChapters ?? [],
    translationMemory: record.translationMemory ?? {},
    queueOrder: wasInFlight || record.status === "paused"
      ? record.queueOrder ?? createdAt.getTime()
      : null,
    elapsedMs: record.elapsedMs ?? 0,
    createdAt,
    // Timers only exist in the process that owns the worker.  A restored job
    // must never count server downtime as active processing time.
    startedAt: null,
    completedAt: record.completedAt ? new Date(record.completedAt) : null,
  };
}

async function writeFileAtomically(filePath: string, content: string | Buffer): Promise<void> {
  const temporaryPath = resolve(dirname(filePath), `.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, content);
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function writePersistedJob(job: Job): Promise<void> {
  const jobDir = getJobDir(job);
  await mkdir(jobDir, { recursive: true });
  await writeFileAtomically(
    resolve(jobDir, "job.json"),
    JSON.stringify(toPersistedJobRecord(job), null, 2),
  );
}

function persistJob(job: Job): Promise<void> {
  const previous = persistenceChains.get(job.id) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => writePersistedJob(job));
  persistenceChains.set(job.id, next);
  return next;
}

async function persistTranslatedItems(job: Job, items: TextItem[]): Promise<void> {
  const jobDir = getJobDir(job);
  await mkdir(jobDir, { recursive: true });
  await writeFileAtomically(resolve(jobDir, "translated-items.json"), JSON.stringify(items, null, 2));
}

async function readTranslatedItems(job: Job): Promise<TextItem[]> {
  try {
    const raw = await readFile(resolve(getJobDir(job), "translated-items.json"), "utf-8");
    const parsed = JSON.parse(raw) as TextItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function schedulePersist(job: Job): void {
  void persistJob(job);
}

function startJobTimer(job: Job): void {
  if (!job.startedAt) {
    job.startedAt = new Date();
  }
}

function stopJobTimer(job: Job): void {
  if (!job.startedAt) return;
  job.elapsedMs = (job.elapsedMs ?? 0) + Math.max(0, Date.now() - job.startedAt.getTime());
  job.startedAt = null;
}

function insertPausedJobIntoQueue(job: Job): void {
  const queue = jobQueues[job.kind];
  if (!queuedJobIds.has(job.id)) {
    queue.unshift(job.id);
    queuedJobIds.add(job.id);
  }
  queue.forEach((jobId, index) => {
    const queuedJob = jobs.get(jobId);
    if (queuedJob) {
      queuedJob.queueOrder = index;
      schedulePersist(queuedJob);
    }
  });
  refreshQueueProgress(job.kind);
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

export async function deleteJob(id: string): Promise<"deleted" | "processing" | "missing"> {
  const job = jobs.get(id);
  if (!job) return "missing";
  if (activeRuns.has(id) || job.status === "processing") return "processing";

  const queue = jobQueues[job.kind];
  const queueIndex = queue.indexOf(id);
  if (queueIndex >= 0) queue.splice(queueIndex, 1);
  queuedJobIds.delete(id);
  refreshQueueProgress(job.kind);

  await (persistenceChains.get(id) ?? Promise.resolve()).catch(() => undefined);
  jobs.delete(id);
  persistenceChains.delete(id);
  await rm(getJobDir(job), {
    recursive: true,
    force: true,
  });
  return "deleted";
}

export async function deleteCompletedJobs(): Promise<number> {
  const completedJobIds = Array.from(jobs.values())
    .filter((job) => job.status === "done")
    .map((job) => job.id);

  await Promise.all(completedJobIds.map((jobId) => deleteJob(jobId)));
  return completedJobIds.length;
}

export async function renameJobOutput(
  id: string,
  requestedFileName: string,
): Promise<Job | "missing" | "not-ready" | "exists" | "invalid"> {
  const job = jobs.get(id);
  if (!job) return "missing";
  if (job.status !== "done" || !job.outputFileName) return "not-ready";

  const baseName = basename(requestedFileName.trim()).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-");
  if (!baseName) return "invalid";
  const outputFileName = baseName.toLowerCase().endsWith(".epub") ? baseName : `${baseName}.epub`;
  if (outputFileName === job.outputFileName) return job;
  const outputFilePath = resolve(dirname(job.outputFilePath), outputFileName);
  try {
    await access(outputFilePath);
    return "exists";
  } catch {
    // The destination is available.
  }

  await rename(job.outputFilePath, outputFilePath);
  job.outputFileName = outputFileName;
  job.outputFilePath = outputFilePath;
  await persistJob(job);
  return job;
}

export async function reorderQueuedJob(
  id: string,
  position: number,
): Promise<Job | "missing" | "not-queued"> {
  const job = jobs.get(id);
  if (!job) return "missing";
  if ((job.status !== "pending" && job.status !== "paused") || !queuedJobIds.has(id)) {
    return "not-queued";
  }

  const queue = jobQueues[job.kind];
  const currentPosition = queue.indexOf(id);
  if (currentPosition < 0) return "not-queued";

  queue.splice(currentPosition, 1);
  const nextPosition = Math.max(0, Math.min(Math.trunc(position), queue.length));
  queue.splice(nextPosition, 0, id);

  const queuedJobs = queue
    .map((jobId, index) => {
      const queuedJob = jobs.get(jobId);
      if (queuedJob) queuedJob.queueOrder = index;
      return queuedJob;
    })
    .filter((queuedJob): queuedJob is Job => Boolean(queuedJob));
  refreshQueueProgress(job.kind);
  await Promise.all(queuedJobs.map((queuedJob) => persistJob(queuedJob)));
  return job;
}

export async function startQueuedJob(id: string): Promise<Job | "missing" | "not-queued"> {
  const job = jobs.get(id);
  if (!job) return "missing";
  if (job.status !== "pending" || !queuedJobIds.has(id)) return "not-queued";

  const queue = jobQueues[job.kind];
  const currentPosition = queue.indexOf(id);
  if (currentPosition < 0) return "not-queued";

  queue.splice(currentPosition, 1);
  queue.unshift(id);
  const queuedJobs = queue
    .map((jobId, index) => {
      const queuedJob = jobs.get(jobId);
      if (queuedJob) queuedJob.queueOrder = index;
      return queuedJob;
    })
    .filter((queuedJob): queuedJob is Job => Boolean(queuedJob));
  refreshQueueProgress(job.kind);
  await Promise.all(queuedJobs.map((queuedJob) => persistJob(queuedJob)));
  void drainJobQueue(job.kind);
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
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    elapsedMs: job.elapsedMs,
    downloadUrl: job.status === "done" ? `/api/jobs/${job.id}/download` : undefined,
  };
}

export function updateJobStatus(id: string, status: Job["status"]): void {
  const job = jobs.get(id);
  if (job) {
    job.status = status;
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
    schedulePersist(job);
  }
}

export function setJobPaused(id: string): void {
  const job = jobs.get(id);
  if (job) {
    job.status = "paused";
    stopJobTimer(job);
    job.progress = {
      ...job.progress,
      message: job.kind === "pdf-conversion" ? "Conversion pausada" : "Traduccion pausada",
    };
    schedulePersist(job);
  }
}

export function setJobPausing(id: string): void {
  const job = jobs.get(id);
  if (job) {
    job.status = "pausing";
    job.progress = {
      ...job.progress,
      message: job.kind === "pdf-conversion" ? "Deteniendo conversión" : "Deteniendo traducción",
    };
    schedulePersist(job);
  }
}

export function setJobError(id: string, error: string): void {
  const job = jobs.get(id);
  if (job) {
    job.status = "error";
    stopJobTimer(job);
    job.error = error;
    job.queueOrder = null;
    job.completedAt = new Date();
    job.progress = {
      ...job.progress,
      message: job.kind === "pdf-conversion" ? "Error en la conversion" : "Error en la traduccion",
    };
    schedulePersist(job);
  }
}

export function setJobOutput(id: string, outputFilePath: string): void {
  const job = jobs.get(id);
  if (job) {
    job.outputFilePath = outputFilePath;
    job.outputFileName = basename(outputFilePath);
    job.status = "done";
    stopJobTimer(job);
    job.checkpointBatchIndex = job.progress.total;
    job.queueOrder = null;
    job.completedAt = new Date();
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
  await pipeline(file.file, createWriteStream(temporaryInputPath));
  await rename(temporaryInputPath, paths.inputFilePath);
  job.inputFilePath = paths.inputFilePath;
  job.outputFilePath = paths.outputFilePath;
  await persistJob(job);
}

function queueLabel(kind: JobKind): string {
  return kind === "pdf-conversion" ? "conversión PDF" : "traducción EPUB";
}

function refreshQueueProgress(kind: JobKind): void {
  for (const [index, jobId] of jobQueues[kind].entries()) {
    const job = getJob(jobId);
    if (!job || job.status !== "pending") continue;
    job.progress = {
      ...job.progress,
      message:
        job.kind === "epub-translation" &&
        job.progress.total > 0 &&
        job.checkpointBatchIndex >= job.progress.total
          ? "Preparado para generar EPUB"
          : "En cola",
    };
    schedulePersist(job);
  }
}

async function processJob(jobId: string): Promise<void> {
  const job = getJob(jobId);
  if (!job || job.status !== "pending" || activeRuns.has(jobId)) {
    return;
  }
  activeRuns.add(jobId);

  job.queueOrder = null;
  startJobTimer(job);
  updateJobStatus(job.id, "processing");
  updateJobProgress(job.id, {
    current: job.checkpointBatchIndex,
    total: job.progress.total,
    message:
      job.checkpointBatchIndex > 0
        ? "Reanudando trabajo"
        : job.kind === "pdf-conversion"
          ? "Leyendo PDF"
          : "Leyendo EPUB",
  });
  await persistJob(job);

  try {
    const translated =
      job.kind === "pdf-conversion"
        ? await processPdfToEpub(job.inputFilePath, {
            onProgress: (progress) => {
              updateJobProgress(job.id, progress);
            },
            shouldPause: () => {
              const status = getJob(job.id)?.status;
              return status === "pausing" || status === "paused";
            },
          })
        : await processEpub(job.inputFilePath, {
            onProgress: (progress) => {
              updateJobProgress(job.id, progress);
            },
            translatedItemsCheckpoint: await readTranslatedItems(job),
            startBatchIndex: job.checkpointBatchIndex,
            shouldPause: () => {
              const status = getJob(job.id)?.status;
              return status === "pausing" || status === "paused";
            },
            onCheckpoint: async (translatedItems, nextBatchIndex, totalBatches) => {
              const currentJob = getJob(job.id);
              if (!currentJob) {
                return;
              }

              currentJob.checkpointBatchIndex = nextBatchIndex;
              currentJob.progress = {
                current: nextBatchIndex,
                total: totalBatches,
                message:
                  nextBatchIndex >= totalBatches
                    ? "Generando EPUB"
                    : `Traduciendo fragmento ${nextBatchIndex} de ${totalBatches}`,
              };
              await persistTranslatedItems(currentJob, translatedItems);
              await persistJob(currentJob);
            },
            glossary: job.glossary,
            onGlossary: (glossary) => {
              job.glossary = glossary;
              schedulePersist(job);
            },
            translationMemory: job.translationMemory,
            onMemoryUpdate: (translationMemory) => {
              job.translationMemory = translationMemory;
              schedulePersist(job);
            },
            onChapterCheckpoint: (entryName) => {
              if (!job.completedChapters.includes(entryName)) {
                job.completedChapters.push(entryName);
                schedulePersist(job);
              }
            },
            enableReview: process.env.TRANSLATION_REVIEW === "true",
          });

    if (
      getJob(job.id)?.status === "pausing" ||
      getJob(job.id)?.status === "paused"
    ) {
      throw new PauseRequestedError();
    }

    await mkdir(dirname(job.outputFilePath), { recursive: true });
    await writeFileAtomically(job.outputFilePath, translated);
    setJobOutput(job.id, job.outputFilePath);
    updateJobProgress(job.id, {
      current: 1,
      total: 1,
      message: "Listo",
    });
    await persistJob(job);
  } catch (error) {
    if (error instanceof PauseRequestedError) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    setJobError(job.id, message);
    await persistJob(job);
  } finally {
    activeRuns.delete(jobId);
    const currentJob = getJob(jobId);
    if (currentJob?.status === "pausing" || currentJob?.status === "paused") {
      if (currentJob.status === "pausing") {
        setJobPaused(jobId);
      }
      insertPausedJobIntoQueue(currentJob);
      await persistJob(currentJob);
    }
  }
}

async function drainJobQueue(kind: JobKind): Promise<void> {
  if (workerRunning[kind]) return;
  workerRunning[kind] = true;

  try {
    while (jobQueues[kind].length > 0) {
      const jobId = jobQueues[kind].shift()!;
      queuedJobIds.delete(jobId);
      refreshQueueProgress(kind);

      const job = getJob(jobId);
      if (!job || job.kind !== kind || job.status !== "pending") continue;
      await processJob(jobId);
      if (getJob(jobId)?.status === "paused") break;
    }
  } finally {
    workerRunning[kind] = false;
    const hasPausedJob = Array.from(jobs.values()).some(
      (job) => job.kind === kind && job.status === "paused",
    );
    if (jobQueues[kind].length > 0 && !hasPausedJob) void drainJobQueue(kind);
  }
}

export async function startJobProcessing(jobId: string): Promise<void> {
  const job = getJob(jobId);
  if (!job || job.status !== "pending" || activeRuns.has(jobId) || queuedJobIds.has(jobId)) {
    return;
  }

  if (job.queueOrder === null) {
    const orders = jobQueues[job.kind]
      .map((queuedJobId) => getJob(queuedJobId)?.queueOrder)
      .filter((order): order is number => order !== null && order !== undefined);
    job.queueOrder = orders.length > 0 ? Math.max(...orders) + 1 : 0;
  }
  jobQueues[job.kind].push(jobId);
  jobQueues[job.kind].sort(
    (leftId, rightId) => (getJob(leftId)?.queueOrder ?? 0) - (getJob(rightId)?.queueOrder ?? 0),
  );
  queuedJobIds.add(jobId);
  refreshQueueProgress(job.kind);
  await persistJob(job);
  void drainJobQueue(job.kind);
}

export async function loadJobsFromDisk(rootDir = getJobsTmpRoot()): Promise<{
  jobs: Job[];
}> {
  await mkdir(rootDir, { recursive: true });

  const entries = await readdir(rootDir, { withFileTypes: true });
  const loadedJobs: Job[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const metadataFilePath = resolve(rootDir, entry.name, "job.json");

    try {
      const raw = await readFile(metadataFilePath, "utf-8");
      const record = JSON.parse(raw) as PersistedJobRecord;
      const job = fromPersistedJobRecord(record);
      jobs.set(job.id, job);
      loadedJobs.push(job);

    } catch {
      continue;
    }
  }

  loadedJobs.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  return {
    jobs: loadedJobs,
  };
}

export async function restoreJobsFromDisk(): Promise<void> {
  await loadJobsFromDisk();

  for (const kind of Object.keys(jobQueues) as JobKind[]) {
    const restoredQueue = Array.from(jobs.values())
      .filter((job) => job.kind === kind && (job.status === "paused" || job.status === "pending"))
      .sort((left, right) => (left.queueOrder ?? 0) - (right.queueOrder ?? 0));
    jobQueues[kind].push(...restoredQueue.map((job) => job.id));
    restoredQueue.forEach((job, index) => {
      job.queueOrder = index;
      queuedJobIds.add(job.id);
    });
    refreshQueueProgress(kind);
  }
}

export async function prepareJobsForShutdown(): Promise<void> {
  const activeJobs = Array.from(jobs.values()).filter(
    (job) => job.status === "processing" || job.status === "pausing",
  );

  await Promise.all(activeJobs.map(async (job) => {
    stopJobTimer(job);
    job.status = "paused";
    job.progress = {
      ...job.progress,
      message: "Pausada tras cerrar el servidor",
    };
    await persistJob(job);
  }));
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

  if (job.status === "paused" || job.status === "error") {
    if (job.status === "paused" && queuedJobIds.has(job.id)) {
      updateJobStatus(id, "pending");
      job.error = null;
      updateJobProgress(id, {
        current: job.checkpointBatchIndex,
        total: job.progress.total,
        message: "Reanudando trabajo",
      });
      void drainJobQueue(job.kind);
      return job;
    }

    job.queueOrder = -1;
    updateJobStatus(id, "pending");
    job.error = null;
    job.completedAt = null;
    updateJobProgress(id, {
      current: job.checkpointBatchIndex,
      total: job.progress.total,
      message: "Reanudando trabajo",
    });
    void startJobProcessing(id);
  }

  return job;
}
