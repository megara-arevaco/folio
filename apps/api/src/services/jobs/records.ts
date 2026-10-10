import type { Job, JobKind, JobProgress } from "../../types";

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
  lastProgressAt?: string | null;
  archived?: boolean;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
};

export function toPersistedJobRecord(job: Job): PersistedJobRecord {
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
    lastProgressAt: job.lastProgressAt?.toISOString() ?? null,
    archived: job.archived,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
  };
}

export function fromPersistedJobRecord(record: PersistedJobRecord): Job {
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
    lastProgressAt: record.lastProgressAt ? new Date(record.lastProgressAt) : createdAt,
    archived: record.archived ?? false,
    createdAt,
    // Timers only exist in the process that owns the worker.  A restored job
    // must never count server downtime as active processing time.
    startedAt: null,
    completedAt: record.completedAt ? new Date(record.completedAt) : null,
  };
}


export function isPersistedJobRecord(value: unknown): value is PersistedJobRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const nonnegative = (item: unknown) => typeof item === "number" && Number.isFinite(item) && item >= 0;
  const integer = (item: unknown) => nonnegative(item) && Number.isInteger(item);
  const date = (item: unknown) => typeof item === "string" && Number.isFinite(Date.parse(item));
  const nullableDate = (item: unknown) => item === undefined || item === null || date(item);
  const strings = (item: unknown) => Array.isArray(item) && item.every((entry) => typeof entry === "string");
  const progress = record.progress as Record<string, unknown> | null;
  return typeof record.id === "string" && /^[a-zA-Z0-9_-]{1,240}$/.test(record.id) &&
    (record.kind === undefined || record.kind === "epub-translation" || record.kind === "pdf-conversion") &&
    ["pending", "processing", "pausing", "paused", "done", "error"].includes(record.status as string) &&
    !!progress && integer(progress.current) && integer(progress.total) && typeof progress.message === "string" &&
    integer(record.checkpointBatchIndex) && typeof record.inputFileName === "string" &&
    (record.outputFileName === null || typeof record.outputFileName === "string") &&
    typeof record.inputFilePath === "string" && typeof record.outputFilePath === "string" &&
    (record.error === null || typeof record.error === "string") && date(record.createdAt) &&
    nullableDate(record.startedAt) && nullableDate(record.completedAt) &&
    (record.elapsedMs === undefined || nonnegative(record.elapsedMs)) &&
    (record.lastProgressAt === undefined || record.lastProgressAt === null || date(record.lastProgressAt)) &&
    (record.archived === undefined || typeof record.archived === "boolean") &&
    (record.queueOrder === undefined || record.queueOrder === null ||
      typeof record.queueOrder === "number" && Number.isFinite(record.queueOrder)) &&
    (record.completedChapters === undefined || strings(record.completedChapters)) &&
    (record.translationMemory === undefined || !!record.translationMemory &&
      typeof record.translationMemory === "object" && !Array.isArray(record.translationMemory) &&
      Object.values(record.translationMemory).every((entry) => typeof entry === "string")) &&
    (record.glossary === undefined || Array.isArray(record.glossary) && record.glossary.every((entry) =>
      !!entry && typeof entry === "object" && typeof entry.source === "string" && typeof entry.target === "string" &&
      (entry.type === undefined || ["name", "place", "term", "title"].includes(entry.type))));
}
