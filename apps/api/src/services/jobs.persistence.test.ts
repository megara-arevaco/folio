import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadJobsFromDisk, type PersistedJobRecord } from "./jobs";

test("loadJobsFromDisk reloads persisted in-flight jobs as paused", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "epub-jobs-"));
  const jobDir = join(rootDir, "job-1");
  await mkdir(jobDir, { recursive: true });

  const persistedJob: PersistedJobRecord = {
    id: "job-1",
    status: "processing",
    progress: {
      current: 2,
      total: 5,
      message: "Traduciendo fragmento 2 de 5",
    },
    checkpointBatchIndex: 2,
    inputFileName: "book.epub",
    outputFileName: null,
    inputFilePath: join(jobDir, "input.epub"),
    outputFilePath: join(jobDir, "translated-book.epub"),
    error: null,
    createdAt: "2026-07-01T10:00:00.000Z",
  };

  await writeFile(join(jobDir, "job.json"), JSON.stringify(persistedJob, null, 2));

  const { jobs } = await loadJobsFromDisk(rootDir);

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.id, "job-1");
  assert.equal(jobs[0]?.status, "paused");
  assert.equal(jobs[0]?.progress.current, 2);
  assert.equal(jobs[0]?.progress.message, "Pausada tras reiniciar el servidor");
});
