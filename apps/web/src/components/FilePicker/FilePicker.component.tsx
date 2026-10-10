import { useFilePicker } from "./hook/useFilePicker";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

type FilePickerActionContext = {
  file: File | null;
  clear: () => void;
};

type FilePickerProps = {
  onFileSelected: (file: File) => void;
  onFileCleared?: () => void;
  disabled?: boolean;
  accept?: string;
  allowedExtensions?: string[];
  emptyLabel?: string;
  invalidFileMessage?: string;
  actions?: ReactNode | ((context: FilePickerActionContext) => ReactNode);
};

export function FilePicker({
  onFileSelected,
  onFileCleared,
  disabled,
  accept = ".epub",
  allowedExtensions = [".epub"],
  emptyLabel,
  invalidFileMessage,
  actions,
}: FilePickerProps) {
  const { t } = useTranslation();
  const pickerEmptyLabel = emptyLabel ?? t("queue.selectEpub");
  const pickerInvalidFileMessage = invalidFileMessage ?? t("queue.onlyEpub");
  const {
    file,
    isDragging,
    error,
    inputRef,
    disabled: isDisabled,
    handleChange,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleRemove,
  } = useFilePicker({ onFileSelected, disabled, allowedExtensions, invalidFileMessage: pickerInvalidFileMessage });

  const clearSelectedFile = () => {
    onFileCleared?.();
    handleRemove();
  };
  const renderedActions =
    typeof actions === "function" ? actions({ file, clear: clearSelectedFile }) : actions;

  return (
    <div className="file-picker">
      <div
        className={`file-dropzone ${error ? "has-error" : ""} ${isDragging ? "is-dragging" : ""} ${isDisabled ? "is-disabled" : ""}`}
        role="button"
        tabIndex={isDisabled ? -1 : 0}
        aria-disabled={isDisabled}
        onClick={() => {
          if (!isDisabled) {
            inputRef.current?.click();
          }
        }}
        onKeyDown={(event) => {
          if (!isDisabled && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={handleChange}
          disabled={isDisabled}
          className="hidden"
        />

        {file ? (
          <>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="file-dropzone__icon text-success"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
            <span className="file-dropzone__title max-w-full truncate px-4">
              {file.name}
            </span>
            <span className="file-dropzone__meta">
              {(file.size / 1024 / 1024).toFixed(1)} MB
            </span>
          </>
        ) : (
          <>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="file-dropzone__icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span className="file-dropzone__title">
              {pickerEmptyLabel}
            </span>
          </>
        )}
      </div>

      {error && <p className="text-sm text-error">{error}.</p>}

      {file || renderedActions ? (
        <div className="file-picker__actions">
          {renderedActions}
          {file ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={isDisabled}
              onClick={(e) => {
                e.stopPropagation();
                clearSelectedFile();
              }}
            >
              {t("file.remove")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
