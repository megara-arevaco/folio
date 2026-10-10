import { Fragment, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useNavigate } from "react-router";
import {
  archiveCompletedTranslationJobs,
  deleteTranslationJob,
  fetchEpubMetadata,
  setTranslationJobArchived,
  pauseTranslationJob,
  reorderTranslationJob,
  resumeTranslationJob,
  startQueuedTranslationJob,
  type TranslationJob,
} from "../services/translation";
import { addReadingBook } from "../services/readingLog";
import { GlossaryEditor } from "./GlossaryEditor";

function formatDuration(milliseconds: number, t: TFunction): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return t("queue.durationHours", { hours, minutes });
  if (minutes > 0) return t("queue.durationMinutes", { minutes, seconds });
  return t("queue.durationSeconds", { seconds });
}

function getErrorRecovery(job: TranslationJob, t: TFunction): { message: string; settings: boolean } {
  const error = (job.error ?? "").toLocaleLowerCase();
  if (/402|saldo insuficiente|insufficient balance/.test(error)) return { message: t("queue.errorBalanceHelp"), settings: false };
  if (/401|clave|api key|unauthorized/.test(error)) return { message: t("queue.errorKeyHelp"), settings: true };
  return { message: t("queue.errorResumeHelp"), settings: false };
}

function getProgressPhase(job: TranslationJob, t: TFunction): string {
  const message = job.progress.message.toLocaleLowerCase();
  if (message.includes("ocr")) return t("queue.phaseOcr");
  if (message.includes("glosario")) return t("queue.phaseGlossary");
  if (message.includes("revisando")) return t("queue.phaseReview");
  if (message.includes("generando epub") || message.includes("construyendo capítulos") || message.includes("empaquetando")) return t("queue.phasePackaging");
  if (message.includes("traduciendo") || message.includes("traducción")) return t("queue.phaseTranslation");
  if (message.includes("pdf") || message.includes("página") || message.includes("pagina")) return t("queue.phasePdf");
  if (message.includes("leyendo epub")) return t("queue.phaseExtraction");
  return t("queue.phaseProcessing");
}

