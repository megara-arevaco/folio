import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { deleteDeviceBook, fetchEbookDevices, type EbookDevice } from "../services/devices";

import { DeviceBooksTable } from "./DeviceBooksTable";
import { DeviceUploadDropzone } from "./DeviceUploadDropzone";

export function DevicePage() {
  const { t } = useTranslation();
  const [devices, setDevices] = useState<EbookDevice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedBooks, setSelectedBooks] = useState<Set<string>>(() => new Set());
  const [isDeletingSelected, setIsDeletingSelected] = useState(false);
  const [uploadingDeviceId, setUploadingDeviceId] = useState<string | null>(null);
  const selectionKey = (deviceId: string, path: string) => `${deviceId}\u0000${path}`;

  async function refresh() {
    setIsLoading(true);
    setError(null);
    try {
      const nextDevices = await fetchEbookDevices();
      setDevices(nextDevices);
      setSelectedBooks(new Set());
    }
    catch (loadError) {
      setDevices([]);
      setSelectedBooks(new Set());
      setError(loadError instanceof Error ? loadError.message : t("metadata.deviceListError"));
    }
    finally { setIsLoading(false); }
  }

  useEffect(() => { void refresh(); }, []);

  async function removeBook(deviceId: string, path: string, title: string) {
    if (!window.confirm(t("device.deleteConfirm", { title }))) return;
    setError(null);
    try {
      await deleteDeviceBook(deviceId, path);
      await refresh();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : t("metadata.bookDeleteError"));
    }
  }

  function toggleBooks(deviceId: string, paths: string[]) {
    setSelectedBooks((current) => {
      const next = new Set(current);
      const allSelected = paths.every((path) => current.has(selectionKey(deviceId, path)));
      for (const path of paths) {
        const key = selectionKey(deviceId, path);
        if (allSelected) next.delete(key); else next.add(key);
      }
      return next;
    });
  }

  async function removeSelectedBooks(deviceId: string) {
    const selected = devices.filter((device) => device.id === deviceId).flatMap((device) => device.books
      .filter((book) => selectedBooks.has(selectionKey(device.id, book.path)))
      .map((book) => ({ deviceId: device.id, path: book.path })));
    if (selected.length === 0 || !window.confirm(t("device.selectedDeleteConfirm", { count: selected.length }))) return;
    setIsDeletingSelected(true);
    setError(null);
    let failures = 0;
    for (const book of selected) {
      try { await deleteDeviceBook(book.deviceId, book.path); }
      catch { failures++; }
    }
    setSelectedBooks(new Set());
    await refresh();
    if (failures > 0) setError(t("device.selectedDeleteError", { count: failures }));
    setIsDeletingSelected(false);
  }

  async function refreshAfterUpload(deviceId: string) {
    try {
      const nextDevices = await fetchEbookDevices();
      if (!nextDevices.some((device) => device.id === deviceId)) {
        setError(t("device.disconnectedAfterUpload"));
        return;
      }
      setDevices(nextDevices);
      setSelectedBooks(new Set());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("metadata.deviceListError"));
    }
  }

  return (
    <main className="workspace-page">
      <header className="workspace-intro device-intro">
        <h1 className="workspace-title">{t("device.title")}</h1>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => void refresh()} disabled={isLoading || isDeletingSelected || uploadingDeviceId !== null}>
          {isLoading ? <span className="loading loading-spinner loading-xs" /> : null}{t("device.update")}
        </button>
      </header>
      <section className="device-section">
        {error ? <div className="alert alert-error" role="alert"><span>{error}</span></div> : null}
        {isLoading && devices.length === 0 ? <div className="skeleton-block" aria-label={t("device.loading")} /> : error && devices.length === 0 ? null : devices.length === 0 ? (
          <div className="workbench-surface workbench-section py-12 text-center">
            <p className="font-medium">{t("device.notFound")}</p>
            <p className="section-copy mx-auto">{t("device.connectHelp")}</p>
          </div>
        ) : devices.map((device) => (
          <section key={device.id} aria-labelledby={`device-${device.id}`}>
            <DeviceUploadDropzone
              deviceId={device.id}
              disabled={isDeletingSelected || uploadingDeviceId !== null}
              onBusyChange={(busy) => { setUploadingDeviceId(busy ? device.id : null); if (busy) setError(null); }}
              onUploaded={() => refreshAfterUpload(device.id)}
            />
            <DeviceBooksTable
              device={device}
              selectedPaths={new Set(device.books.filter((book) => selectedBooks.has(selectionKey(device.id, book.path))).map((book) => book.path))}
              busy={uploadingDeviceId !== null || isDeletingSelected}
              deleting={isDeletingSelected}
              onToggle={(paths) => toggleBooks(device.id, paths)}
              onDelete={(path, title) => void removeBook(device.id, path, title)}
              onDeleteSelected={() => void removeSelectedBooks(device.id)}
            />
          </section>
        ))}
      </section>
    </main>
  );
}
