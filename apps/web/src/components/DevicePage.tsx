import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { getDeviceBookUrl } from "../services/devices";
import { useDevicePage } from "./DevicePage.hook";

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
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    devices,
    diagnostics,
    isLoading,
    error,
    selectedBooks,
    isBookSelected,
    isDeletingSelected,
    uploadingDeviceId,
    isConvertingUpload,
    notice,
    search,
    setSearch,
    visibleDevices,
    areAllVisibleBooksSelected,
    refresh,
    removeBook,
    toggleBook,
    toggleAllBooks,
    removeSelectedBooks,
    sendFiles,
  } = useDevicePage();

  return (
    <main className="workspace-page">
      <header className="workspace-intro">
        <h1 className="workspace-title">{t("device.title")}</h1>
      </header>
      <section className="device-diagnostics" aria-labelledby="device-diagnostics-title">
        <h2 className="section-title" id="device-diagnostics-title">{t("device.diagnostics")}</h2>
        <p>{!diagnostics ? t("common.loading") : !diagnostics.bridgeConfigured ? t("device.bridgeNotConfigured") : diagnostics.bridgeReachable ? t("device.bridgeConnected") : t("device.bridgeUnavailable")}</p>
        {diagnostics ? <p>{t("device.localDeviceCount", { count: diagnostics.localDeviceCount })}{diagnostics.bridgeReachable && diagnostics.bridgeDeviceCount !== null ? ` · ${t("device.bridgeDeviceCount", { count: diagnostics.bridgeDeviceCount })}` : ""}</p> : null}
        <p>{t("device.bridgeHelp")}</p>
      </section>
      <section className="device-section">
        <div className="workbench-toolbar workbench-surface workbench-section">
          <div>
            <h2 className="section-title">{t("device.connectedLibrary")}</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {selectedBooks.size > 0 ? <button type="button" className="btn btn-error btn-outline btn-sm" onClick={() => void removeSelectedBooks()} disabled={isDeletingSelected}>
              {isDeletingSelected ? <span className="loading loading-spinner loading-xs" /> : <DeviceIcon type="delete" />}{t("device.deleteSelected", { count: selectedBooks.size })}
            </button> : null}
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void refresh()} disabled={isLoading || isDeletingSelected}>
              {isLoading ? <span className="loading loading-spinner loading-xs" /> : null}{t("device.update")}
            </button>
          </div>
        </div>

        {error ? <div className="alert alert-error"><span>{error}</span></div> : null}
        {notice ? <div className="alert alert-success"><span>{notice}</span></div> : null}
        {!isLoading && devices.length > 0 ? (
          <label className="field-label workbench-surface workbench-section">
            <span>{t("device.search")}</span>
            <span className="input input-bordered flex w-full items-center gap-2">
              <svg aria-hidden="true" className="h-4 w-4 shrink-0 text-base-content/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
              <input type="search" className="grow" placeholder={t("device.searchPlaceholder")} value={search} onChange={(event) => setSearch(event.target.value)} />
            </span>
          </label>
        ) : null}
        {isLoading ? <div className="skeleton-block" aria-label={t("device.loading")} /> : devices.length === 0 ? (
          <div className="workbench-surface workbench-section py-12 text-center">
            <p className="font-medium">{t("device.notFound")}</p>
            <p className="section-copy mx-auto">{t("device.connectHelp")}</p>
          </div>
        ) : visibleDevices.length === 0 ? (
          <div className="workbench-surface workbench-section py-12 text-center text-base-content/70">{t("device.noResults")}</div>
        ) : visibleDevices.map((device) => (
          <section key={device.id} aria-labelledby={`device-${device.id}`}>
            <div className="device-section__header">
              <h2 className="section-title" id={`device-${device.id}`}>{device.name}</h2>
              <div className="flex items-center gap-2">
                <span className="badge badge-ghost">{t("device.book", { count: device.books.length })}</span>
                <label className={`btn btn-primary btn-sm relative overflow-hidden ${uploadingDeviceId ? "btn-disabled" : ""}`}>
                  {uploadingDeviceId === device.id ? <span className="loading loading-spinner loading-xs" /> : <DeviceIcon type="upload" />}
                  {uploadingDeviceId === device.id ? (isConvertingUpload ? t("device.sendingConversion") : t("device.sending")) : t("device.sendFiles")}
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
                <thead><tr><th><input type="checkbox" className="checkbox checkbox-sm" aria-label={t("device.selectAll")} checked={areAllVisibleBooksSelected} onChange={toggleAllBooks} /></th><th>{t("device.book")}</th><th>{t("device.author")}</th><th>{t("device.format")}</th><th>{t("device.size")}</th><th className="text-right">{t("device.actions")}</th></tr></thead>
                <tbody>{device.books.map((book) => (
                  <tr key={book.path}>
                    <td data-label={t("device.select")}><input type="checkbox" className="checkbox checkbox-sm" aria-label={t("device.selectBook", { name: book.title })} checked={isBookSelected(device.id, book.path)} onChange={() => toggleBook(device.id, book.path)} /></td>
                    <td data-label={t("device.book")}>
                      {["EPUB", "PDF"].includes(book.format) ? (
                        <button
                          type="button"
                          className="block w-full truncate text-left font-medium text-primary hover:underline"
                          title={t("device.editTitle", { title: book.title })}
                          onClick={() => navigate(`/metadata/device?deviceId=${encodeURIComponent(device.id)}&path=${encodeURIComponent(book.path)}&fileName=${encodeURIComponent(book.fileName)}`)}
                        >
                          {book.title}
                        </button>
                      ) : (
                        <div className="truncate font-medium" title={t("device.editUnsupported", { title: book.title, format: book.format })}>{book.title}</div>
                      )}
                    </td>
                    <td data-label={t("device.author")} className="truncate" title={book.authors.join(", ")}>{book.authors.join(", ") || "—"}</td>
                    <td data-label={t("device.format")}><span className="badge badge-ghost badge-sm operational-meta">{book.format}</span></td>
                    <td data-label={t("device.size")} className="operational-meta whitespace-nowrap">{formatSize(book.size)}</td>
                    <td data-label={t("device.actions")}><div className="flex flex-nowrap justify-end gap-2">
                      {["EPUB", "PDF"].includes(book.format) ? <button type="button" className="btn btn-primary btn-outline btn-square btn-sm" aria-label={t("device.editMetadata")} title={t("device.editMetadata")} onClick={() => navigate(`/metadata/device?deviceId=${encodeURIComponent(device.id)}&path=${encodeURIComponent(book.path)}&fileName=${encodeURIComponent(book.fileName)}`)}><DeviceIcon type="edit" /></button> : null}
                      <a className="btn btn-success btn-square btn-sm" href={getDeviceBookUrl(device.id, book.path)} target="folio-download" aria-label={t("device.download")} title={t("device.download")}><DeviceIcon type="download" /></a>
                      <button type="button" className="btn btn-error btn-outline btn-square btn-sm" aria-label={t("device.delete")} title={t("device.delete")} onClick={() => void removeBook(device.id, book.path, book.title)}><DeviceIcon type="delete" /></button>
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
