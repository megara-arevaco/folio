import { useDocumentOffset } from "./useDocumentOffset";
import { DeviceActionIcon } from "./DeviceActionIcon";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { DeviceBooksGrid } from "./DeviceBooksGrid";
import { getDeviceBookUrl, getDeviceCoverUrl, type EbookDevice } from "../services/devices";


function formatSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DeviceBooksTable({ device, selectedPaths, busy, deleting, onToggle, onDelete, onDeleteSelected }: {
  device: EbookDevice;
  selectedPaths: Set<string>;
  busy: boolean;
  deleting: boolean;
  onToggle: (paths: string[]) => void;
  onDelete: (path: string, title: string) => void;
  onDeleteSelected: () => void;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [view, setView] = useState<"grid" | "list">("grid");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [headerHeight, setHeaderHeight] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLTableSectionElement>(null);
  const locale = i18n.resolvedLanguage === "en" ? "en" : "es";
  const filtered = useMemo(() => {
    const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase(locale);
    const query = normalize(debouncedSearch.trim());
    return query ? device.books.filter((book) => normalize(`${book.title} ${book.fileName} ${book.authors.join(" ")}`).includes(query)) : device.books;
  }, [device.books, debouncedSearch, locale]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const offset = (currentPage - 1) * pageSize;
  const books = useMemo(() => filtered.slice(offset, offset + pageSize), [filtered, offset, pageSize]);
  const scrollMargin = useDocumentOffset(scrollRef, view === "list");
  const virtualizer = useWindowVirtualizer<HTMLTableRowElement>({
    count: books.length,
    scrollMargin,
    enabled: view === "list",
    estimateSize: () => window.innerWidth <= 760 ? 200 : 88,
    getItemKey: useCallback((index: number) => books[index].path, [books]),
    paddingStart: headerHeight,
    overscan: 3,
  });
  const rows = virtualizer.getVirtualItems();
  const topPadding = rows.length ? Math.max(0, rows[0].start - scrollMargin - headerHeight) : 0;
  const bottomPadding = rows.length ? Math.max(0, virtualizer.getTotalSize() - (rows[rows.length - 1].end - scrollMargin)) : 0;
  const pageSelected = books.length > 0 && books.every((book) => selectedPaths.has(book.path));

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 150);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const observer = new ResizeObserver(() => setHeaderHeight(header.getBoundingClientRect().height));
    observer.observe(header);
    return () => observer.disconnect();
  }, [view]);

  function changePage(next: number) {
    setPage(next);
    if (view === "list") window.scrollTo({ top: Math.max(0, scrollMargin - 16) });
  }

  function edit(path: string, fileName: string) {
    navigate(`/metadata/device?deviceId=${encodeURIComponent(device.id)}&path=${encodeURIComponent(path)}&fileName=${encodeURIComponent(fileName)}`);
  }

  return <>
    <div className="device-section__header">
      <div className="device-section__identity">
        <h2 className="section-title" id={`device-${device.id}`}>{device.name}</h2>
        <span className="badge badge-ghost">{t("device.book", { count: device.books.length })}</span>
      </div>
      <div className="device-section__tools">
        {selectedPaths.size > 0 ? <button type="button" className="btn btn-error btn-outline btn-sm" disabled={busy} onClick={onDeleteSelected}>
          {deleting ? <span className="loading loading-spinner loading-xs" /> : <DeviceActionIcon type="delete" />}{t("device.deleteSelected", { count: selectedPaths.size })}
        </button> : null}
        <label className="input input-bordered device-search">
          <svg aria-hidden="true" className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
          <input type="search" aria-label={t("device.search")} placeholder={t("device.searchPlaceholder")} value={search} onChange={(event) => { setSearch(event.target.value); changePage(1); }} />
        </label>
      </div>
    </div>
    <div className="device-library-toolbar">
      <label className="device-select-page"><input type="checkbox" className="checkbox checkbox-sm" checked={pageSelected} ref={(node) => { if (node) node.indeterminate = !pageSelected && books.some((book) => selectedPaths.has(book.path)); }} onChange={() => onToggle(books.map((book) => book.path))} />{t("device.selectPage")}</label>
      <div className="device-view-switch" role="group" aria-label={t("device.view")}>
        {(["grid", "list"] as const).map((mode) => <button type="button" key={mode} aria-pressed={view === mode} onClick={() => setView(mode)}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">{mode === "grid" ? <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></> : <path d="M8 5h13M8 12h13M8 19h13M3 5h1M3 12h1M3 19h1" />}</svg>{t(`device.${mode}View`)}</button>)}
      </div>
    </div>
    {view === "grid" ? <DeviceBooksGrid device={device} books={books} selectedPaths={selectedPaths} busy={busy} onToggle={onToggle} onDelete={onDelete} onEdit={edit} /> : <div className="device-table-wrap device-virtual-scroll" ref={scrollRef} tabIndex={0} role="region" aria-label={t("device.deviceFiles", { name: device.name })}>
      <table className="table device-table device-virtual-table" role="table" aria-rowcount={books.length + 1}>
        <colgroup><col className="w-[5%]" /><col className="w-[39%]" /><col className="w-[20%]" /><col className="w-[9%]" /><col className="w-[9%]" /><col className="w-[18%]" /></colgroup>
        <thead ref={headerRef}><tr><th><input type="checkbox" className="checkbox checkbox-sm" aria-label={t("device.selectPageTable")} checked={pageSelected} ref={(node) => { if (node) node.indeterminate = !pageSelected && books.some((book) => selectedPaths.has(book.path)); }} onChange={() => onToggle(books.map((book) => book.path))} /></th><th>{t("device.book")}</th><th>{t("device.author")}</th><th>{t("device.format")}</th><th>{t("device.size")}</th><th className="text-right">{t("device.actions")}</th></tr></thead>
        <tbody>
          {books.length === 0 ? <tr><td colSpan={6} className="device-no-results">{t("device.noResults")}</td></tr> : null}
          {topPadding > 0 ? <tr className="device-virtual-spacer" aria-hidden="true"><td colSpan={6} style={{ height: topPadding }} /></tr> : null}
          {rows.map((row) => {
            const book = books[row.index];
            const canEdit = ["EPUB", "PDF"].includes(book.format);
            const coverUrl = getDeviceCoverUrl(device.id, book);
            return <tr key={row.key} data-index={row.index} ref={virtualizer.measureElement} aria-rowindex={row.index + 2}>
              <td data-label={t("device.select")}><input type="checkbox" className="checkbox checkbox-sm" aria-label={t("device.selectBook", { name: book.title })} checked={selectedPaths.has(book.path)} onChange={() => onToggle([book.path])} /></td>
              <td data-label={t("device.book")}>
                <div className="device-book-identity">
                  <span className="device-book-cover" aria-hidden="true">
                    <svg viewBox="0 0 24 32" fill="none" stroke="currentColor" strokeWidth="1"><path d="M4 2h16v28H4zM8 9h8M8 13h6" /></svg>
                    <img key={coverUrl} src={coverUrl} alt="" width={40} height={58} loading="lazy" decoding="async" onError={(event) => { event.currentTarget.hidden = true; }} />
                  </span>
                  {canEdit ? <button type="button" className="device-book-title" title={t("device.editTitle", { title: book.title })} onClick={() => edit(book.path, book.fileName)}>{book.title}</button>
                    : <span className="device-book-title" title={t("device.editUnsupported", { title: book.title, format: book.format })}>{book.title}</span>}
                </div>
              </td>
              <td data-label={t("device.author")} className="truncate" title={book.authors.join(", ")}>{book.authors.join(", ") || "—"}</td>
              <td data-label={t("device.format")}><span className="badge badge-ghost badge-sm operational-meta">{book.format}</span></td>
              <td data-label={t("device.size")} className="operational-meta whitespace-nowrap">{formatSize(book.size)}</td>
              <td data-label={t("device.actions")}><div className="flex flex-nowrap justify-end gap-2">
                {canEdit ? <button type="button" className="btn btn-primary btn-outline btn-square btn-sm" aria-label={t("device.editMetadata")} title={t("device.editMetadata")} onClick={() => edit(book.path, book.fileName)}><DeviceActionIcon type="edit" /></button> : null}
                <a className="btn btn-success btn-square btn-sm" href={getDeviceBookUrl(device.id, book.path)} target="folio-download" aria-label={t("device.download")} title={t("device.download")}><DeviceActionIcon type="download" /></a>
                <button type="button" className="btn btn-error btn-outline btn-square btn-sm" disabled={busy} aria-label={t("device.delete")} title={t("device.delete")} onClick={() => onDelete(book.path, book.title)}><DeviceActionIcon type="delete" /></button>
              </div></td>
            </tr>;
          })}
          {bottomPadding > 0 ? <tr className="device-virtual-spacer" aria-hidden="true"><td colSpan={6} style={{ height: bottomPadding }} /></tr> : null}
        </tbody>
      </table>
    </div>}
    <nav className="device-pagination" aria-label={t("device.pagination")}>
      <span className="device-pagination__count" aria-live="polite">{t("device.showingBooks", { from: filtered.length ? offset + 1 : 0, to: Math.min(offset + pageSize, filtered.length), total: filtered.length, count: filtered.length })}</span>
      <label className="device-page-size">{t("device.perPage")}<select className="select select-sm" aria-label={t("device.perPage")} value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); changePage(1); }}>{[25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
      <div className="device-pagination__buttons">
        <button type="button" className="btn btn-outline btn-sm" disabled={currentPage === 1} onClick={() => changePage(currentPage - 1)} aria-label={t("device.previousPage")}><svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m14 6-6 6 6 6" /></svg></button>
        <span>{t("device.pageNumber", { page: currentPage, total: pageCount })}</span>
        <button type="button" className="btn btn-outline btn-sm" disabled={currentPage === pageCount} onClick={() => changePage(currentPage + 1)} aria-label={t("device.nextPage")}><svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m10 6 6 6-6 6" /></svg></button>
      </div>
    </nav>
  </>;
}
