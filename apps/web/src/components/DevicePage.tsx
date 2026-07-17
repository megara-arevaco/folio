import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { deleteDeviceBook, fetchEbookDevices, getDeviceBookUrl, uploadDeviceBook, type EbookDevice } from "../services/devices";

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ActionIcon({ type }: { type: "edit" | "download" | "delete" | "upload" }) {
  if (type === "edit") return <><path d="m14 4 6 6" /><path d="M4 20h4l11-11a2.8 2.8 0 0 0-4-4L4 16v4z" /></>;
  if (type === "download") return <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></>;
  if (type === "upload") return <><path d="M12 21V9" /><path d="m7 14 5-5 5 5" /><path d="M5 3h14" /></>;
  return <><path d="M4 7h16" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M6 7l1 14h10l1-14" /><path d="M9 7V3h6v4" /></>;
}

function DeviceIcon({ type }: { type: "edit" | "download" | "delete" | "upload" }) {
  return <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><ActionIcon type={type} /></svg>;
}

export function DevicePage() {
  const navigate = useNavigate();
  const [devices, setDevices] = useState<EbookDevice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedBooks, setSelectedBooks] = useState<Set<string>>(() => new Set());
  const [isDeletingSelected, setIsDeletingSelected] = useState(false);
  const [uploadingDeviceId, setUploadingDeviceId] = useState<string | null>(null);
  const [isConvertingUpload, setIsConvertingUpload] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const selectionKey = (deviceId: string, path: string) => `${deviceId}\u0000${path}`;
  const normalizeSearch = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
  const normalizedSearch = normalizeSearch(debouncedSearch.trim());
  const visibleDevices = devices
    .map((device) => ({
      ...device,
      books: normalizedSearch
        ? device.books.filter((book) => normalizeSearch(`${book.title} ${book.fileName} ${book.authors.join(" ")}`).includes(normalizedSearch))
        : device.books,
    }))
    .filter((device) => device.books.length > 0);
  const visibleBookKeys = visibleDevices.flatMap((device) => device.books.map((book) => selectionKey(device.id, book.path)));

  async function refresh() {
    setIsLoading(true);
    setError(null);
    try {
      setDevices(await fetchEbookDevices());
      setSelectedBooks(new Set());
    }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "No se han podido consultar los dispositivos"); }
    finally { setIsLoading(false); }
  }

  useEffect(() => { void refresh(); }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 150);
    return () => window.clearTimeout(timer);
  }, [search]);

  async function removeBook(deviceId: string, path: string, title: string) {
    if (!window.confirm(`¿Borrar definitivamente «${title}» del dispositivo?`)) return;
    setError(null);
    try {
      await deleteDeviceBook(deviceId, path);
      await refresh();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "No se ha podido borrar el libro");
    }
  }

  function toggleBook(deviceId: string, path: string) {
    const key = selectionKey(deviceId, path);
    setSelectedBooks((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleAllBooks() {
    const allVisibleSelected = visibleBookKeys.length > 0 && visibleBookKeys.every((key) => selectedBooks.has(key));
    setSelectedBooks((current) => {
      const next = new Set(current);
      visibleBookKeys.forEach((key) => allVisibleSelected ? next.delete(key) : next.add(key));
      return next;
    });
  }

  async function removeSelectedBooks() {
    const selected = devices.flatMap((device) => device.books
      .filter((book) => selectedBooks.has(selectionKey(device.id, book.path)))
      .map((book) => ({ deviceId: device.id, path: book.path })));
    if (selected.length === 0 || !window.confirm(`¿Borrar definitivamente ${selected.length} ${selected.length === 1 ? "libro" : "libros"} del dispositivo?`)) return;
    setIsDeletingSelected(true);
    setError(null);
    let failures = 0;
    for (const book of selected) {
      try { await deleteDeviceBook(book.deviceId, book.path); }
      catch { failures++; }
    }
    setSelectedBooks(new Set());
    await refresh();
    if (failures > 0) setError(`No se han podido borrar ${failures} de los libros seleccionados.`);
    setIsDeletingSelected(false);
  }

  async function sendFiles(deviceId: string, files: File[]) {
    if (files.length === 0) return;
    setUploadingDeviceId(deviceId);
    setIsConvertingUpload(files.some((file) => file.name.toLowerCase().endsWith(".epub")));
    setError(null);
    setNotice(null);
    const failures: string[] = [];
    let uploaded = 0;
    for (const file of files) {
      try {
        await uploadDeviceBook(deviceId, file);
        uploaded++;
      } catch (uploadError) {
        failures.push(`${file.name}: ${uploadError instanceof Error ? uploadError.message : "error desconocido"}`);
      }
    }
    await refresh();
    if (uploaded > 0) setNotice(`${uploaded} ${uploaded === 1 ? "archivo enviado" : "archivos enviados"} al dispositivo.`);
    if (failures.length > 0) setError(`No se han podido enviar: ${failures.join("; ")}`);
    setUploadingDeviceId(null);
    setIsConvertingUpload(false);
  }

  return (
    <main className="workspace-page">
      <header className="workspace-intro">
        <h1 className="workspace-title">Dispositivo</h1>
      </header>
      <section className="device-section">
        <div className="workbench-toolbar workbench-surface workbench-section">
          <div>
            <h2 className="section-title">Biblioteca conectada</h2>
            <p className="section-copy">Actualiza la conexión antes de transferir o editar archivos.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {selectedBooks.size > 0 ? <button type="button" className="btn btn-error btn-outline btn-sm" onClick={() => void removeSelectedBooks()} disabled={isDeletingSelected}>
              {isDeletingSelected ? <span className="loading loading-spinner loading-xs" /> : <DeviceIcon type="delete" />}Borrar seleccionados ({selectedBooks.size})
            </button> : null}
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void refresh()} disabled={isLoading || isDeletingSelected}>
              {isLoading ? <span className="loading loading-spinner loading-xs" /> : null}Actualizar
            </button>
          </div>
        </div>

        {error ? <div className="alert alert-error"><span>{error}</span></div> : null}
        {notice ? <div className="alert alert-success"><span>{notice}</span></div> : null}
        {!isLoading && devices.length > 0 ? (
          <label className="field-label workbench-surface workbench-section">
            <span>Buscar en el dispositivo</span>
            <span className="input input-bordered flex w-full items-center gap-2">
              <svg aria-hidden="true" className="h-4 w-4 shrink-0 text-base-content/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
              <input type="search" className="grow" placeholder="Título, autor o nombre de archivo" value={search} onChange={(event) => setSearch(event.target.value)} />
            </span>
          </label>
        ) : null}
        {isLoading ? <div className="skeleton-block" aria-label="Cargando dispositivos" /> : devices.length === 0 ? (
          <div className="workbench-surface workbench-section py-12 text-center">
            <p className="font-medium">No se ha encontrado ningún e-reader con archivos EPUB.</p>
            <p className="section-copy mx-auto">Conecta y desbloquea el dispositivo, espera a que aparezca como unidad USB y pulsa «Actualizar».</p>
          </div>
        ) : visibleDevices.length === 0 ? (
          <div className="workbench-surface workbench-section py-12 text-center text-base-content/70">No hay libros que coincidan con la búsqueda. Prueba con menos palabras.</div>
        ) : visibleDevices.map((device) => (
          <section key={device.id} aria-labelledby={`device-${device.id}`}>
            <div className="device-section__header">
              <h2 className="section-title" id={`device-${device.id}`}>{device.name}</h2>
              <div className="flex items-center gap-2">
                <span className="badge badge-ghost">{device.books.length} {device.books.length === 1 ? "libro" : "libros"}</span>
                <label className={`btn btn-primary btn-sm relative overflow-hidden ${uploadingDeviceId ? "btn-disabled" : ""}`}>
                  {uploadingDeviceId === device.id ? <span className="loading loading-spinner loading-xs" /> : <DeviceIcon type="upload" />}
                  {uploadingDeviceId === device.id ? (isConvertingUpload ? "Convirtiendo y enviando…" : "Enviando…") : "Enviar archivos"}
                  <input
                    type="file"
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                    multiple
                    accept=".epub,.azw,.azw3,.mobi,.kfx,.pdf"
                    disabled={uploadingDeviceId !== null}
                    onChange={(event) => {
                      const files = Array.from(event.currentTarget.files ?? []);
                      event.currentTarget.value = "";
                      void sendFiles(device.id, files);
                    }}
                  />
                </label>
              </div>
            </div>
            <div className="device-table-wrap">
              <table className="table device-table">
                <colgroup><col className="w-[5%]" /><col className="w-[39%]" /><col className="w-[20%]" /><col className="w-[9%]" /><col className="w-[9%]" /><col className="w-[18%]" /></colgroup>
                <thead><tr><th><input type="checkbox" className="checkbox checkbox-sm" aria-label="Seleccionar todos los libros visibles" checked={visibleBookKeys.length > 0 && visibleBookKeys.every((key) => selectedBooks.has(key))} onChange={toggleAllBooks} /></th><th>Libro</th><th>Autor</th><th>Formato</th><th>Tamaño</th><th className="text-right">Acciones</th></tr></thead>
                <tbody>{device.books.map((book) => (
                  <tr key={book.path}>
                    <td data-label="Seleccionar"><input type="checkbox" className="checkbox checkbox-sm" aria-label={`Seleccionar ${book.title}`} checked={selectedBooks.has(selectionKey(device.id, book.path))} onChange={() => toggleBook(device.id, book.path)} /></td>
                    <td data-label="Libro">
                      {["EPUB", "PDF"].includes(book.format) ? (
                        <button
                          type="button"
                          className="block w-full truncate text-left font-medium text-primary hover:underline"
                          title={`${book.title} — Editar metadatos`}
                          onClick={() => navigate(`/metadata/device?deviceId=${encodeURIComponent(device.id)}&path=${encodeURIComponent(book.path)}&fileName=${encodeURIComponent(book.fileName)}`)}
                        >
                          {book.title}
                        </button>
                      ) : (
                        <div className="truncate font-medium" title={`${book.title} — Los metadatos internos ${book.format} todavía no son editables`}>{book.title}</div>
                      )}
                    </td>
                    <td data-label="Autor" className="truncate" title={book.authors.join(", ")}>{book.authors.join(", ") || "—"}</td>
                    <td data-label="Formato"><span className="badge badge-ghost badge-sm operational-meta">{book.format}</span></td>
                    <td data-label="Tamaño" className="operational-meta whitespace-nowrap">{formatSize(book.size)}</td>
                    <td data-label="Acciones"><div className="flex flex-nowrap justify-end gap-2">
                      {["EPUB", "PDF"].includes(book.format) ? <button type="button" className="btn btn-primary btn-outline btn-square btn-sm" aria-label="Editar metadatos" title="Editar metadatos" onClick={() => navigate(`/metadata/device?deviceId=${encodeURIComponent(device.id)}&path=${encodeURIComponent(book.path)}&fileName=${encodeURIComponent(book.fileName)}`)}><DeviceIcon type="edit" /></button> : null}
                      <a className="btn btn-success btn-square btn-sm" href={getDeviceBookUrl(device.id, book.path)} target="epub-translator-download" aria-label="Descargar" title="Descargar"><DeviceIcon type="download" /></a>
                      <button type="button" className="btn btn-error btn-outline btn-square btn-sm" aria-label="Borrar" title="Borrar" onClick={() => void removeBook(device.id, book.path, book.title)}><DeviceIcon type="delete" /></button>
                    </div></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </section>
        ))}
      </section>
    </main>
  );
}
