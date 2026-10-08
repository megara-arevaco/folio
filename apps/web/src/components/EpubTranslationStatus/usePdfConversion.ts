import { useEffect, useRef, useState } from "react";
import {
  fetchTranslationJob,
  requestPdfConversion,
  resumeTranslationJob,
  type TranslationJob,
  type TranslationJobProgress,
} from "../../services/translation";

type PdfConversionState = {
  activeJobId: string | null;
  file: File | null;
  job: TranslationJob | null;
  inputFileName: string | null;
  isUploading: boolean;
  isConverting: boolean;
  error: string | null;
};

const ACTIVE_JOB_STORAGE_KEY = "folio.active-pdf-job";

const INITIAL_STATE: PdfConversionState = {
  activeJobId: null,
  file: null,
  job: null,
  inputFileName: null,
  isUploading: false,
  isConverting: false,
  error: null,
};

type PersistedActiveJob = {
  jobId: string;
  inputFileName: string | null;
};

function readPersistedJob(): PersistedActiveJob | null {
  const rawValue = window.localStorage.getItem(ACTIVE_JOB_STORAGE_KEY);
  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue) as PersistedActiveJob;
  } catch {
    window.localStorage.removeItem(ACTIVE_JOB_STORAGE_KEY);
    return null;
  }
}

function persistActiveJob(jobId: string, inputFileName: string | null): void {
  window.localStorage.setItem(
    ACTIVE_JOB_STORAGE_KEY,
    JSON.stringify({ jobId, inputFileName } satisfies PersistedActiveJob),
  );
}

function clearPersistedJob(): void {
  window.localStorage.removeItem(ACTIVE_JOB_STORAGE_KEY);
}

export function usePdfConversion() {
  const [state, setState] = useState<PdfConversionState>(INITIAL_STATE);
  const pollTimerRef = useRef<number | null>(null);

  function clearPollTimer() {
    if (pollTimerRef.current !== null) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }

  function reset() {
    clearPollTimer();
    clearPersistedJob();
    setState(INITIAL_STATE);
  }

  function selectFile(file: File | null) {
    clearPollTimer();
    clearPersistedJob();
    setState({
      activeJobId: null,
      file,
      job: null,
      inputFileName: file?.name ?? null,
      isUploading: false,
      isConverting: false,
      error: null,
    });
  }

  async function pollJob(jobId: string) {
    try {
      const job = await fetchTranslationJob(jobId);

      if (job.status === "done") {
        clearPersistedJob();
        setState((current) => ({
          ...current,
          activeJobId: job.id,
          job,
          inputFileName:
            current.inputFileName ?? current.file?.name ?? job.inputFileName ?? null,
          isUploading: false,
          isConverting: false,
          error: null,
        }));
        return;
      }

      if (job.status === "error") {
        clearPersistedJob();
        setState((current) => ({
          ...current,
          activeJobId: job.id,
          job,
          inputFileName:
            current.inputFileName ?? current.file?.name ?? job.inputFileName ?? null,
          isUploading: false,
          isConverting: false,
          error: job.error ?? "La conversion ha fallado",
        }));
        return;
      }

      if (job.status === "paused") {
        setState((current) => ({
          ...current,
          activeJobId: job.id,
          job,
          inputFileName:
            current.inputFileName ?? current.file?.name ?? job.inputFileName ?? null,
          isUploading: false,
          isConverting: false,
          error: null,
        }));
        return;
      }

      setState((current) => ({
        ...current,
        activeJobId: job.id,
        job,
        inputFileName:
          current.inputFileName ?? current.file?.name ?? job.inputFileName ?? null,
        isUploading: false,
        isConverting: true,
        error: null,
      }));

      clearPollTimer();
      pollTimerRef.current = window.setTimeout(() => {
        void pollJob(jobId);
      }, 1500);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "No se ha podido leer el estado del trabajo";
      setState((current) => ({
        ...current,
        isUploading: false,
        isConverting: false,
        error: message,
      }));
    }
  }

  async function startConversion(): Promise<boolean> {
    if (!state.file || state.isUploading) {
      return false;
    }

    clearPollTimer();
    setState((current) => ({
      ...current,
      isUploading: true,
      error: null,
      job: null,
    }));

    try {
      const { jobId } = await requestPdfConversion(state.file);
      persistActiveJob(jobId, state.file.name);
      setState((current) => ({
        ...current,
        activeJobId: jobId,
        isUploading: false,
        inputFileName: state.file?.name ?? current.inputFileName,
        isConverting: true,
        error: null,
      }));
      await pollJob(jobId);
      return true;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "No se ha podido iniciar la conversion";
      setState((current) => ({
        ...current,
        isUploading: false,
        isConverting: false,
        error: message,
      }));
      return false;
    }
  }

  useEffect(() => {
    const persistedJob = readPersistedJob();

    if (!persistedJob) {
      return () => {
        clearPollTimer();
      };
    }

    setState((current) => ({
      ...current,
      activeJobId: persistedJob.jobId,
      inputFileName: persistedJob.inputFileName,
      isConverting: true,
      error: null,
    }));
    void pollJob(persistedJob.jobId);

    return () => {
      clearPollTimer();
    };
  }, []);

  const progress: TranslationJobProgress | null = state.job?.progress ?? null;
  const downloadUrl = state.job?.downloadUrl ?? null;
  const phase = state.isUploading
    ? "uploading"
    : state.isConverting
      ? "processing"
      : state.job?.status ?? "pending";

  async function resumeConversion() {
    if (!state.activeJobId) {
      return;
    }

    const job = await resumeTranslationJob(state.activeJobId);
    persistActiveJob(job.id, state.inputFileName ?? job.inputFileName ?? null);
    setState((current) => ({
      ...current,
      activeJobId: job.id,
      job,
      inputFileName: current.inputFileName ?? job.inputFileName ?? null,
      isUploading: false,
      isConverting: true,
      error: null,
    }));
    await pollJob(job.id);
  }

  return {
    activeJobId: state.activeJobId,
    file: state.file,
    inputFileName: state.inputFileName,
    progress,
    downloadUrl,
    phase,
    isUploading: state.isUploading,
    isConverting: state.isConverting,
    error: state.error,
    selectFile,
    startConversion,
    resumeConversion,
    reset,
  };
}
