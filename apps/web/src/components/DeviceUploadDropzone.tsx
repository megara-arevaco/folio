import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { uploadDeviceBook } from "../services/devices";

type QueuedFile = { id: string; file: File; error?: string };
type Transfer = { current: number; total: number; completed: number; name: string; refreshing: boolean };

function fileSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DeviceUploadDropzone({ deviceId, disabled, onBusyChange, onUploaded }: {
  deviceId: string;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onUploaded: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inFlight = useRef(false);
  const busy = disabled || transfer !== null;

  function addFiles(files: File[]) {
    if (busy || inFlight.current) return;
    const accepted = files.filter((file) => /\.(epub|azw|azw3|mobi|kfx|pdf)$/i.test(file.name));
    const rejected = files.filter((file) => !accepted.includes(file));
    setError(rejected.length ? rejected.map((file) => t("device.unsupportedFile", { name: file.name })).join("; ") : null);
    setNotice(null);
    setQueue((current) => {
      const next = [...current];
      for (const file of accepted) {
        if (!next.some((entry) => entry.file.name === file.name && entry.file.size === file.size && entry.file.lastModified === file.lastModified)) {
          next.push({ id: crypto.randomUUID(), file });
        }
      }
      return next;
    });
  }

  async function sendQueue() {
    if (queue.length === 0 || busy || inFlight.current) return;
    inFlight.current = true;
    onBusyChange(true);
    setError(null);
    setNotice(null);
    const files = [...queue];
    const failed: QueuedFile[] = [];
    let completed = 0;
    try {
      for (const [index, entry] of files.entries()) {
        setTransfer({ current: index + 1, total: files.length, completed: index, name: entry.file.name, refreshing: false });
        try {
          await uploadDeviceBook(deviceId, entry.file);
          completed++;
        } catch (uploadError) {
          failed.push({ ...entry, error: uploadError instanceof Error ? uploadError.message : t("device.unknownError") });
        }
      }
      setQueue(failed);
      setTransfer({ current: files.length, total: files.length, completed: files.length, name: "", refreshing: true });
      if (completed > 0) {
        setNotice(t("device.sent", { count: completed }));
        await onUploaded();
      }
      if (failed.length > 0) setError(t("device.queueFailed", { count: failed.length }));
    } finally {
      setTransfer(null);
      inFlight.current = false;
      onBusyChange(false);
    }
  }

  return (
    <div
      className={`device-dropzone ${dragging ? "is-dragging" : ""} ${busy ? "is-disabled" : ""}`}
      aria-busy={transfer !== null}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = busy ? "none" : "copy";
        if (!busy) setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        addFiles(Array.from(event.dataTransfer.files));
      }}
    >
      {transfer ? (
        <div className="device-transfer" role="status" aria-live="polite">
          <span className="loading loading-spinner loading-md" aria-hidden="true" />
          <div className="device-transfer__copy">
            <p className="device-dropzone__title">{transfer.refreshing ? t("device.refreshingLibrary") : t("device.transferProgress", { current: transfer.current, total: transfer.total })}</p>
            {transfer.name ? <p className="device-transfer__filename">{transfer.name}</p> : null}
            <progress className="progress progress-primary" aria-label={t("device.transferCompleted")} value={transfer.completed} max={transfer.total} />
            <p className="device-dropzone__hint">{t("device.transferProcessed", { count: transfer.completed, total: transfer.total })}</p>
          </div>
        </div>
      ) : (
        <>
          <label className="device-dropzone__picker">
            <svg aria-hidden="true" className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21V9m-5 5 5-5 5 5M5 3h14" /></svg>
            <span className="device-dropzone__copy">
              <span className="device-dropzone__title">{t("device.dropFiles")}</span>
              <span className="device-dropzone__hint">{t("device.dropFormats")}</span>
            </span>
            <input
              type="file"
              aria-label={t("device.addToQueue")}
              className="device-dropzone__input"
              multiple
              accept=".epub,.azw,.azw3,.mobi,.kfx,.pdf"
              disabled={busy}
              onChange={(event) => {
                addFiles(Array.from(event.currentTarget.files ?? []));
                event.currentTarget.value = "";
              }}
            />
          </label>
          {queue.length > 0 ? (
            <>
              <ul className="device-upload-queue" aria-label={t("device.uploadQueue")}>
                {queue.map((entry) => (
                  <li key={entry.id}>
                    <div className="device-upload-queue__file">
                      <span className="device-upload-queue__name">{entry.file.name}</span>
                      <span className="device-dropzone__hint">{fileSize(entry.file.size)}</span>
                      {entry.error ? <span className="device-upload-queue__error">{entry.error}</span> : null}
                    </div>
                    <button type="button" className="btn btn-ghost btn-square btn-sm" disabled={busy} aria-label={t("device.removeFromQueue", { name: entry.file.name })} title={t("device.removeFromQueue", { name: entry.file.name })} onClick={() => setQueue((current) => current.filter((file) => file.id !== entry.id))}>
                      <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m6 6 12 12M6 18 18 6" /></svg>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="device-upload-queue__footer">
                <span className="device-dropzone__hint">{t("device.queuedFiles", { count: queue.length })} · {fileSize(queue.reduce((total, entry) => total + entry.file.size, 0))}</span>
                <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void sendQueue()}>{t("device.sendQueue", { count: queue.length })}</button>
              </div>
            </>
          ) : null}
          {notice ? <p className="device-upload-notice" role="status">{notice}</p> : null}
          {error ? <p className="device-upload-queue__error" role="alert">{error}</p> : null}
        </>
      )}
    </div>
  );
}
