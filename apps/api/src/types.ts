import type { JobStatus, JobKind, JobProgress } from "../../../packages/contracts/src";
export type { JobStatus, JobKind, JobProgress, PublicJob } from "../../../packages/contracts/src";

export type GlossaryEntry = {
  source: string;
  target: string;
  type?: "name" | "place" | "term" | "title";
};

export type Job = {
  id: string;
  kind: JobKind;
  status: JobStatus;
  progress: JobProgress;
  checkpointBatchIndex: number;
  inputFileName: string;
  outputFileName: string | null;
  inputFilePath: string;
  outputFilePath: string;
  error: string | null;
  glossary: GlossaryEntry[];
  completedChapters: string[];
  translationMemory: Record<string, string>;
  queueOrder: number | null;
  elapsedMs: number;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
};

export type TextItem = { id: string; text: string };
