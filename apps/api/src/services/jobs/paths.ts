import { basename, dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import type { Job, JobKind } from "../../types";

export function getJobsTmpRoot(): string {
  return process.env.JOBS_TMP_ROOT
    ? resolve(process.env.JOBS_TMP_ROOT)
    : resolve(process.cwd(), "tmp", "jobs");
}

function getOutputRoot(jobDir: string): string {
  return process.env.OUTPUT_DIR ? resolve(process.env.OUTPUT_DIR) : jobDir;
}

export function getJobDir(job: Pick<Job, "inputFilePath">): string {
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
  if (!/^[a-zA-Z0-9_-]{1,240}$/.test(jobId)) throw new Error("Identificador de trabajo inválido");
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

