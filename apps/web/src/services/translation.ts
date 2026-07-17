export type TranslationJobStatus = "pending" | "processing" | "pausing" | "paused" | "done" | "error";
export type TranslationJobKind = "epub-translation" | "pdf-conversion";

export type TranslationJobProgress = {
  current: number;
  total: number;
  message: string;
};

export type TranslationJob = {
  id: string;
  kind: TranslationJobKind;
  status: TranslationJobStatus;
  progress: TranslationJobProgress;
  inputFileName: string;
  outputFileName: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  elapsedMs: number;
  downloadUrl?: string;
};

export type EpubMetadata = {
  title: string;
  authors: string[];
  language: string;
  publisher: string;
  description: string;
};

export type EditableDocumentFormat = "epub" | "pdf";
export type EditableDocumentMetadata = EpubMetadata & {
  format: EditableDocumentFormat;
  coverDataUrl: string | null;
};

type ApiResponse<T> = {
  ok: true;
  data: T;
};

type ApiErrorResponse = {
  ok: false;
  error: string;
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

export function getEpubCoverUrl(jobId: string): string {
  return `${API_BASE_URL}/api/jobs/${jobId}/metadata/cover`;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as ApiErrorResponse;
    return payload.error;
  } catch {
    return "No se ha podido completar la peticion";
  }
}

export async function requestEpubTranslation(file: File): Promise<{ jobId: string }> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${API_BASE_URL}/api/translate`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  const payload = (await response.json()) as ApiResponse<{ jobId: string }>;
  return payload.data;
}

export async function requestPdfConversion(file: File): Promise<{ jobId: string }> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${API_BASE_URL}/api/pdf/convert`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  const payload = (await response.json()) as ApiResponse<{ jobId: string }>;
  return payload.data;
}

export async function fetchTranslationJob(jobId: string): Promise<TranslationJob> {
  const response = await fetch(`${API_BASE_URL}/api/jobs/${jobId}`);

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  const payload = (await response.json()) as ApiResponse<Omit<TranslationJob, "downloadUrl">>;
  return {
    ...payload.data,
    downloadUrl:
      payload.data.status === "done" ? `${API_BASE_URL}/api/jobs/${jobId}/download` : undefined,
  };
}

export async function fetchTranslationJobs(): Promise<TranslationJob[]> {
  const response = await fetch(`${API_BASE_URL}/api/jobs`);

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  const payload = (await response.json()) as ApiResponse<Array<Omit<TranslationJob, "downloadUrl">>>;
  return payload.data.map((job) => ({
    ...job,
    downloadUrl: job.status === "done" ? `${API_BASE_URL}/api/jobs/${job.id}/download` : undefined,
  }));
}

export async function fetchEpubMetadata(jobId: string): Promise<EpubMetadata> {
  const response = await fetch(`${API_BASE_URL}/api/jobs/${jobId}/metadata`);
  if (!response.ok) throw new Error(await readErrorMessage(response));
  const payload = (await response.json()) as ApiResponse<EpubMetadata>;
  return payload.data;
}

export async function updateEpubMetadata(jobId: string, metadata: EpubMetadata): Promise<EpubMetadata> {
  const response = await fetch(`${API_BASE_URL}/api/jobs/${jobId}/metadata`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(metadata),
  });
  if (!response.ok) throw new Error(await readErrorMessage(response));
  const payload = (await response.json()) as ApiResponse<EpubMetadata>;
  return payload.data;
}

export async function readLocalDocumentMetadata(file: File): Promise<EditableDocumentMetadata> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch(`${API_BASE_URL}/api/files/metadata/read`, { method: "POST", body: formData });
  if (!response.ok) throw new Error(await readErrorMessage(response));
  const payload = (await response.json()) as ApiResponse<EditableDocumentMetadata>;
  return payload.data;
}

export async function updateLocalDocumentMetadata(file: File, metadata: EpubMetadata, cover?: File | null): Promise<Blob> {
  const formData = new FormData();
  formData.append("metadata", JSON.stringify(metadata));
  formData.append("file", file);
  if (cover) formData.append("cover", cover);
  const response = await fetch(`${API_BASE_URL}/api/files/metadata/update`, { method: "POST", body: formData });
  if (!response.ok) throw new Error(await readErrorMessage(response));
  return response.blob();
}