function getElapsedTime(job: TranslationJob, now: number, t: TFunction): string | null {
  const activeSegment = job.startedAt ? Math.max(0, now - Date.parse(job.startedAt)) : 0;
  const elapsed = (job.elapsedMs ?? 0) + activeSegment;
  return elapsed > 0 ? formatDuration(elapsed, t) : null;
}

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
  const { t } = useTranslation();
  const statusLabels: Record<TranslationJob["status"], string> = {
    pending: t("queue.statusQueued"),
    processing: t("queue.statusProcessing"),
    pausing: t("queue.statusPausing"),
    paused: t("queue.statusPaused"),
    done: t("queue.statusDone"),
    error: t("queue.statusError"),
  };
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [isArchivingCompleted, setIsArchivingCompleted] = useState(false);
  const [openGlossaryJobId, setOpenGlossaryJobId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [draggedJobId, setDraggedJobId] = useState<string | null>(null);

  function canEditMetadata(job: TranslationJob): boolean {
    return enableMetadataEditor && job.status === "done" && Boolean(job.outputFileName);
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
      setError(pauseError instanceof Error ? pauseError.message : t("queue.pauseError"));
    }
  }

  async function handleResume(jobId: string) {
    try {
      await resumeTranslationJob(jobId);
      await onRefresh();
    } catch (resumeError) {
      setError(resumeError instanceof Error ? resumeError.message : t("queue.resumeError"));
    }
  }

  async function handleDelete(job: TranslationJob) {
    if (!window.confirm(t("queue.deleteConfirm", { name: job.inputFileName }))) {
      return;
    }
    try {
      await deleteTranslationJob(job.id);
      await onRefresh();
    } catch (deleteError) {
      const message = deleteError instanceof Error ? deleteError.message : t("queue.deleteError");
      setError(message);
    }
  }

  async function handleArchiveCompleted() {
    setIsArchivingCompleted(true);
    setError(null);
    setNotice(null);
    try {
      await archiveCompletedTranslationJobs();
      await onRefresh();
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : t("queue.archiveError"));
    } finally {
      setIsArchivingCompleted(false);
    }
  }

  async function handleRestoreArchived(jobId: string) {
    try {
      await setTranslationJobArchived(jobId, false);
      await onRefresh();
      setNotice(t("queue.archiveRestored"));
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : t("queue.archiveError"));
    }
  }

  async function handleAddToReading(job: TranslationJob) {
    try {
      const metadata = await fetchEpubMetadata(job.id);
      await addReadingBook({
        openLibraryKey: null,
        title: metadata.title || job.outputFileName || job.inputFileName,
        authors: metadata.authors,
        coverUrl: null,
        firstPublishYear: null,
        isbn: null,
        categories: [],
      });
      navigate("/reading-log");
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : t("queue.addReadingError"));
    }
  }

  async function handleMove(jobId: string, direction: -1 | 1) {
    const index = prioritizableJobs.findIndex((job) => job.id === jobId);
    const position = index + direction;
    if (index < 0 || position < 0 || position >= prioritizableJobs.length) return;
    await handleReorder(jobId, position);
  }

  async function handleReorder(jobId: string, position: number) {
    if (jobId === draggedJobId && position === prioritizableJobs.findIndex((job) => job.id === jobId)) {
      return;
    }

    try {
      await reorderTranslationJob(jobId, position);
      await onRefresh();
    } catch (reorderError) {
      setError(reorderError instanceof Error ? reorderError.message : t("queue.reorderError"));
    } finally {
      setDraggedJobId(null);
    }
  }

  async function handleStartQueued(jobId: string) {
    try {
      await startQueuedTranslationJob(jobId);
      await onRefresh();
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : t("queue.startError"));
    }
  }

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const activeJobs = jobs.filter((job) => !job.archived);
  const archivedJobs = jobs.filter((job) => job.archived);
  const prioritizableJobs = activeJobs.filter((job) => job.status === "pending" || job.status === "paused");
  const hasCompletedJobs = activeJobs.some((job) => job.status === "done");

  return (
    <div className="space-y-3">
      {error ? <div className="alert alert-error"><span>{error}</span></div> : null}
      {notice ? <div className="alert alert-success" role="status"><span>{notice}</span></div> : null}
      <div className="jobs-wrap">
            <table className="table jobs-table">
            <colgroup><col className="job-column--file" /><col className="job-column--progress" /><col className="job-column--status" /></colgroup>
            <thead>
              <tr>
                <th>{t("queue.file")}</th>
                <th>{t("queue.progress")}</th>
                <th className="text-right">{t("queue.status")}</th>
              </tr>
            </thead>
            <tbody>
              {activeJobs.length > 0 ? (
                activeJobs.map((job) => {
                  const isPrioritizableJob = job.status === "pending" || job.status === "paused";
                  const progressValue =
                    job.progress.total > 0
                      ? Math.round((job.progress.current / job.progress.total) * 100)
                      : job.status === "done"
                        ? 100
                        : null;
                  const displayedProgressValue =
                    job.status !== "done" && progressValue === 100 ? 99 : progressValue;
                  const elapsedTime = getElapsedTime(job, now, t);
                  const isActiveJob = job.status === "processing";
                  const isReadyToGenerate =
                    job.kind === "epub-translation" &&
                    job.status === "pending" &&
                    job.progress.total > 0 &&
                    job.progress.current >= job.progress.total;
                  const isMetadataEditable = canEditMetadata(job);
                  const queuePosition = prioritizableJobs.findIndex((queuedJob) => queuedJob.id === job.id);
                  const canEditGlossary = job.kind === "epub-translation" && ["pending", "paused", "error"].includes(job.status);

                  return (
                    <Fragment key={job.id}>
                    <tr
                      className={`${isActiveJob ? "is-active" : ""} ${isPrioritizableJob ? "cursor-grab" : isMetadataEditable ? "cursor-pointer" : ""}`}
                      tabIndex={isMetadataEditable ? 0 : undefined}
                      aria-label={isMetadataEditable ? t("queue.metadataFor", { name: job.inputFileName }) : undefined}
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
                      <td data-label={t("queue.file")} title={job.inputFileName}>
                        <div className="job-file">
                          <span className="job-file__name">
                            {isPrioritizableJob ? <span className="job-reorder-hint" title={t("queue.dragToReorder")}>{t("queue.reorder")}</span> : null}
                            {job.inputFileName}
                          </span>
                          {elapsedTime ? <span className="operational-meta text-base-content/60">{elapsedTime}</span> : null}
                          {job.lastProgressAt ? <span className="operational-meta text-base-content/60">{t("queue.lastProgress", { time: new Date(job.lastProgressAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) })}</span> : null}
                        </div>
                      </td>
                      <td data-label={t("queue.progress")}>
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
                            <div className="job-progress__detail">
                              <strong>{getProgressPhase(job, t)}</strong>
                              <span>{job.progress.message}</span>
                            </div>
                          ) : null}
                          {job.error ? (() => {
                            const recovery = getErrorRecovery(job, t);
                            return <div className="job-error" role="alert"><p>{job.error}</p><p>{recovery.message}{recovery.settings ? <> <a href="/settings">{t("queue.openSettings")}</a></> : null}</p></div>;
                          })() : null}
                        </div>
                      </td>
                      <td data-label={t("queue.status")} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                        <div className="job-status">
                          <span className="job-status__label" data-status={job.status}>{statusLabels[job.status]}</span>
                          {job.status === "processing" || job.status === "paused" || job.status === "error" ? (
                            <IconButton
                              label={job.status === "processing" ? t("queue.pause") : t("queue.resume")}
                              className="btn btn-primary btn-square btn-sm"
                              onClick={() => void (job.status === "processing" ? handlePause(job.id) : handleResume(job.id))}
                            >
                              <ActionIcon type={job.status === "processing" ? "pause" : "resume"} />
                            </IconButton>
                          ) : null}
                          {job.status === "pending" ? (
                            <IconButton
                              label={isReadyToGenerate ? t("queue.generate") : t("queue.start")}
                              className="btn btn-primary btn-square btn-sm"
                              onClick={() => void handleStartQueued(job.id)}
                            >
                              <ActionIcon type="resume" />
                            </IconButton>
                          ) : null}
                          {isPrioritizableJob ? (
                            <div className="job-order-controls">
                              <button type="button" className="btn btn-ghost btn-xs" aria-label={t("queue.moveUp")} title={t("queue.moveUp")} disabled={queuePosition <= 0} onClick={() => void handleMove(job.id, -1)}>{t("queue.moveUp")}</button>
                              <button type="button" className="btn btn-ghost btn-xs" aria-label={t("queue.moveDown")} title={t("queue.moveDown")} disabled={queuePosition < 0 || queuePosition >= prioritizableJobs.length - 1} onClick={() => void handleMove(job.id, 1)}>{t("queue.moveDown")}</button>
                            </div>
                          ) : null}
                          {canEditGlossary ? <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpenGlossaryJobId((current) => current === job.id ? null : job.id)}>{t("queue.glossaryEdit")}</button> : null}
                          {job.status === "done" && job.downloadUrl ? (
                            <a className="btn btn-success btn-square btn-sm" href={job.downloadUrl} target="folio-download" aria-label={t("common.download")} title={t("common.download")}>
                              <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <ActionIcon type="download" />
                              </svg>
                            </a>
                          ) : null}
                          {job.status === "done" && isMetadataEditable ? <button type="button" className="btn btn-outline btn-sm" onClick={() => handleOpenMetadata(job)}>{t("queue.metadataAction")}</button> : null}
                          {job.status === "done" ? <button type="button" className="btn btn-outline btn-sm" onClick={() => void handleAddToReading(job)}>{t("queue.addToReading")}</button> : null}
                          {job.status !== "processing" && job.status !== "pausing" ? (
                            <IconButton
                              label={t("queue.delete")}
                              className="btn btn-error btn-outline btn-square btn-sm"
                              onClick={() => void handleDelete(job)}
                            >
                              <ActionIcon type="delete" />
                            </IconButton>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                    {openGlossaryJobId === job.id ? <tr className="glossary-editor-row"><td colSpan={3}><GlossaryEditor jobId={job.id} onClose={() => setOpenGlossaryJobId(null)} /></td></tr> : null}
                    </Fragment>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={3} className="empty-table-cell">
                    {t("queue.empty")}
                  </td>
                </tr>
              )}
            </tbody>
        </table>
      </div>
      <div className="job-archive-toolbar pt-1">
        <p className="section-copy">{t("queue.archiveConfirm")}</p>
        <button
          type="button"
          className="btn btn-outline btn-sm"
          disabled={!hasCompletedJobs || isArchivingCompleted}
          onClick={() => void handleArchiveCompleted()}
          title={t("queue.archiveConfirm")}
        >
          {isArchivingCompleted ? <span className="loading loading-spinner loading-xs" /> : null}
          {t("queue.clearCompleted")}
        </button>
      </div>
      {archivedJobs.length > 0 ? (
        <details className="job-archive">
          <summary>{t("queue.archivedJobs")} · {t("queue.archivedCount", { count: archivedJobs.length })}</summary>
          <ul>
            {archivedJobs.map((job) => <li key={job.id}>
              <span>{job.outputFileName ?? job.inputFileName}</span>
              <div className="job-archive__actions">
                {job.downloadUrl ? <a className="btn btn-success btn-sm" href={job.downloadUrl} target="folio-download">{t("common.download")}</a> : null}
                <button type="button" className="btn btn-outline btn-sm" onClick={() => void handleRestoreArchived(job.id)}>{t("queue.restoreFromArchive")}</button>
                <button type="button" className="btn btn-error btn-outline btn-sm" onClick={() => void handleDelete(job)}>{t("queue.delete")}</button>
              </div>
            </li>)}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
