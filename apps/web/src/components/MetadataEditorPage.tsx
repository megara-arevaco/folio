import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { fetchDeviceBook, replaceDeviceBook } from "../services/devices";
import {
  fetchEpubMetadata,
  fetchTranslationJob,
  getEpubCoverUrl,
  openWritableLocalDocument,
  overwriteLocalDocument,
  readLocalDocumentMetadata,
  renameJobEpub,
  updateEpubMetadata,
  updateJobEpubCover,
  updateLocalDocumentMetadata,
  type EditableDocumentFormat,
  type EpubMetadata,
} from "../services/translation";

const EMPTY_METADATA: EpubMetadata = { title: "", authors: [], language: "", publisher: "", description: "" };

type FilePickerWindow = Window & {
  showOpenFilePicker?: (options: {
    multiple?: boolean;
    excludeAcceptAllOption?: boolean;
    types?: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<FileSystemFileHandle[]>;
};

export function MetadataEditorPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const [searchParams] = useSearchParams();
  const deviceId = searchParams.get("deviceId");
  const devicePath = searchParams.get("path");
  const deviceFileName = searchParams.get("fileName");
  const isDeviceBook = Boolean(deviceId && devicePath && deviceFileName);
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [fileHandle, setFileHandle] = useState<FileSystemFileHandle | null>(null);
  const [localFileId, setLocalFileId] = useState<string | null>(null);
  const [documentFormat, setDocumentFormat] = useState<EditableDocumentFormat>("epub");
  const [metadata, setMetadata] = useState<EpubMetadata>(EMPTY_METADATA);
  const [authorsText, setAuthorsText] = useState("");
  const [isLoading, setIsLoading] = useState(Boolean(jobId || isDeviceBook));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(jobId ? getEpubCoverUrl(jobId) : null);
  const [fileName, setFileName] = useState("");

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    setIsLoading(true);
    void Promise.all([fetchEpubMetadata(jobId), fetchTranslationJob(jobId)])
      .then(([loaded, job]) => {
        if (cancelled) return;
        setMetadata(loaded);
        setDocumentFormat("epub");
        setAuthorsText(loaded.authors.join("\n"));
        setFileName(job.outputFileName ?? job.inputFileName);
        setCoverFile(null);
        setCoverPreview(`${getEpubCoverUrl(jobId)}?v=${Date.now()}`);
        setNotice(null);
      })
      .catch((loadError) => !cancelled && setError(loadError instanceof Error ? loadError.message : "No se han podido leer los metadatos"))
      .finally(() => !cancelled && setIsLoading(false));
    return () => { cancelled = true; };
  }, [jobId]);

  useEffect(() => {
    if (!deviceId || !devicePath || !deviceFileName) return;
    let cancelled = false;
    setFileHandle(null);
    setLocalFileId(null);
    setIsLoading(true);
    void fetchDeviceBook(deviceId, devicePath, deviceFileName)
      .then((loadedFile) => { if (!cancelled) return loadFile(loadedFile); })
      .catch((loadError) => !cancelled && setError(loadError instanceof Error ? loadError.message : "No se ha podido leer el libro del dispositivo"))
      .finally(() => !cancelled && setIsLoading(false));
    return () => { cancelled = true; };
  }, [deviceId, devicePath, deviceFileName]);

  async function loadFile(selectedFile: File) {
    if (!/\.(epub|pdf)$/i.test(selectedFile.name)) {
      setError("Solo se permiten archivos EPUB o PDF");
      return;
    }
    setFile(selectedFile);
    setFileName(selectedFile.name);
    setError(null);
    setNotice(null);
    setIsLoading(true);
    try {
      const loaded = await readLocalDocumentMetadata(selectedFile);
      const { format, coverDataUrl, ...loadedMetadata } = loaded;
      setDocumentFormat(format);
      setMetadata(loadedMetadata);
      setAuthorsText(loaded.authors.join("\n"));
      setCoverFile(null);
      setCoverPreview(coverDataUrl);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se han podido leer los metadatos");
    } finally {
      setIsLoading(false);
    }
  }

  async function openWritableFile() {
    const picker = window.folio?.isDesktop ? undefined : (window as FilePickerWindow).showOpenFilePicker;
    try {
      if (!picker) {
        const selected = await openWritableLocalDocument();
        if (!selected) return;
        setFileHandle(null);
        setLocalFileId(selected.fileId);
        await loadFile(selected.file);
        return;
      }
      const [handle] = await picker({
        multiple: false,
        excludeAcceptAllOption: true,
        types: [{
          description: "Libros EPUB o PDF",
          accept: {
            "application/epub+zip": [".epub"],
            "application/pdf": [".pdf"],
          },
        }],
      });
      if (!handle) return;
      const selectedFile = await handle.getFile();
      setFileHandle(handle);
      setLocalFileId(null);
      await loadFile(selectedFile);
    } catch (pickerError) {
      if (pickerError instanceof DOMException && pickerError.name === "AbortError") return;
      setError(pickerError instanceof Error ? pickerError.message : "No se ha podido abrir el archivo");
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const values = { ...metadata, authors: authorsText.split("\n").map((author) => author.trim()).filter(Boolean) };
    setError(null);
    setNotice(null);
    setIsSaving(true);
    try {
      if (jobId) {
        await updateEpubMetadata(jobId, values);
        if (coverFile) {
          await updateJobEpubCover(jobId, coverFile);
          setCoverPreview(`${getEpubCoverUrl(jobId)}?v=${Date.now()}`);
          setCoverFile(null);
        }
        setFileName(await renameJobEpub(jobId, fileName));
        setNotice("Metadatos guardados en el EPUB procesado.");
      } else if (file) {
        const blob = await updateLocalDocumentMetadata(file, values, documentFormat === "epub" ? coverFile : null);
        const mimeType = documentFormat === "pdf" ? "application/pdf" : "application/epub+zip";
        if (isDeviceBook && deviceId && devicePath && deviceFileName) {
          await replaceDeviceBook(deviceId, devicePath, blob, deviceFileName);
          setFile(new File([blob], deviceFileName, { type: mimeType }));
          setNotice("Metadatos guardados. El archivo original del dispositivo se ha sobrescrito.");
        } else if (fileHandle) {
          const writable = await fileHandle.createWritable();
          try {
            await writable.write(blob);
            await writable.close();
          } catch (writeError) {
            await writable.abort().catch(() => undefined);
            throw writeError;
          }
          const savedFile = await fileHandle.getFile();
          setFile(savedFile);
          setFileName(savedFile.name);
          setNotice(`${documentFormat.toUpperCase()} guardado. El archivo original se ha sobrescrito.`);
        } else if (localFileId) {
          await overwriteLocalDocument(localFileId, blob, file.name);
          setFile(new File([blob], file.name, { type: mimeType }));
          setNotice(`${documentFormat.toUpperCase()} guardado. El archivo original se ha sobrescrito.`);
        } else {
          throw new Error("El archivo no se abrió con permiso de escritura");
        }
        setCoverFile(null);
      }
      setMetadata(values);
      setAuthorsText(values.authors.join("\n"));
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
    setFile(null);
    setFileHandle(null);
    setLocalFileId(null);
    setDocumentFormat("epub");
    setFileName("");
    setMetadata(EMPTY_METADATA);
    setAuthorsText("");
    setCoverFile(null);
    setCoverPreview(null);
    setError(null);
    setNotice(null);
  }

  function markDocumentEdited(): void {
    setNotice(null);
  }

  const hasDocument = Boolean(jobId || file);
  return (
    <main className="workspace-page">
      <header className="workspace-intro">
        <h1 className="workspace-title">Metadatos</h1>
      </header>

      {error ? <div className="alert alert-error mb-4"><span>{error}</span></div> : null}
      {notice ? <div className="alert alert-success mb-4"><span>{notice}</span></div> : null}
      {isLoading ? <div className="skeleton-block" aria-label="Cargando metadatos" /> : hasDocument ? (
        <form className="metadata-layout workbench-surface" onSubmit={save}>
          <aside className="metadata-rail">
            {documentFormat === "epub" ? <div className="metadata-cover">
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
                    markDocumentEdited();
                  }
                  event.target.value = "";
                }} />
              </label>
              {coverFile ? <p className="operational-meta truncate text-base-content/60">{coverFile.name}</p> : null}
            </div> : <div className="metadata-cover">
              <div>
                <h2 className="section-title">Documento PDF</h2>
                <p className="section-copy">La primera página actúa como portada.</p>
              </div>
              <div className="metadata-cover__preview" aria-label="Archivo PDF">
                <div className="text-center">
                  <strong className="block text-2xl text-primary">PDF</strong>
                  <span className="operational-meta text-base-content/60">Metadatos del documento</span>
                </div>
              </div>
              <p className="field-help text-center">Editar los metadatos no modifica el contenido de las páginas.</p>
            </div>}
          </aside>

          <div className="metadata-form">
            <div>
              <h2 className="section-title">Ficha del libro</h2>
              <p className="section-copy">{file?.name ?? (jobId ? "EPUB procesado" : "Datos del archivo seleccionado")}</p>
            </div>
            <label className="field-label">
              <span>Nombre del archivo</span>
              <input className="input input-bordered w-full" required readOnly={!jobId} value={fileName} onChange={(event) => { setFileName(event.target.value); markDocumentEdited(); }} placeholder={`libro.${documentFormat}`} />
              <span className="field-help">{jobId ? `La extensión .${documentFormat} se añadirá automáticamente.` : "El nombre se conserva para sobrescribir exactamente el mismo archivo."}</span>
            </label>
            <label className="field-label"><span>Título</span><input className="input input-bordered w-full" required value={metadata.title} onChange={(event) => { setMetadata({ ...metadata, title: event.target.value }); markDocumentEdited(); }} /></label>
            <label className="field-label"><span>Autores</span><textarea className="textarea textarea-bordered min-h-24 w-full" value={authorsText} onChange={(event) => { setAuthorsText(event.target.value); markDocumentEdited(); }} /><span className="field-help">Escribe un autor por línea.</span></label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="field-label"><span>Idioma</span><input className="input input-bordered w-full" required={documentFormat === "epub"} placeholder="es" value={metadata.language} onChange={(event) => { setMetadata({ ...metadata, language: event.target.value }); markDocumentEdited(); }} /><span className="field-help">{documentFormat === "pdf" ? "Opcional; usa una etiqueta como es o es-ES." : "Código de idioma del libro."}</span></label>
              <label className="field-label"><span>Editorial</span><input className="input input-bordered w-full" value={metadata.publisher} onChange={(event) => { setMetadata({ ...metadata, publisher: event.target.value }); markDocumentEdited(); }} /></label>
            </div>
            <label className="field-label"><span>{documentFormat === "pdf" ? "Asunto / descripción" : "Descripción"}</span><textarea className="textarea textarea-bordered min-h-32 w-full" value={metadata.description} onChange={(event) => { setMetadata({ ...metadata, description: event.target.value }); markDocumentEdited(); }} /></label>
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <button type="button" className="btn btn-ghost" onClick={cancelEditing} disabled={isSaving}>Cancelar</button>
              <button className="btn btn-primary" type="submit" disabled={isSaving}>{isSaving ? <span className="loading loading-spinner loading-sm" /> : null}Guardar y sobrescribir</button>
            </div>
          </div>
        </form>
      ) : (
        <section className="workbench-surface workbench-section">
          <div className="mb-4">
            <h2 className="section-title">Abrir un EPUB o PDF</h2>
            <p className="section-copy">El archivo se abrirá con permiso de escritura. Al guardar, se sobrescribirá el original.</p>
          </div>
          <button type="button" className="file-dropzone w-full" onClick={() => void openWritableFile()}>
            <svg aria-hidden="true" className="h-10 w-10 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M5 20h14" />
            </svg>
            <span className="file-dropzone__title">Seleccionar EPUB o PDF</span>
            <span className="file-dropzone__meta">Se solicitará permiso para sobrescribirlo al guardar</span>
          </button>
        </section>
      )}
    </main>
  );
}
