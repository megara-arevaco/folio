import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Job, JobProgress, TextItem } from "../../types";
import { PauseRequestedError, type processEpub as EpubExecutor } from "../epub";
import type { processPdfToEpub as PdfExecutor } from "../pdf";
import { publishNewFile } from "../shared/files";
import { startJobTimer } from "./state";

type RunnerDependencies = {
  processEpub: typeof EpubExecutor;
  processPdfToEpub: typeof PdfExecutor;
  getJob: (id: string) => Job | undefined;
  isActive: (id: string) => boolean;
  enterRun: (id: string) => unknown;
  leaveRun: (id: string) => unknown;
  persistJob: (job: Job) => Promise<void>;
  schedulePersist: (job: Job) => void;
  readTranslatedItems: (job: Job) => Promise<TextItem[]>;
  persistTranslatedItems: (job: Job, items: TextItem[]) => Promise<void>;
  updateJobStatus: (id: string, status: Job["status"]) => void;
  updateJobProgress: (id: string, progress: JobProgress) => void;
  setJobOutput: (id: string, path: string) => void;
  setJobError: (id: string, error: string) => void;
  setJobPaused: (id: string) => void;
  insertPausedJobIntoQueue: (job: Job) => void;
};

export function createJobRunner(dependencies: RunnerDependencies) {
  const { processEpub, processPdfToEpub, getJob, isActive, enterRun, leaveRun,
    persistJob, schedulePersist, readTranslatedItems, persistTranslatedItems,
    updateJobStatus, updateJobProgress, setJobOutput, setJobError, setJobPaused,
    insertPausedJobIntoQueue } = dependencies;
  return async function processJob(jobId: string): Promise<void> {
    const job = getJob(jobId);
    if (!job || job.status !== "pending" || isActive(jobId)) {
      return;
    }
    enterRun(jobId);

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
    try {
      await persistJob(job);
      const translated =
        job.kind === "pdf-conversion"
          ? await processPdfToEpub(job.inputFilePath, {
              inputFileName: job.inputFileName,
              onCheckpoint: async (completedPages, totalPages) => {
                job.checkpointBatchIndex = completedPages;
                job.progress = { ...job.progress, current: completedPages, total: totalPages };
                await persistJob(job);
              },
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
      const outputPath = await publishNewFile(job.outputFilePath, translated);
      setJobOutput(job.id, outputPath);
      updateJobProgress(job.id, {
        current: 1,
        total: 1,
        message: "Listo",
      });
      await persistJob(job);
    } catch (error) {
      if (error instanceof PauseRequestedError) {
        if (getJob(job.id)?.status === "processing") setJobPaused(job.id);
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      setJobError(job.id, message);
      await persistJob(job);
    } finally {
      leaveRun(jobId);
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

}
