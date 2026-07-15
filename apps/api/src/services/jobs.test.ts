import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildJobPaths,
  createJob,
  deleteCompletedJobs,
  deleteJob,
  getJob,
  pauseJob,
  prepareJobsForShutdown,
  resumeJob,
  serializeJob,
  setJobError,
  setJobOutput,
  updateJobProgress,
  updateJobStatus,
} from "./jobs";

test("buildJobPaths creates isolated input and output paths for a job", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "epub-jobs-"));
  process.env.JOBS_TMP_ROOT = testRoot;

  const paths = buildJobPaths("job-123", "book.epub");

  assert.match(paths.jobDir, /epub-jobs-.*\/job-123$/);
  assert.match(paths.inputFilePath, /epub-jobs-.*\/job-123\/input\.epub$/);
  assert.match(paths.outputFilePath, /epub-jobs-.*\/job-123\/translated-book\.epub$/);

  delete process.env.JOBS_TMP_ROOT;
});

test("buildJobPaths uses pdf input and epub output naming for pdf conversion jobs", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "epub-jobs-"));
  process.env.JOBS_TMP_ROOT = testRoot;

  const paths = buildJobPaths("job-456", "scan.pdf", "pdf-conversion");

  assert.match(paths.inputFilePath, /epub-jobs-.*\/job-456\/input\.pdf$/);
  assert.match(paths.outputFilePath, /epub-jobs-.*\/job-456\/converted-scan\.epub$/);

  delete process.env.JOBS_TMP_ROOT;
});

test("buildJobPaths stores finished EPUBs in OUTPUT_DIR when it is configured", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "epub-jobs-"));
  process.env.JOBS_TMP_ROOT = testRoot;
  process.env.OUTPUT_DIR = join(testRoot, "ebooks");

  const paths = buildJobPaths("job-789", "book.epub");

  assert.equal(paths.outputFilePath, join(testRoot, "ebooks", "translated-book.epub"));

  delete process.env.JOBS_TMP_ROOT;
  delete process.env.OUTPUT_DIR;
});

test("buildJobPaths limits long output file names", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "epub-jobs-"));
  process.env.JOBS_TMP_ROOT = testRoot;

  const paths = buildJobPaths("job-long-name", `${"very-long-book-title-".repeat(20)}.epub`);
  const outputPathParts = paths.outputFilePath.split("/");
  const outputName = outputPathParts[outputPathParts.length - 1]!;

  assert.ok(outputName.length <= 200);
  assert.match(outputName, /^translated-.*-[a-f0-9]{12}\.epub$/);

  delete process.env.JOBS_TMP_ROOT;
});

test("serializeJob exposes downloadUrl only when the job is done", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "epub-jobs-"));
  process.env.JOBS_TMP_ROOT = testRoot;

  const job = createJob("book.epub");

  assert.equal(serializeJob(job).downloadUrl, undefined);

  setJobOutput(job.id, buildJobPaths(job.id, "book.epub").outputFilePath);

  const serialized = serializeJob(job);
  assert.equal(serialized.downloadUrl, `/api/jobs/${job.id}/download`);

  delete process.env.JOBS_TMP_ROOT;
});

test("deleteCompletedJobs deletes every completed job and preserves unfinished jobs", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "epub-jobs-"));
  process.env.JOBS_TMP_ROOT = testRoot;

  const completedEpub = createJob("completed.epub");
  const completedPdf = createJob("completed.pdf", "pdf-conversion");
  const pending = createJob("pending.epub");
  updateJobStatus(completedEpub.id, "done");
  updateJobStatus(completedPdf.id, "done");

  assert.ok((await deleteCompletedJobs()) >= 2);
  assert.equal(getJob(completedEpub.id), undefined);
  assert.equal(getJob(completedPdf.id), undefined);
  assert.equal(getJob(pending.id), pending);

  await deleteJob(pending.id);
  delete process.env.JOBS_TMP_ROOT;
});

test("setJobError replaces stale progress text with an explicit error message", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "epub-jobs-"));
  process.env.JOBS_TMP_ROOT = testRoot;

  const job = createJob("book.epub");
  updateJobProgress(job.id, {
    current: 27,
    total: 375,
    message: "Traduciendo fragmento 27 de 375",
  });

  setJobError(job.id, 'Texto vacio o invalido para el ID "24_49"');

  assert.equal(job.status, "error");
  assert.equal(job.error, 'Texto vacio o invalido para el ID "24_49"');
  assert.equal(job.progress.message, "Error en la traduccion");

  delete process.env.JOBS_TMP_ROOT;
});

test("pauseJob shows a stopping state until a processing worker has stopped", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "epub-jobs-"));
  process.env.JOBS_TMP_ROOT = testRoot;
  const job = createJob("book.epub");
  updateJobStatus(job.id, "processing");

  const paused = pauseJob(job.id);

  assert.equal(paused?.status, "pausing");
  assert.equal(paused?.progress.message, "Deteniendo traducción");
  delete process.env.JOBS_TMP_ROOT;
});

test("resumeJob requeues a failed job from its checkpoint", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "epub-jobs-"));
  process.env.JOBS_TMP_ROOT = testRoot;

  const job = createJob("book.epub");
  job.checkpointBatchIndex = 206;
  updateJobProgress(job.id, {
    current: 206,
    total: 375,
    message: "Traduciendo fragmento 206 de 375",
  });
  setJobError(job.id, 'Texto vacio o invalido para el ID "24_49"');

  const resumed = resumeJob(job.id);

  assert.ok(resumed);
  assert.ok(resumed.status === "pending" || resumed.status === "processing");
  assert.equal(resumed.error, null);
  assert.equal(resumed.progress.current, 206);
  assert.equal(resumed.progress.total, 375);
  assert.ok(
    resumed.progress.message === "Reanudando trabajo" ||
      resumed.progress.message === "Leyendo EPUB" ||
      resumed.progress.message === "En cola",
  );
  assert.ok(
    getJob(job.id)?.status === "pending" || getJob(job.id)?.status === "processing",
  );

  delete process.env.JOBS_TMP_ROOT;
});

test("prepareJobsForShutdown persists active jobs as paused", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "epub-jobs-"));
  process.env.JOBS_TMP_ROOT = testRoot;
  const job = createJob("book.epub");
  updateJobStatus(job.id, "processing");

  await prepareJobsForShutdown();

  assert.equal(job.status, "paused");
  assert.equal(job.progress.message, "Pausada tras cerrar el servidor");
  delete process.env.JOBS_TMP_ROOT;
});

test("deleteJob removes a completed job from the local history", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "epub-jobs-"));
  process.env.JOBS_TMP_ROOT = testRoot;
  const job = createJob("book.epub");
  setJobOutput(job.id, buildJobPaths(job.id, "book.epub").outputFilePath);

  assert.equal(await deleteJob(job.id), "deleted");
  assert.equal(getJob(job.id), undefined);
  delete process.env.JOBS_TMP_ROOT;
});
