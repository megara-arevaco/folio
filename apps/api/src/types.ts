export type JobStatus = "pending" | "processing" | "pausing" | "paused" | "done" | "error";
export type JobKind = "epub-translation" | "pdf-conversion";

export type JobProgress = {
  current: number;
  total: number;
  message: string;
};

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

export type PublicJob = {
  id: string;
  kind: JobKind;
  status: JobStatus;
  progress: JobProgress;
  inputFileName: string;
  outputFileName: string | null;
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  elapsedMs: number;
  downloadUrl?: string;
};
