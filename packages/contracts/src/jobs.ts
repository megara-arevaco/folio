export type JobStatus = "pending" | "processing" | "pausing" | "paused" | "done" | "error";
export type JobKind = "epub-translation" | "pdf-conversion";

export type JobProgress = {
  current: number;
  total: number;
  message: string;
};

export type PublicJob = {
  id: string;
  kind: JobKind;
  status: JobStatus;
  progress: JobProgress;
  inputFileName: string;
  outputFileName: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  elapsedMs: number;
  downloadUrl?: string;
};

