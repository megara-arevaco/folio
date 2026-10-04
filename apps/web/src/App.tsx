import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Navigate, NavLink, Route, Routes } from "react-router";
import { FilePicker } from "./components/FilePicker/FilePicker.component";
import { EpubTranslationStatus } from "./components/EpubTranslationStatus";
import { JobsTable } from "./components/TranslationsPage";
import { MetadataEditorPage } from "./components/MetadataEditorPage";
import { DevicePage } from "./components/DevicePage";
import { ReadingLogPage } from "./components/ReadingLogPage";
import { useEpubTranslation } from "./components/EpubTranslationStatus/useEpubTranslation";
import { usePdfConversion } from "./components/EpubTranslationStatus/usePdfConversion";
import {
  fetchTranslationJobs,
  type TranslationJob,
  type TranslationJobKind,
} from "./services/translation";

function isJobActive(job: TranslationJob): boolean {
  return job.status === "pending" || job.status === "processing" || job.status === "pausing";
}

const JOBS_UPDATED_EVENT = "epub-translator:jobs-updated";

function publishJobsUpdated(jobs: TranslationJob[]): void {
  window.dispatchEvent(new CustomEvent<TranslationJob[]>(JOBS_UPDATED_EVENT, { detail: jobs }));
}

function useConfirmBeforePageExit() {
  const hasUnfinishedJobs = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    const updateKnownJobs = (jobs: TranslationJob[]) => {
      hasUnfinishedJobs.current = jobs.some((job) => isJobActive(job) || job.status === "paused");

      if (!jobs.some(isJobActive) && timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    const checkJobs = async () => {
      try {
        const jobs = await fetchTranslationJobs();
        if (!cancelled) {
          updateKnownJobs(jobs);

          if (jobs.some(isJobActive)) {
            timer = window.setTimeout(() => {
              timer = null;
              void checkJobs();
            }, 2000);
          }
        }
      } catch {
        // A temporary API error should not introduce a misleading exit warning.
      }
    };

    const confirmExit = (event: BeforeUnloadEvent) => {
      if (!hasUnfinishedJobs.current) return;
      const message = "Algunos jobs todavía no han acabado. ¿Quieres salir igualmente?";
      event.preventDefault();
      event.returnValue = message;
      return message;
    };

    const receiveJobsUpdated = (event: Event) => {
      updateKnownJobs((event as CustomEvent<TranslationJob[]>).detail);
    };

    void checkJobs();
    window.addEventListener("beforeunload", confirmExit);
    window.addEventListener(JOBS_UPDATED_EVENT, receiveJobsUpdated);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener("beforeunload", confirmExit);
      window.removeEventListener(JOBS_UPDATED_EVENT, receiveJobsUpdated);
    };
  }, []);
}

function useJobQueue(kind: TranslationJobKind) {
  const [jobs, setJobs] = useState<TranslationJob[]>([]);

  const refresh = useCallback(async () => {
    const allJobs = await fetchTranslationJobs();
    setJobs(allJobs.filter((job) => job.kind === kind));
    publishJobsUpdated(allJobs);
  }, [kind]);

  useEffect(() => {
    let cancelled = false;

    const loadJobs = async () => {
      try {
        const allJobs = await fetchTranslationJobs();
        if (cancelled) return;

        const nextJobs = allJobs.filter((job) => job.kind === kind);
        setJobs(nextJobs);
        publishJobsUpdated(allJobs);
      } catch {
        // La pantalla de estado ya muestra los errores de red del trabajo actual.
      }
    };

    void loadJobs();
    return () => {
      cancelled = true;
    };
  }, [kind]);

  useEffect(() => {
    if (!jobs.some(isJobActive)) return;

    const pollTimer = window.setTimeout(() => {
      void refresh().catch(() => {
        // La siguiente acción del usuario volverá a consultar la cola.
      });
    }, 1500);
    return () => window.clearTimeout(pollTimer);
  }, [jobs, refresh]);

  return { jobs, refresh };
}

type ConversionSectionProps = {
  badge: string;
  title: string;
  primaryAction: string;
  file: File | null;
  inputFileName: string | null;
  progress: {
    current: number;
    total: number;
    message: string;
  } | null;
  downloadUrl: string | null;
  error: string | null;
  phase: string;
  isUploading: boolean;
  isBusy: boolean;
  onFileSelected: (file: File) => void;
  onFileCleared: () => void;
  onStart: () => Promise<boolean>;
  accept: string;
  allowedExtensions: string[];
  emptyLabel: string;
  invalidFileMessage: string;
  queueJobs: TranslationJob[];
  jobsContent?: ReactNode;
  statusMode?: "translation" | "conversion";
  showStatus?: boolean;
};

