import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { fetchDeviceBook, fetchEbookDevices, replaceDeviceBook, uploadDeviceBook, type EbookDevice } from "../services/devices";
import { addReadingBook } from "../services/readingLog";
import {
  fetchEpubMetadata,
  fetchJobRevisions,
  fetchTranslationJob,
  getJobOriginalUrl,
  getJobRevisionUrl,
  getEpubCoverUrl,
  readLocalDocumentMetadata,
  renameJobEpub,
  restoreJobRevision,
  updateEpubMetadata,
  type JobRevision,
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
  const { t } = useTranslation();
  const { jobId } = useParams<{ jobId: string }>();
  const [searchParams] = useSearchParams();
  const deviceId = searchParams.get("deviceId");
  const devicePath = searchParams.get("path");
  const deviceFileName = searchParams.get("fileName");
  const isDeviceBook = Boolean(deviceId && devicePath && deviceFileName);
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [fileHandle, setFileHandle] = useState<FileSystemFileHandle | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
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
  const [jobInputFileName, setJobInputFileName] = useState("");
  const [revisions, setRevisions] = useState<JobRevision[]>([]);
  const [devices, setDevices] = useState<EbookDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [isSendingToDevice, setIsSendingToDevice] = useState(false);

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
        setJobInputFileName(job.inputFileName);
        setCoverFile(null);
        setCoverPreview(`${getEpubCoverUrl(jobId)}?v=${Date.now()}`);
        setNotice(null);
      })
      .catch((loadError) => !cancelled && setError(loadError instanceof Error ? loadError.message : t("metadata.loadingMetadataError")))
      .finally(() => !cancelled && setIsLoading(false));
    return () => { cancelled = true; };
  }, [jobId]);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    void fetchJobRevisions(jobId).then((loaded) => { if (!cancelled) setRevisions(loaded); }).catch(() => {
      if (!cancelled) setError(t("metadata.revisionError"));
    });
    void fetchEbookDevices().then((loaded) => {
      if (!cancelled) {
        setDevices(loaded);
        setSelectedDeviceId((current) => current || loaded[0]?.id || "");
      }
    }).catch(() => { if (!cancelled) setDevices([]); });
    return () => { cancelled = true; };
  }, [jobId]);

  useEffect(() => {
    if (!deviceId || !devicePath || !deviceFileName) return;
    let cancelled = false;
    setFileHandle(null);
    setIsLoading(true);
    void fetchDeviceBook(deviceId, devicePath, deviceFileName)
      .then((loadedFile) => { if (!cancelled) return loadFile(loadedFile); })
      .catch((loadError) => !cancelled && setError(loadError instanceof Error ? loadError.message : t("metadata.deviceReadError")))
      .finally(() => !cancelled && setIsLoading(false));
    return () => { cancelled = true; };
  }, [deviceId, devicePath, deviceFileName]);

  async function loadFile(selectedFile: File) {
    if (!/\.(epub|pdf)$/i.test(selectedFile.name)) {
      setError(t("metadata.onlyEpubPdf"));
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
      setError(loadError instanceof Error ? loadError.message : t("metadata.loadingMetadataError"));
    } finally {
      setIsLoading(false);
    }
  }

  async function openWritableFile() {
    const picker = (window as FilePickerWindow).showOpenFilePicker;
    try {
      if (!picker) {
        fileInput.current?.click();
        return;
      }
      const [handle] = await picker({
        multiple: false,
        excludeAcceptAllOption: true,
        types: [{
          description: t("metadata.epubPdfPicker"),
          accept: {
            "application/epub+zip": [".epub"],
            "application/pdf": [".pdf"],
          },
        }],
      });
      if (!handle) return;
      const selectedFile = await handle.getFile();
      setFileHandle(handle);
      await loadFile(selectedFile);
    } catch (pickerError) {
      if (pickerError instanceof DOMException && pickerError.name === "AbortError") return;
      setError(pickerError instanceof Error ? pickerError.message : t("file.openError"));
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
        setRevisions(await fetchJobRevisions(jobId).catch(() => revisions));
        setNotice(t("metadata.savedProcessed"));
      } else if (file) {
        const blob = await updateLocalDocumentMetadata(file, values, documentFormat === "epub" ? coverFile : null);
        const mimeType = documentFormat === "pdf" ? "application/pdf" : "application/epub+zip";
        if (isDeviceBook && deviceId && devicePath && deviceFileName) {
          await replaceDeviceBook(deviceId, devicePath, blob, deviceFileName);
          setFile(new File([blob], deviceFileName, { type: mimeType }));
          setNotice(t("metadata.savedDevice"));
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
          setNotice(t("metadata.savedOverwrite", { format: documentFormat.toUpperCase() }));
        } else {
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = file.name;
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 60_000);
          setFile(new File([blob], file.name, { type: mimeType }));
          setNotice(t("metadata.savedDownload", { format: documentFormat.toUpperCase() }));
        }
        setCoverFile(null);
      }
      setMetadata(values);
      setAuthorsText(values.authors.join("\n"));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t("metadata.saveError"));
    } finally {
      setIsSaving(false);
    }
  }

  async function addCurrentBookToReadingLog() {
    setError(null);
    try {
      await addReadingBook({
        openLibraryKey: null,
        title: metadata.title.trim() || fileName || jobId || t("metadata.processedEpub"),
        authors: authorsText.split("\n").map((author) => author.trim()).filter(Boolean),
        coverUrl: null,
        firstPublishYear: null,
        isbn: null,
        categories: [],
      });
      navigate("/reading-log");
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : t("metadata.readingError"));
    }
  }

  async function sendProcessedBookToDevice() {
    if (!jobId || !selectedDeviceId || isSendingToDevice) return;
    setIsSendingToDevice(true);
    setError(null);
    try {
      const job = await fetchTranslationJob(jobId);
      if (!job.downloadUrl) throw new Error(t("metadata.sendError"));
      const response = await fetch(job.downloadUrl);
      if (!response.ok) throw new Error(t("metadata.sendError"));
      const epub = await response.blob();
      const file = new File([epub], fileName || job.outputFileName || "book.epub", { type: "application/epub+zip" });
      await uploadDeviceBook(selectedDeviceId, file);
      navigate("/device");
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : t("metadata.sendError"));
    } finally { setIsSendingToDevice(false); }
  }

  async function restoreRevision(revisionId: string) {
    if (!jobId || !window.confirm(t("metadata.restoreConfirm"))) return;
    setError(null);
    try {
      await restoreJobRevision(jobId, revisionId);
      const [loaded, job, loadedRevisions] = await Promise.all([
        fetchEpubMetadata(jobId), fetchTranslationJob(jobId), fetchJobRevisions(jobId),
      ]);
      setMetadata(loaded);
      setAuthorsText(loaded.authors.join("\n"));
      setFileName(job.outputFileName ?? job.inputFileName);
      setJobInputFileName(job.inputFileName);
      setRevisions(loadedRevisions);
      setCoverPreview(`${getEpubCoverUrl(jobId)}?v=${Date.now()}`);
      setNotice(t("metadata.revisionRestored"));
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : t("metadata.revisionError"));
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
        <h1 className="workspace-title">{t("metadata.title")}</h1>
      </header>

      {error ? <div className="alert alert-error mb-4"><span>{error}</span></div> : null}
      {notice ? <div className="alert alert-success mb-4"><span>{notice}</span></div> : null}
      {isLoading ? <div className="skeleton-block" aria-label={t("metadata.loading")} /> : hasDocument ? (
        <form className="metadata-layout workbench-surface" onSubmit={save}>
          <aside className="metadata-rail">
            {documentFormat === "epub" ? <div className="metadata-cover">
              <div>
                <h2 className="section-title">{t("metadata.cover")}</h2>
                <p className="section-copy">{t("metadata.imageTypes")}</p>
              </div>
              <div className="metadata-cover__preview">
                {coverPreview ? <img src={coverPreview} alt={t("metadata.currentCover")} className="h-full w-full object-contain" onError={() => setCoverPreview(null)} /> : <span className="px-3 text-center text-sm text-base-content/60">{t("metadata.noCover")}</span>}
              </div>
              <label className="btn btn-outline btn-sm">
                {t("metadata.changeCover")}
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
                <h2 className="section-title">{t("metadata.pdfDocument")}</h2>
                <p className="section-copy">{t("metadata.firstPageCover")}</p>
              </div>
              <div className="metadata-cover__preview" aria-label={t("metadata.pdfFile")}>
                <div className="text-center">
                  <strong className="block text-2xl text-primary">PDF</strong>
                  <span className="operational-meta text-base-content/60">{t("metadata.documentMetadata")}</span>
                </div>
              </div>
              <p className="field-help text-center">{t("metadata.pagesNotEdited")}</p>
            </div>}
          </aside>

          <div className="metadata-form">
            <div>
              <h2 className="section-title">{t("metadata.bookRecord")}</h2>
              <p className="section-copy">{jobId ? fileName || t("metadata.processedEpub") : file?.name ?? t("metadata.selectedFile")}</p>
            </div>
            {jobId ? (
              <>
                <section className="job-provenance" aria-label={t("metadata.currentResult")}>
                  <div><strong>{t("metadata.originalSource")}</strong><span>{jobInputFileName || t("metadata.processedEpub")}</span></div>
                  <div><strong>{t("metadata.currentResult")}</strong><span>{fileName}</span></div>
                  <a className="btn btn-outline btn-sm" href={getJobOriginalUrl(jobId)} target="folio-download">{t("metadata.downloadOriginal")}</a>
                </section>
                <div className="metadata-result-actions">
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => void addCurrentBookToReadingLog()}>{t("metadata.addToReading")}</button>
                  {devices.length ? (
                    <>
                      <label className="field-label metadata-device-select"><span>{t("metadata.toDevice")}</span>
                        <select className="select select-bordered" value={selectedDeviceId} onChange={(event) => setSelectedDeviceId(event.target.value)}>
                          {devices.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}
                        </select>
                      </label>
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => void sendProcessedBookToDevice()} disabled={isSendingToDevice || !selectedDeviceId}>{isSendingToDevice ? t("device.sending") : t("metadata.send")}</button>
                    </>
                  ) : <p className="field-help">{t("metadata.noDevice")} <a href="/device">{t("nav.device")}</a></p>}
                </div>
                <section className="metadata-version-history" aria-labelledby="metadata-versions-title">
                  <h3 className="section-title" id="metadata-versions-title">{t("metadata.versionsTitle")}</h3>
                  {revisions.length ? <ul>{revisions.map((revision) => <li key={revision.id}>
                    <span>{new Date(revision.createdAt).toLocaleString()} · {revision.fileName}</span>
                    <div className="metadata-version-actions">
                      <a className="btn btn-outline btn-sm" href={getJobRevisionUrl(jobId, revision.id)} target="folio-download">{t("common.download")}</a>
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => void restoreRevision(revision.id)}>{t("metadata.restoreRevision")}</button>
                    </div>
                  </li>)}</ul> : <p className="section-copy">{t("metadata.noRevisions")}</p>}
                </section>
              </>
            ) : null}
            <label className="field-label">
              <span>{t("metadata.fileName")}</span>
              <input className="input input-bordered w-full" required readOnly={!jobId} value={fileName} onChange={(event) => { setFileName(event.target.value); markDocumentEdited(); }} placeholder={t("metadata.filePlaceholder", { format: documentFormat })} />
              <span className="field-help">{jobId ? t("metadata.extensionAdded", { format: documentFormat }) : t("metadata.originalNameReadOnly")}</span>
            </label>
            <label className="field-label"><span>{t("metadata.bookTitle")}</span><input className="input input-bordered w-full" required value={metadata.title} onChange={(event) => { setMetadata({ ...metadata, title: event.target.value }); markDocumentEdited(); }} /></label>
            <label className="field-label"><span>{t("metadata.authors")}</span><textarea className="textarea textarea-bordered min-h-24 w-full" value={authorsText} onChange={(event) => { setAuthorsText(event.target.value); markDocumentEdited(); }} /><span className="field-help">{t("metadata.oneAuthorPerLine")}</span></label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="field-label"><span>{t("metadata.language")}</span><input className="input input-bordered w-full" required={documentFormat === "epub"} placeholder="es" value={metadata.language} onChange={(event) => { setMetadata({ ...metadata, language: event.target.value }); markDocumentEdited(); }} /><span className="field-help">{documentFormat === "pdf" ? t("metadata.languagePdf") : t("metadata.languageCode")}</span></label>
              <label className="field-label"><span>{t("metadata.publisher")}</span><input className="input input-bordered w-full" value={metadata.publisher} onChange={(event) => { setMetadata({ ...metadata, publisher: event.target.value }); markDocumentEdited(); }} /></label>
            </div>
            <label className="field-label"><span>{documentFormat === "pdf" ? t("metadata.subjectDescription") : t("metadata.description")}</span><textarea className="textarea textarea-bordered min-h-32 w-full" value={metadata.description} onChange={(event) => { setMetadata({ ...metadata, description: event.target.value }); markDocumentEdited(); }} /></label>
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <button type="button" className="btn btn-ghost" onClick={cancelEditing} disabled={isSaving}>{t("common.cancel")}</button>
              <button className="btn btn-primary" type="submit" disabled={isSaving}>{isSaving ? <span className="loading loading-spinner loading-sm" /> : null}{jobId || isDeviceBook || fileHandle ? t("metadata.saveOverwrite") : t("metadata.saveDownload")}</button>
            </div>
          </div>
        </form>
      ) : (
        <section className="workbench-surface workbench-section">
          <button type="button" className="file-dropzone w-full" onClick={() => void openWritableFile()}>
            <svg aria-hidden="true" className="h-10 w-10 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M5 20h14" />
            </svg>
            <span className="file-dropzone__title">{t("metadata.selectFile")}</span>
          </button>
          <input ref={fileInput} type="file" accept=".epub,.pdf" aria-label={t("metadata.fileAria")} className="hidden" onChange={event => {
            const selected = event.target.files?.[0];
            if (selected) { setFileHandle(null); void loadFile(selected); }
            event.target.value = "";
          }} />
        </section>
      )}
    </main>
  );
}
