import { useRef, useState, type DragEvent, type ChangeEvent } from "react";

type UseFilePickerOptions = {
  onFileSelected: (file: File) => void;
  disabled?: boolean;
  allowedExtensions?: string[];
  invalidFileMessage?: string;
};

export function useFilePicker({
  onFileSelected,
  disabled = false,
  allowedExtensions = [".epub"],
  invalidFileMessage = "Solo se permiten archivos .epub",
}: UseFilePickerOptions) {
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function validateFile(f: File): boolean {
    const normalizedName = f.name.toLowerCase();
    const isAllowed = allowedExtensions.some((extension) =>
      normalizedName.endsWith(extension.toLowerCase()),
    );

    if (!isAllowed) {
      setError(invalidFileMessage);
      return false;
    }
    setError(null);
    return true;
  }

  function handleFile(f: File) {
    if (!validateFile(f)) return;
    setFile(f);
    onFileSelected(f);
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    if (!disabled) setIsDragging(true);
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    setIsDragging(false);
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    if (disabled) return;
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }

  function handleRemove() {
    setFile(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return {
    file,
    isDragging,
    error,
    inputRef,
    disabled,
    handleChange,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleRemove,
  };
}
