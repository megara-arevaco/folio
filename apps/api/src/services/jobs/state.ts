import type { Job } from "../../types";

export function startJobTimer(job: Job, now: () => number = Date.now): void {
  if (!job.startedAt) {
    job.startedAt = new Date(now());
  }
}

export function stopJobTimer(job: Job, now: () => number = Date.now): void {
  if (!job.startedAt) return;
  job.elapsedMs = (job.elapsedMs ?? 0) + Math.max(0, now() - job.startedAt.getTime());
  job.startedAt = null;
}

export function markPaused(job: Job, now: () => number = Date.now): void {
  stopJobTimer(job, now);
  job.status = "paused";
  job.progress = { ...job.progress, message: job.kind === "pdf-conversion" ? "Conversion pausada" : "Traduccion pausada" };
}

export function markPausing(job: Job): void {
  job.status = "pausing";
  job.progress = { ...job.progress, message: job.kind === "pdf-conversion" ? "Deteniendo conversión" : "Deteniendo traducción" };
}

export function markFailed(job: Job, error: string, now: () => number = Date.now): void {
  stopJobTimer(job, now);
  job.status = "error";
  job.error = error;
  job.queueOrder = null;
  job.completedAt = new Date(now());
  job.progress = { ...job.progress, message: job.kind === "pdf-conversion" ? "Error en la conversion" : "Error en la traduccion" };
}

export function markDone(job: Job, now: () => number = Date.now): void {
  stopJobTimer(job, now);
  job.status = "done";
  job.checkpointBatchIndex = job.progress.total;
  job.queueOrder = null;
  job.completedAt = new Date(now());
}

export function prepareResume(job: Job): void {
  job.status = "pending";
  job.error = null;
  job.completedAt = null;
  job.progress = { current: job.checkpointBatchIndex, total: job.progress.total, message: "Reanudando trabajo" };
}
