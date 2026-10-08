import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import {
  deleteCompletedTranslationJobs,
  deleteTranslationJob,
  pauseTranslationJob,
  reorderTranslationJob,
  resumeTranslationJob,
  startQueuedTranslationJob,
  type TranslationJob,
} from "../services/translation";

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours} h ${minutes} min`;
  if (minutes > 0) return `${minutes} min ${seconds} s`;
  return `${seconds} s`;
}

function getElapsedTime(job: TranslationJob, now: number): string | null {
  const activeSegment = job.startedAt ? Math.max(0, now - Date.parse(job.startedAt)) : 0;
  const elapsed = (job.elapsedMs ?? 0) + activeSegment;
  return elapsed > 0 ? formatDuration(elapsed) : null;
}

const statusLabels: Record<TranslationJob["status"], string> = {
  pending: "En cola",
  processing: "Procesando",
  pausing: "Pausando",
  paused: "Pausado",
  done: "Listo",
  error: "Error",
};

function ActionIcon({ type }: { type: "pause" | "resume" | "download" | "delete" }) {
  if (type === "pause") return <><path d="M9 5v14" /><path d="M15 5v14" /></>;
  if (type === "resume") return <path d="m8 5 11 7-11 7z" />;
  if (type === "download") return <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></>;
  return <><path d="M4 7h16" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M6 7l1 14h10l1-14" /><path d="M9 7V3h6v4" /></>;
}

function IconButton({
  label,
  children,
  className,
  onClick,
}: {
  label: string;
  children: React.ReactNode;
  className: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={className} aria-label={label} title={label} onClick={onClick}>
      <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </button>
  );
}

type JobsTableProps = {
  jobs: TranslationJob[];
  onRefresh: () => Promise<void>;
  enableMetadataEditor?: boolean;
};

export function JobsTable({ jobs, onRefresh, enableMetadataEditor = false }: JobsTableProps) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [isClearingCompleted, setIsClearingCompleted] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [draggedJobId, setDraggedJobId] = useState<string | null>(null);

  function canEditMetadata(job: TranslationJob): boolean {
    return enableMetadataEditor && job.kind === "epub-translation" && job.status === "done";
  }

  function handleOpenMetadata(job: TranslationJob) {
    if (!canEditMetadata(job)) return;
    navigate(`/metadata/jobs/${job.id}`);
  }

  async function handlePause(jobId: string) {
    try {
      await pauseTranslationJob(jobId);
      await onRefresh();
    } catch (pauseError) {
      setError(pauseError instanceof Error ? pauseError.message : "No se ha podido pausar el trabajo");
    }
  }

  async function handleResume(jobId: string) {
    try {
      await resumeTranslationJob(jobId);
      await onRefresh();
    } catch (resumeError) {
      setError(resumeError instanceof Error ? resumeError.message : "No se ha podido reanudar el trabajo");
    }
  }

  async function handleDelete(job: TranslationJob) {
    if (!window.confirm(`¿Borrar definitivamente "${job.inputFileName}"?`)) {
      return;
    }
    try {
      await deleteTranslationJob(job.id);
      await onRefresh();
    } catch (deleteError) {
      const message = deleteError instanceof Error ? deleteError.message : "No se ha podido borrar el trabajo";
      setError(message);
    }
  }

  async function handleClearCompleted() {
    if (!window.confirm("¿Borrar definitivamente todos los trabajos completados?")) {
      return;
    }

    setIsClearingCompleted(true);
    setError(null);
    try {
      await deleteCompletedTranslationJobs();
      await onRefresh();
    } catch (deleteError) {
      const message = deleteError instanceof Error
        ? deleteError.message
        : "No se han podido borrar los trabajos completados";
      setError(message);
    } finally {
      setIsClearingCompleted(false);
    }
  }

  async function handleReorder(jobId: string, position: number) {
    if (jobId === draggedJobId && position === prioritizableJobs.findIndex((job) => job.id === jobId)) {
      return;
    }

    try {
      await reorderTranslationJob(jobId, position);
      await onRefresh();
    } catch (reorderError) {
      setError(reorderError instanceof Error ? reorderError.message : "No se ha podido reordenar la cola");
    } finally {
      setDraggedJobId(null);
    }
  }

  async function handleStartQueued(jobId: string) {
    try {
      await startQueuedTranslationJob(jobId);
      await onRefresh();
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "No se ha podido iniciar el trabajo");
    }
  }

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const prioritizableJobs = jobs.filter((job) => job.status === "pending" || job.status === "paused");
  const hasCompletedJobs = jobs.some((job) => job.status === "done");

  return (
    <div className="space-y-3">
      {error ? <div className="alert alert-error"><span>{error}</span></div> : null}
      <div className="jobs-wrap">
            <table className="table jobs-table">
            <colgroup><col className="job-column--file" /><col className="job-column--progress" /><col className="job-column--status" /></colgroup>
            <thead>
              <tr>
                <th>Archivo</th>
                <th>Progreso</th>
                <th className="text-right">Estado</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length > 0 ? (
                jobs.map((job) => {
                  const isQueuedJob = job.status === "pending";
                  const isPrioritizableJob = job.status === "pending" || job.status === "paused";
                  const progressValue =
                    job.progress.total > 0
                      ? Math.round((job.progress.current / job.progress.total) * 100)
                      : job.status === "done"
                        ? 100
                        : null;
                  const displayedProgressValue =
                    job.status !== "done" && progressValue === 100 ? 99 : progressValue;
                  const elapsedTime = getElapsedTime(job, now);
                  const isActiveJob = job.status === "processing";
                  const isReadyToGenerate =
                    job.kind === "epub-translation" &&
                    job.status === "pending" &&
                    job.progress.total > 0 &&
                    job.progress.current >= job.progress.total;
                  const isMetadataEditable = canEditMetadata(job);

                  return (
                    <tr
                      key={job.id}
                      className={`${isActiveJob ? "is-active" : ""} ${isPrioritizableJob ? "cursor-grab" : isMetadataEditable ? "cursor-pointer" : ""}`}
                      tabIndex={isMetadataEditable ? 0 : undefined}
                      aria-label={isMetadataEditable ? `Editar metadatos de ${job.inputFileName}` : undefined}
                      onClick={() => handleOpenMetadata(job)}
                      onKeyDown={(event) => {
                        if (isMetadataEditable && (event.key === "Enter" || event.key === " ")) {
                          event.preventDefault();
                          handleOpenMetadata(job);
                        }
                      }}
                      draggable={isPrioritizableJob}
                      onDragStart={(event) => {
                        if (!isPrioritizableJob) return;
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", job.id);
                        setDraggedJobId(job.id);
                      }}
                      onDragEnd={() => setDraggedJobId(null)}
                      onDragOver={(event) => {
                        if (isPrioritizableJob && draggedJobId) event.preventDefault();
                      }}
                      onDrop={(event) => {
                        if (!isPrioritizableJob || !draggedJobId) return;
                        event.preventDefault();
                        const position = prioritizableJobs.findIndex((prioritizableJob) => prioritizableJob.id === job.id);
                        void handleReorder(draggedJobId, position);
                      }}
                    >
                      <td data-label="Archivo" title={job.inputFileName}>
                        <div className="job-file">
                          <span className="job-file__name">
                            {isPrioritizableJob ? <span className="mr-2 text-base-content/40" title="Arrastra para reordenar">⠿</span> : null}
                            {job.inputFileName}
                          </span>
                          {elapsedTime ? <span className="operational-meta text-base-content/60">{elapsedTime}</span> : null}
                        </div>
                      </td>
                      <td data-label="Progreso">
                        <div className="job-progress">
                          <div className="job-progress__line">
                          <progress
                            className="progress progress-primary"
                            value={displayedProgressValue ?? undefined}
                            max={100}
                          />
                          <span className="operational-meta text-base-content/70">
                            {displayedProgressValue !== null ? `${displayedProgressValue}%` : "-"}
                          </span>
                          </div>
                          {job.progress.message ? (
                            <div className="text-sm text-base-content/70">
                              {job.progress.message}
                            </div>
                          ) : null}
                        </div>
                      </td>
                      <td data-label="Estado" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                        <div className="job-status">
                          <span className="job-status__label" data-status={job.status}>{statusLabels[job.status]}</span>
                          {job.status === "processing" || job.status === "paused" || job.status === "error" ? (
                            <IconButton
                              label={job.status === "processing" ? "Pausar" : "Reanudar"}
                              className="btn btn-primary btn-square btn-sm"
                              onClick={() => void (job.status === "processing" ? handlePause(job.id) : handleResume(job.id))}
                            >
                              <ActionIcon type={job.status === "processing" ? "pause" : "resume"} />
                            </IconButton>
                          ) : null}
                          {job.status === "pending" ? (
                            <IconButton
                              label={isReadyToGenerate ? "Generar EPUB" : "Iniciar"}
                              className="btn btn-primary btn-square btn-sm"
                              onClick={() => void handleStartQueued(job.id)}
                            >
                              <ActionIcon type="resume" />
                            </IconButton>
                          ) : null}
                          {job.status === "done" && job.downloadUrl ? (
                            <a className="btn btn-success btn-square btn-sm" href={job.downloadUrl} target="folio-download" aria-label="Descargar" title="Descargar">
                              <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <ActionIcon type="download" />
                              </svg>
                            </a>
                          ) : null}
                          {job.status !== "processing" && job.status !== "pausing" ? (
                            <IconButton
                              label="Borrar"
                              className="btn btn-error btn-outline btn-square btn-sm"
                              onClick={() => void handleDelete(job)}
                            >
                              <ActionIcon type="delete" />
                            </IconButton>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={3} className="empty-table-cell">
                    La cola está vacía. Selecciona un archivo para crear el primer trabajo.
                  </td>
                </tr>
              )}
            </tbody>
        </table>
      </div>
      <div className="flex justify-end pt-1">
        <button
          type="button"
          className="btn btn-error btn-outline btn-sm"
          disabled={!hasCompletedJobs || isClearingCompleted}
          onClick={() => void handleClearCompleted()}
        >
          {isClearingCompleted ? <span className="loading loading-spinner loading-xs" /> : null}
          Borrar completados
        </button>
      </div>
    </div>
  );
}