function ConversionSection({
  badge,
  title,
  primaryAction,
  file,
  inputFileName,
  progress,
  downloadUrl,
  error,
  phase,
  isUploading,
  isBusy,
  onFileSelected,
  onFileCleared,
  onStart,
  accept,
  allowedExtensions,
  emptyLabel,
  invalidFileMessage,
  queueJobs,
  jobsContent,
  statusMode = "translation",
  showStatus = true,
}: ConversionSectionProps) {
  const activeFileName = file?.name ?? inputFileName;
  const canStart = Boolean(file) && !isUploading;
  const viewStatus = (!activeFileName || phase === "pending" ? "idle" : phase) as
    | "idle"
    | "uploading"
    | "processing"
    | "paused"
    | "done"
    | "error";

  return (
    <>
      <header className="workspace-intro">
        <div>
          {badge ? <div className="badge badge-primary badge-outline">{badge}</div> : null}
          <h1 className="workspace-title">{title}</h1>
        </div>
      </header>

      <div className="conversion-layout">
        <section className="conversion-intake workbench-surface workbench-section" aria-label="Añadir archivo">
          <FilePicker
            onFileSelected={onFileSelected}
            onFileCleared={onFileCleared}
            disabled={isUploading}
            accept={accept}
            allowedExtensions={allowedExtensions}
            emptyLabel={emptyLabel}
            invalidFileMessage={invalidFileMessage}
            actions={({ clear }) => (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  void onStart().then((added) => {
                    if (added) clear();
                  });
                }}
                disabled={!canStart}
              >
                {isUploading ? "Subiendo…" : isBusy ? "Añadir a la cola" : primaryAction}
              </button>
            )}
          />

          {showStatus && !queueJobs.some(
            (job) => job.status === "pending" || job.status === "processing" || job.status === "pausing",
          ) && (
            <EpubTranslationStatus
              phase={viewStatus}
              progress={progress}
              downloadUrl={downloadUrl}
              error={error}
              mode={statusMode}
            />
          )}
        </section>

        <section className="conversion-queue workbench-surface workbench-section" aria-labelledby={`${statusMode}-queue-title`}>
          <div className="workbench-toolbar mb-4">
            <div>
              <h2 className="section-title" id={`${statusMode}-queue-title`}>
                {statusMode === "conversion" ? "Cola de conversión" : "Cola de traducción"}
              </h2>
              <p className="section-copy">
                {queueJobs.length === 0
                  ? "Los trabajos que añadas aparecerán aquí."
                  : `${queueJobs.length} ${queueJobs.length === 1 ? "trabajo" : "trabajos"} en esta cola.`}
              </p>
            </div>
          </div>
          {jobsContent}
        </section>
      </div>
    </>
  );
}

function TranslationsWorkspace() {
  const {
    activeJobId,
    file,
    inputFileName,
    progress,
    downloadUrl,
    phase,
    isUploading,
    isTranslating,
    error,
    selectFile,
    startTranslation,
    reset,
  } = useEpubTranslation();
  const epubQueue = useJobQueue("epub-translation");

  return (
    <main className="workspace-page">
      <section>
        <ConversionSection
          badge=""
          title="Traducir EPUB"
          primaryAction="Traducir EPUB"
          file={file}
          inputFileName={inputFileName}
          progress={progress}
          downloadUrl={downloadUrl}
          error={error}
          phase={phase}
          isUploading={isUploading}
          isBusy={isTranslating}
          onFileSelected={selectFile}
          onFileCleared={reset}
          onStart={async () => {
            const added = await startTranslation();
            if (added) await epubQueue.refresh();
            return added;
          }}
          accept=".epub"
          allowedExtensions={[".epub"]}
          emptyLabel="Selecciona o arrastra un archivo .epub"
          invalidFileMessage="Solo se permiten archivos .epub"
          queueJobs={epubQueue.jobs}
          jobsContent={<JobsTable jobs={epubQueue.jobs} onRefresh={epubQueue.refresh} enableMetadataEditor />}
        />
      </section>
    </main>
  );
}

