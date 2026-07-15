import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { fetchDeviceBook } from "../services/devices";
import {
  fetchEpubMetadata,
  fetchTranslationJob,
  getEpubCoverUrl,
  readLocalEpubMetadata,
  renameJobEpub,
  updateEpubMetadata,
  updateJobEpubCover,
  updateLocalEpubMetadata,
  type EpubMetadata,
} from "../services/translation";

const EMPTY_METADATA: EpubMetadata = { title: "", authors: [], language: "", publisher: "", description: "" };

export function MetadataEditorPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const [searchParams] = useSearchParams();
  const deviceId = searchParams.get("deviceId");
  const devicePath = searchParams.get("path");
  const deviceFileName = searchParams.get("fileName");
  const isDeviceBook = Boolean(deviceId && devicePath && deviceFileName);
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [metadata, setMetadata] = useState<EpubMetadata>(EMPTY_METADATA);
  const [authorsText, setAuthorsText] = useState("");
  const [isLoading, setIsLoading] = useState(Boolean(jobId || isDeviceBook));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [download, setDownload] = useState<{ url: string; name: string } | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(jobId ? getEpubCoverUrl(jobId) : null);
  const [fileName, setFileName] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    setIsLoading(true);
    void Promise.all([fetchEpubMetadata(jobId), fetchTranslationJob(jobId)])
      .then(([loaded, job]) => {
        if (cancelled) return;
        setMetadata(loaded);
        setAuthorsText(loaded.authors.join("\n"));
        setFileName(job.outputFileName ?? job.inputFileName);
      })
      .catch((loadError) => !cancelled && setError(loadError instanceof Error ? loadError.message : "No se han podido leer los metadatos"))
      .finally(() => !cancelled && setIsLoading(false));
    return () => { cancelled = true; };
  }, [jobId]);

  useEffect(() => {
    if (!deviceId || !devicePath || !deviceFileName) return;
    let cancelled = false;
    setIsLoading(true);
    void fetchDeviceBook(deviceId, devicePath, deviceFileName)
      .then((loadedFile) => { if (!cancelled) return loadFile(loadedFile); })
      .catch((loadError) => !cancelled && setError(loadError instanceof Error ? loadError.message : "No se ha podido leer el libro del dispositivo"))
      .finally(() => !cancelled && setIsLoading(false));
    return () => { cancelled = true; };
  }, [deviceId, devicePath, deviceFileName]);

  useEffect(() => () => {
    if (download) URL.revokeObjectURL(download.url);
  }, [download]);

  async function loadFile(selectedFile: File) {
    if (!selectedFile.name.toLowerCase().endsWith(".epub")) {
      setError("Solo se permiten archivos .epub");
      return;
    }
    setFile(selectedFile);
    setFileName(selectedFile.name);
    setDownload(null);
    setError(null);
    setIsLoading(true);
    try {
      const loaded = await readLocalEpubMetadata(selectedFile);
      setMetadata(loaded);
      setAuthorsText(loaded.authors.join("\n"));
      setCoverFile(null);
      setCoverPreview(loaded.coverDataUrl);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se han podido leer los metadatos");
    } finally {
      setIsLoading(false);
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const values = { ...metadata, authors: authorsText.split("\n").map((author) => author.trim()).filter(Boolean) };
    setError(null);
    setIsSaving(true);
    try {
      if (jobId) {
        await updateEpubMetadata(jobId, values);
        if (coverFile) await updateJobEpubCover(jobId, coverFile);
        setFileName(await renameJobEpub(jobId, fileName));
      } else if (file) {
        const blob = await updateLocalEpubMetadata(file, values, coverFile);
        if (download) URL.revokeObjectURL(download.url);
        const downloadName = fileName.toLowerCase().endsWith(".epub") ? fileName : `${fileName}.epub`;
        setFileName(downloadName);
        setDownload({ url: URL.createObjectURL(blob), name: downloadName });
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se han podido guardar los metadatos");
    } finally {
      setIsSaving(false);
    }
  }

  function cancelEditing() {
    if (jobId) {
      navigate("/translations");
      return;
    }
    if (isDeviceBook) {
      navigate("/device");
      return;
    }
    if (download) URL.revokeObjectURL(download.url);
    setFile(null);
    setFileName("");
    setMetadata(EMPTY_METADATA);
    setAuthorsText("");
    setCoverFile(null);
    setCoverPreview(null);
    setDownload(null);
    setError(null);
  }

  const hasDocument = Boolean(jobId || file);
  return (
    <main className="workspace-page">
      <header className="workspace-intro">
        <h1 className="workspace-title">Metadatos</h1>
        <p className="workspace-description">Ajusta la ficha bibliográfica, la portada y el nombre final de tus EPUB.</p>
      </header>

      {error ? <div className="alert alert-error mb-4"><span>{error}</span></div> : null}
      {isLoading ? <div className="skeleton-block" aria-label="Cargando metadatos" /> : hasDocument ? (
        <form className="metadata-layout workbench-surface" onSubmit={save}>
          <aside className="metadata-rail">
            <div className="metadata-cover">
              <div>
                <h2 className="section-title">Portada</h2>
                <p className="section-copy">JPEG, PNG o WebP.</p>
              </div>
              <div className="metadata-cover__preview">
                {coverPreview ? <img src={coverPreview} alt="Portada actual" className="h-full w-full object-contain" onError={() => setCoverPreview(null)} /> : <span className="px-3 text-center text-sm text-base-content/60">Sin portada</span>}
              </div>
              <label className="btn btn-outline btn-sm">
                Cambiar portada
                <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => {
                  const selected = event.target.files?.[0];
                  if (selected) {
                    setCoverFile(selected);
                    setCoverPreview(URL.createObjectURL(selected));
                    setDownload(null);
                  }
                  event.target.value = "";
                }} />
              </label>
              {coverFile ? <p className="operational-meta truncate text-base-content/60">{coverFile.name}</p> : null}
            </div>
          </aside>

          <div className="metadata-form">
            <div>
              <h2 className="section-title">Ficha del libro</h2>
              <p className="section-copy">{file?.name ?? (jobId ? "EPUB procesado" : "Datos del archivo seleccionado")}</p>
            </div>
            <label className="field-label">
              <span>Nombre del archivo</span>
              <input className="input input-bordered w-full" required value={fileName} onChange={(event) => { setFileName(event.target.value); setDownload(null); }} placeholder="libro.epub" />
              <span className="field-help">La extensión .epub se añadirá automáticamente.</span>
            </label>
            <label className="field-label"><span>Título</span><input className="input input-bordered w-full" required value={metadata.title} onChange={(event) => setMetadata({ ...metadata, title: event.target.value })} /></label>
            <label className="field-label"><span>Autores</span><textarea className="textarea textarea-bordered min-h-24 w-full" value={authorsText} onChange={(event) => setAuthorsText(event.target.value)} /><span className="field-help">Escribe un autor por línea.</span></label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="field-label"><span>Idioma</span><input className="input input-bordered w-full" required placeholder="es" value={metadata.language} onChange={(event) => setMetadata({ ...metadata, language: event.target.value })} /></label>
              <label className="field-label"><span>Editorial</span><input className="input input-bordered w-full" value={metadata.publisher} onChange={(event) => setMetadata({ ...metadata, publisher: event.target.value })} /></label>
            </div>
            <label className="field-label"><span>Descripción</span><textarea className="textarea textarea-bordered min-h-32 w-full" value={metadata.description} onChange={(event) => setMetadata({ ...metadata, description: event.target.value })} /></label>
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <button type="button" className="btn btn-ghost" onClick={cancelEditing} disabled={isSaving}>Cancelar</button>
              {download ? <a className="btn btn-success" href={download.url} download={download.name}>Descargar EPUB editado</a> : null}
              <button className="btn btn-primary" type="submit" disabled={isSaving}>{isSaving ? <span className="loading loading-spinner loading-sm" /> : null}Guardar metadatos</button>
            </div>
          </div>
        </form>
      ) : (
        <section className="workbench-surface workbench-section">
          <div className="mb-4">
            <h2 className="section-title">Abrir un EPUB</h2>
            <p className="section-copy">El archivo se procesa localmente para que puedas revisar sus datos antes de guardar.</p>
          </div>
          <label
            className={`file-dropzone ${isDragging ? "is-dragging" : ""}`}
            onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
            onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
            onDragLeave={(event) => {
              event.preventDefault();
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragging(false);
              const selected = event.dataTransfer.files[0];
              if (selected) void loadFile(selected);
            }}
          >
            <svg aria-hidden="true" className="h-10 w-10 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M5 20h14" />
            </svg>
            <span className="file-dropzone__title">Arrastra un archivo .epub</span>
            <span className="file-dropzone__meta">o haz clic para seleccionarlo</span>
            <input type="file" accept=".epub,application/epub+zip" className="hidden" onChange={(event) => {
              const selected = event.target.files?.[0];
              if (selected) void loadFile(selected);
              event.target.value = "";
            }} />
          </label>
        </section>
      )}
    </main>
  );
}
