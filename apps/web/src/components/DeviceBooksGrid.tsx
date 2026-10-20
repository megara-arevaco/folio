import { useDocumentOffset } from "./useDocumentOffset";
import { BookVolume } from "./BookVolume";
import { useEffect, useRef, useState } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useTranslation } from "react-i18next";
import { getDeviceBookUrl, getDeviceCoverUrl, type EbookDevice } from "../services/devices";
import { DeviceActionIcon } from "./DeviceActionIcon";

type Book = EbookDevice["books"][number];
export function DeviceBooksGrid({ device, books, selectedPaths, busy, onToggle, onDelete, onEdit }: {
  device: EbookDevice; books: Book[]; selectedPaths: Set<string>; busy: boolean;
  onToggle: (paths: string[]) => void; onDelete: (path: string, title: string) => void;
  onEdit: (path: string, fileName: string) => void;
}) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(2);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setColumns(Math.max(1, Math.min(4, Math.floor(element.clientWidth / 220)))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const scrollMargin = useDocumentOffset(scrollRef);
  const previousBooks = useRef(books);
  const virtualizer = useWindowVirtualizer({ count: Math.ceil(books.length / columns), scrollMargin, estimateSize: () => 388, overscan: 1 });
  useEffect(() => {
    if (previousBooks.current !== books) {
      previousBooks.current = books;
      window.scrollTo({ top: Math.max(0, scrollMargin - 16) });
    }
    virtualizer.measure();
  }, [books, columns, virtualizer, scrollMargin]);
  return <div ref={scrollRef} className="device-shelf-scroll" role="region" tabIndex={0} aria-label={t("device.deviceFiles", { name: device.name })}>
    {!books.length ? <p className="device-no-results">{t("device.noResults")}</p> : <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
      {virtualizer.getVirtualItems().map((row) => <div key={row.key} data-index={row.index} ref={virtualizer.measureElement} className="device-shelf-row" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${row.start - scrollMargin}px)` }}>
        {books.slice(row.index * columns, (row.index + 1) * columns).map((book) => {
          const canEdit = ["EPUB", "PDF"].includes(book.format);
          const cover = getDeviceCoverUrl(device.id, book);
          return <article key={book.path} className={`device-book-card${selectedPaths.has(book.path) ? " is-selected" : ""}`}>
            <label className="device-book-card__select"><input type="checkbox" className="checkbox checkbox-sm" aria-label={t("device.selectBook", { name: book.title })} checked={selectedPaths.has(book.path)} onChange={() => onToggle([book.path])} /></label>
            <BookVolume title={book.title} authors={book.authors} coverUrl={cover} label={book.format} />
            <div className="device-book-card__details">
              <h3>{canEdit ? <button type="button" title={book.title} onClick={() => onEdit(book.path, book.fileName)}>{book.title}</button> : <span title={book.title}>{book.title}</span>}</h3>
              <p className="device-book-card__author" title={book.authors.join(", ")}>{book.authors.join(", ") || t("device.unknownAuthor")}</p>
              <div className="device-book-card__footer"><span className="device-format-tag">{book.format}</span><span className="device-book-card__size">{(book.size / 1048576).toFixed(1)} MB</span>
                <div className="device-book-card__actions">
                  {canEdit ? <button type="button" aria-label={t("device.editMetadata")} title={t("device.editMetadata")} onClick={() => onEdit(book.path, book.fileName)}><DeviceActionIcon type="edit" /></button> : null}
                  <a href={getDeviceBookUrl(device.id, book.path)} target="folio-download" aria-label={t("device.download")} title={t("device.download")}><DeviceActionIcon type="download" /></a>
                  <button type="button" disabled={busy} aria-label={t("device.delete")} title={t("device.delete")} onClick={() => onDelete(book.path, book.title)}><DeviceActionIcon type="delete" /></button>
                </div>
              </div>
            </div>
          </article>;
        })}
      </div>)}
    </div>}
  </div>;
}