export async function openWritableLocalDocument(): Promise<{ file: File; fileId: string } | null> {
  const response = await fetch(`${API_BASE_URL}/api/files/local/open`, { method: "POST" });
  if (response.status === 204) return null;
  if (!response.ok) throw new Error(await readErrorMessage(response));
  const fileId = response.headers.get("x-local-file-id");
  const fileName = decodeURIComponent(response.headers.get("x-file-name") ?? "book.epub");
  if (!fileId) throw new Error("No se ha recibido permiso para editar el archivo");
  const type = fileName.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/epub+zip";
  return { fileId, file: new File([await response.blob()], fileName, { type }) };
}

export async function overwriteLocalDocument(fileId: string, file: Blob, fileName: string): Promise<void> {
  const body = new FormData();
  body.append("file", file, fileName);
  const response = await fetch(`${API_BASE_URL}/api/files/local/${encodeURIComponent(fileId)}`, {
    method: "PUT",
    body,
  });
  if (!response.ok) throw new Error(await readErrorMessage(response));
}

export async function updateJobEpubCover(jobId: string, cover: File): Promise<void> {
  const formData = new FormData();
  formData.append("cover", cover);
  const response = await fetch(`${API_BASE_URL}/api/jobs/${jobId}/metadata/cover`, { method: "PUT", body: formData });
  if (!response.ok) throw new Error(await readErrorMessage(response));
}

export async function renameJobEpub(jobId: string, fileName: string): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/api/jobs/${jobId}/metadata/filename`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName }),
  });
  if (!response.ok) throw new Error(await readErrorMessage(response));
  const payload = (await response.json()) as ApiResponse<{ fileName: string }>;
  return payload.data.fileName;
}

async function mutateTranslationJob(jobId: string, action: "pause" | "resume"): Promise<TranslationJob> {
  const response = await fetch(`${API_BASE_URL}/api/jobs/${jobId}/${action}`, {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  const payload = (await response.json()) as ApiResponse<Omit<TranslationJob, "downloadUrl">>;
  return {
    ...payload.data,
    downloadUrl:
      payload.data.status === "done" ? `${API_BASE_URL}/api/jobs/${jobId}/download` : undefined,
  };
}

export function pauseTranslationJob(jobId: string): Promise<TranslationJob> {
  return mutateTranslationJob(jobId, "pause");
}

export function pauseActiveTranslationJobsOnPageExit(): void {
  const url = `${API_BASE_URL}/api/jobs/pause-active`;

  if (navigator.sendBeacon?.(url, new Blob([], { type: "text/plain" }))) {
    return;
  }

  void fetch(url, { method: "POST", keepalive: true });
}

export function resumeTranslationJob(jobId: string): Promise<TranslationJob> {
  return mutateTranslationJob(jobId, "resume");
}

export async function deleteTranslationJob(jobId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/jobs/${jobId}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
}

export async function deleteCompletedTranslationJobs(): Promise<number> {
  const response = await fetch(`${API_BASE_URL}/api/jobs/completed`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  const payload = (await response.json()) as ApiResponse<{ deleted: number }>;
  return payload.data.deleted;
}

export async function reorderTranslationJob(jobId: string, position: number): Promise<TranslationJob> {
  const response = await fetch(`${API_BASE_URL}/api/jobs/${jobId}/queue`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ position }),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  const payload = (await response.json()) as ApiResponse<Omit<TranslationJob, "downloadUrl">>;
  return {
    ...payload.data,
    downloadUrl:
      payload.data.status === "done" ? `${API_BASE_URL}/api/jobs/${jobId}/download` : undefined,
  };
}

export async function startQueuedTranslationJob(jobId: string): Promise<TranslationJob> {
  const response = await fetch(`${API_BASE_URL}/api/jobs/${jobId}/start`, {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  const payload = (await response.json()) as ApiResponse<Omit<TranslationJob, "downloadUrl">>;
  return {
    ...payload.data,
    downloadUrl:
      payload.data.status === "done" ? `${API_BASE_URL}/api/jobs/${jobId}/download` : undefined,
  };
}
