import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useDeleteDeviceBooksMutation,
  useDeviceDiagnosticsQuery,
  useEbookDevicesQuery,
  useUploadDeviceBooksMutation,
} from "../queries/devices.queries";
import type { DeviceBook, EbookDevice } from "../services/devices";

function selectionKey(deviceId: string, path: string): string {
  return `${deviceId}\u0000${path}`;
}

function normalizeSearch(value: string, locale: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase(locale);
}

export function useDevicePage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage === "en" ? "en" : "es";
  const devicesQuery = useEbookDevicesQuery();
  const diagnosticsQuery = useDeviceDiagnosticsQuery();
  const deleteBooksMutation = useDeleteDeviceBooksMutation();
  const uploadBooksMutation = useUploadDeviceBooksMutation();
  const devices = devicesQuery.data ?? [];
  const diagnostics = diagnosticsQuery.data ?? null;
  const [selectedBooks, setSelectedBooks] = useState<Set<string>>(() => new Set());
  const [isDeletingSelected, setIsDeletingSelected] = useState(false);
  const [uploadingDeviceId, setUploadingDeviceId] = useState<string | null>(null);
  const [isConvertingUpload, setIsConvertingUpload] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 150);
    return () => window.clearTimeout(timer);
  }, [search]);

  const normalizedSearch = normalizeSearch(debouncedSearch.trim(), locale);
  const visibleDevices: EbookDevice[] = devices
    .map((device) => ({
      ...device,
      books: normalizedSearch
        ? device.books.filter((book: DeviceBook) =>
            normalizeSearch(
              `${book.title} ${book.fileName} ${book.authors.join(" ")}`,
              locale,
            ).includes(normalizedSearch),
          )
        : device.books,
    }))
    .filter((device) => device.books.length > 0);
  const visibleBookKeys = visibleDevices.flatMap((device) =>
    device.books.map((book) => selectionKey(device.id, book.path)),
  );
  const areAllVisibleBooksSelected =
    visibleBookKeys.length > 0 &&
    visibleBookKeys.every((key) => selectedBooks.has(key));

  async function refresh() {
    setActionError(null);
    const [devicesResult] = await Promise.all([
      devicesQuery.refetch(),
      diagnosticsQuery.refetch(),
    ]);

    if (!devicesResult.isError) {
      setSelectedBooks(new Set());
    }
  }

  async function removeBook(deviceId: string, path: string, title: string) {
    if (!window.confirm(t("device.deleteConfirm", { title }))) return;
    setActionError(null);

    try {
      const failures = await deleteBooksMutation.mutateAsync([{ deviceId, path }]);
      if (failures.length > 0) {
        setActionError(failures[0] || t("metadata.bookDeleteError"));
      } else {
        setSelectedBooks(new Set());
      }
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : t("metadata.bookDeleteError"),
      );
    }
  }

  function toggleBook(deviceId: string, path: string) {
    const key = selectionKey(deviceId, path);
    setSelectedBooks((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAllBooks() {
    setSelectedBooks((current) => {
      const next = new Set(current);
      visibleBookKeys.forEach((key) =>
        areAllVisibleBooksSelected ? next.delete(key) : next.add(key),
      );
      return next;
    });
  }

  async function removeSelectedBooks() {
    const selected = devices.flatMap((device) =>
      device.books
        .filter((book) => selectedBooks.has(selectionKey(device.id, book.path)))
        .map((book) => ({ deviceId: device.id, path: book.path })),
    );
    if (
      selected.length === 0 ||
      !window.confirm(t("device.selectedDeleteConfirm", { count: selected.length }))
    ) {
      return;
    }

    setIsDeletingSelected(true);
    setActionError(null);
    try {
      const failures = await deleteBooksMutation.mutateAsync(selected);
      setSelectedBooks(new Set());
      if (failures.length > 0) {
        setActionError(t("device.selectedDeleteError", { count: failures.length }));
      }
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : t("metadata.bookDeleteError"),
      );
    } finally {
      setIsDeletingSelected(false);
    }
  }

  async function sendFiles(deviceId: string, files: File[]) {
    if (files.length === 0) return;
    setUploadingDeviceId(deviceId);
    setIsConvertingUpload(
      files.some((file) => file.name.toLowerCase().endsWith(".epub")),
    );
    setActionError(null);
    setNotice(null);

    try {
      const result = await uploadBooksMutation.mutateAsync({ deviceId, files });
      setSelectedBooks(new Set());
      if (result.uploaded > 0) {
        setNotice(t("device.sent", { count: result.uploaded }));
      }
      if (result.failures.length > 0) {
        const errors = result.failures
          .map(
            ({ fileName, message }) =>
              `${fileName}: ${message || t("device.unknownError")}`,
          )
          .join("; ");
        setActionError(t("device.sendError", { errors }));
      }
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : t("metadata.deviceSendError"),
      );
    } finally {
      setUploadingDeviceId(null);
      setIsConvertingUpload(false);
    }
  }

  const queryError =
    devicesQuery.error instanceof Error
      ? devicesQuery.error.message
      : t("metadata.deviceListError");

  return {
    devices,
    diagnostics,
    isLoading: devicesQuery.isFetching,
    error: actionError ?? (devicesQuery.isFetching ? null : devicesQuery.isError ? queryError : null),
    selectedBooks,
    isBookSelected: (deviceId: string, path: string) =>
      selectedBooks.has(selectionKey(deviceId, path)),
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
  };
}
