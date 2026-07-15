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

function useConfirmBeforePageExit() {
  const hasUnfinishedJobs = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const checkJobs = async () => {
      try {
        const jobs = await fetchTranslationJobs();
        if (!cancelled) {
          hasUnfinishedJobs.current = jobs.some((job) =>
            job.status === "pending" ||
            job.status === "processing" ||
            job.status === "pausing" ||
            job.status === "paused"
          );
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

    void checkJobs();
    const timer = window.setInterval(() => void checkJobs(), 2000);
    window.addEventListener("beforeunload", confirmExit);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("beforeunload", confirmExit);
    };
  }, []);
}

function useJobQueue(kind: TranslationJobKind) {
  const [jobs, setJobs] = useState<TranslationJob[]>([]);

  const refresh = useCallback(async () => {
    const allJobs = await fetchTranslationJobs();
    setJobs(allJobs.filter((job) => job.kind === kind));
  }, [kind]);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const allJobs = await fetchTranslationJobs();
        if (cancelled) return;

        const nextJobs = allJobs.filter((job) => job.kind === kind);
        setJobs(nextJobs);
      } catch {
        // La pantalla de estado ya muestra los errores de red del trabajo actual.
      }
    };

    void poll();
    const pollTimer = window.setInterval(() => void poll(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(pollTimer);
    };
  }, [kind]);

  return { jobs, refresh };
}

type ConversionSectionProps = {
  badge: string;
  title: string;
  description: string;
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
  description,
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
        <p className="workspace-description">{description}</p>
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
          description="Convierte un EPUB en un libro listo para leer y sigue cada trabajo hasta completarlo."
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
          description="Convierte PDF en EPUB refluible y aplica OCR automáticamente cuando el documento lo necesite."
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

function TopNavigation() {
  const [isOpen, setIsOpen] = useState(false);

  const closeMenu = () => setIsOpen(false);

  return (
    <header className="app-header">
      <div className="app-header__inner">
        <NavLink className="app-brand" to="/translations" aria-label="EPUB Translator" onClick={closeMenu}>
          <span className="app-brand__mark" aria-hidden="true"><i /><i /></span>
          <span className="app-brand__name">EPUB Translator</span>
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
        <NavLink
          to="/translations"
          className="app-nav__link"
          onClick={closeMenu}
        >
          Traducciones
        </NavLink>
        <NavLink
          to="/format"
          className="app-nav__link"
          onClick={closeMenu}
        >
          Formato
        </NavLink>
        <NavLink
          to="/metadata"
          className="app-nav__link"
          onClick={closeMenu}
        >
          Metadatos
        </NavLink>
        <NavLink
          to="/device"
          className="app-nav__link"
          onClick={closeMenu}
        >
          Dispositivo
        </NavLink>
        <NavLink to="/reading-log" className="app-nav__link" onClick={closeMenu}>Lecturas</NavLink>
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
