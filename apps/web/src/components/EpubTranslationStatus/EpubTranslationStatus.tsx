import type { TranslationJobProgress, TranslationJobStatus } from "../../services/translation";
import { useTranslation } from "react-i18next";

type Props = {
  phase: TranslationJobStatus | "idle" | "uploading";
  progress: TranslationJobProgress | null;
  downloadUrl: string | null;
  error: string | null;
  mode?: "translation" | "conversion";
};

export function getProgressValue(
  phase: Props["phase"],
  progress: TranslationJobProgress | null,
): number | null {
  if (phase === "done") {
    return 100;
  }

  if (phase === "uploading") {
    return null;
  }

  if (!progress || progress.total <= 0) {
    return null;
  }

  const ratio = progress.current / progress.total;
  const rounded = Math.max(0, Math.min(100, Math.floor(ratio * 100)));

  if (
    (phase === "processing" || phase === "paused") &&
    progress.current >= progress.total
  ) {
    return 99;
  }

  return rounded;
}

function DownloadIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-5 w-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5" />
      <path d="M12 15V3" />
    </svg>
  );
}

export function EpubTranslationStatus({
  phase,
  progress,
  downloadUrl,
  error,
  mode = "translation",
}: Props) {
  const { t } = useTranslation();
  const progressValue = getProgressValue(phase, progress);
  const isConversion = mode === "conversion";

  if (phase === "idle") {
    if (!isConversion) return null;

    return (
      <div className="status-strip flex items-center gap-3 text-sm text-base-content/70">
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-base-300" />
        {t("status.selectConvert")}
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="alert alert-error">
        <span>{error ?? t("status.genericError")}</span>
      </div>
    );
  }

  if (phase === "paused") {
    return (
      <div className="status-strip border-warning/30 bg-warning/10">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-medium text-warning-content">
              {isConversion ? t("status.pausedConversion") : t("status.pausedTranslation")}
            </p>
            <p className="text-sm text-base-content/70">
              {progress?.message ?? t("status.resumeFromQueue")}
            </p>
          </div>
          <span className="text-sm font-medium text-warning">
            {progressValue !== null ? `${progressValue}%` : t("status.paused")}
          </span>
        </div>
        {progressValue !== null ? (
          <progress className="progress progress-warning w-full" value={progressValue} max={100} />
        ) : (
          <progress className="progress progress-warning w-full" />
        )}
      </div>
    );
  }

  if (phase === "done" && downloadUrl) {
    return (
      <div className="status-strip border-success/20 bg-success/10">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-success/15 text-success">
              <DownloadIcon />
            </span>
            <div>
              <p className="font-medium text-success-content">
                {isConversion ? t("status.completedConversion") : t("status.completedTranslation")}
              </p>
            </div>
          </div>
          <span className="text-sm font-medium text-success">{progressValue}%</span>
        </div>
        <progress className="progress progress-success w-full" value={100} max={100} />
        <div className="flex justify-end">
          <a className="btn btn-success" href={downloadUrl} target="folio-download">
            <DownloadIcon />
            {t("status.download")}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="status-strip">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="loading loading-spinner loading-md text-primary" />
          <div>
            <p className="font-medium">
              {phase === "uploading"
                ? isConversion ? t("status.uploadingPdf") : t("status.uploadingEpub")
                : isConversion ? t("status.convertingPdf") : t("status.translatingEpub")}
            </p>
            <p className="text-sm text-base-content/70">
              {progress?.message ?? t("status.preparing")}
            </p>
          </div>
        </div>
        <span className="operational-meta text-base-content/70">
          {progressValue !== null
            ? `${progressValue}%`
            : phase === "uploading"
              ? t("status.uploading")
              : t("status.processing")}
        </span>
      </div>
      {progressValue !== null ? (
        <progress className="progress progress-primary w-full" value={progressValue} max={100} />
      ) : (
        <progress className="progress progress-primary w-full" />
      )}
      {progress && progress.total > 0 ? (
        <div className="operational-meta text-right text-base-content/70">
          {progress.current}/{progress.total}
        </div>
      ) : null}
    </div>
  );
}