function FormatWorkspace() {
  const pdfConversion = usePdfConversion();
  const pdfQueue = useJobQueue("pdf-conversion");

  return (
    <main className="workspace-page">
      <section>
        <ConversionSection
          badge=""
          title="Convertir PDF"
          primaryAction="Convertir PDF"
          file={pdfConversion.file}
          inputFileName={pdfConversion.inputFileName}
          progress={pdfConversion.progress}
          downloadUrl={pdfConversion.downloadUrl}
          error={pdfConversion.error}
          phase={pdfConversion.phase}
          isUploading={pdfConversion.isUploading}
          isBusy={pdfConversion.isConverting}
          onFileSelected={pdfConversion.selectFile}
          onFileCleared={pdfConversion.reset}
          onStart={async () => {
            const added = await pdfConversion.startConversion();
            if (added) await pdfQueue.refresh();
            return added;
          }}
          accept=".pdf"
          allowedExtensions={[".pdf"]}
          emptyLabel="Selecciona o arrastra un archivo .pdf"
          invalidFileMessage="Solo se permiten archivos .pdf"
          queueJobs={pdfQueue.jobs}
          jobsContent={<JobsTable jobs={pdfQueue.jobs} onRefresh={pdfQueue.refresh} />}
          statusMode="conversion"
          showStatus={false}
        />
      </section>
    </main>
  );
}

function NavigationIcon({ type }: { type: "translate" | "convert" | "metadata" | "device" | "reading" }) {
  const paths = {
    translate: <><path d="M5 19 19 5" /><path d="M10 5h9v9" /></>,
    convert: <><path d="M4 8h14" /><path d="m15 5 3 3-3 3" /><path d="M20 16H6" /><path d="m9 13-3 3 3 3" /></>,
    metadata: <><rect x="5" y="4" width="14" height="16" rx="2" /><path d="M8 8h8M8 12h6M8 16h4" /></>,
    device: <><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M10 18h4" /></>,
    reading: <><path d="M4 5.5A3.5 3.5 0 0 1 7.5 4H11v16H7.5A3.5 3.5 0 0 0 4 21.5z" /><path d="M20 5.5A3.5 3.5 0 0 0 16.5 4H13v16h3.5a3.5 3.5 0 0 1 3.5 1.5z" /></>,
  };

  return (
    <span className="app-nav__icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {paths[type]}
      </svg>
    </span>
  );
}

function TopNavigation() {
  const [isOpen, setIsOpen] = useState(false);

  const closeMenu = () => setIsOpen(false);

  return (
    <header className="app-header">
      <div className="app-header__inner">
        <NavLink className="app-brand" to="/translations" aria-label="Folio" onClick={closeMenu}>
          <img className="app-brand__mark" src="/icon.svg" alt="" />
          <span className="app-brand__name">Folio <strong>/ tu taller de libros</strong></span>
        </NavLink>
        <button
          type="button"
          className="app-menu-button"
          aria-label={isOpen ? "Cerrar navegación" : "Abrir navegación"}
          aria-expanded={isOpen}
          aria-controls="primary-navigation"
          onClick={() => setIsOpen((open) => !open)}
        >
          <span /><span />
        </button>
        <nav id="primary-navigation" className={`app-nav ${isOpen ? "is-open" : ""}`} aria-label="Secciones principales">
          <div className="app-nav__group">
            <NavLink to="/translations" className="app-nav__link" onClick={closeMenu}>
              <NavigationIcon type="translate" />
              Traducir EPUB
            </NavLink>
            <NavLink to="/format" className="app-nav__link" onClick={closeMenu}>
              <NavigationIcon type="convert" />
              Convertir PDF
            </NavLink>
            <NavLink to="/metadata" className="app-nav__link" onClick={closeMenu}>
              <NavigationIcon type="metadata" />
              Metadatos
            </NavLink>
            <NavLink to="/device" className="app-nav__link" onClick={closeMenu}>
              <NavigationIcon type="device" />
              Dispositivo
            </NavLink>
            <NavLink to="/reading-log" className="app-nav__link" onClick={closeMenu}>
              <NavigationIcon type="reading" />
              Lecturas
            </NavLink>
          </div>
        </nav>
      </div>
    </header>
  );
}

export function App() {
  useConfirmBeforePageExit();

  return (
    <div className="app-shell" data-theme="kinpaku">
      <TopNavigation />
      <iframe className="hidden" name="epub-translator-download" title="Descargas" />
      <Routes>
        <Route path="/translations" element={<TranslationsWorkspace />} />
        <Route path="/format" element={<FormatWorkspace />} />
        <Route path="/metadata" element={<MetadataEditorPage />} />
        <Route path="/metadata/jobs/:jobId" element={<MetadataEditorPage />} />
        <Route path="/metadata/device" element={<MetadataEditorPage />} />
        <Route path="/device" element={<DevicePage />} />
        <Route path="/reading-log" element={<ReadingLogPage />} />
        <Route path="/" element={<Navigate to="/translations" replace />} />
        <Route path="*" element={<Navigate to="/translations" replace />} />
      </Routes>
    </div>
  );
}
