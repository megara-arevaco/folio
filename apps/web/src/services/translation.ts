import type { PublicJob as TranslationJob, EpubMetadata, EditableDocumentMetadata } from "../../../../packages/contracts/src";
export type { JobStatus as TranslationJobStatus, JobKind as TranslationJobKind, JobProgress as TranslationJobProgress, PublicJob as TranslationJob, EpubMetadata, EditableDocumentFormat, EditableDocumentMetadata } from "../../../../packages/contracts/src";
import { API_BASE_URL, readApiData, readErrorMessage } from "./http";

export function getEpubCoverUrl(jobId: string): string {
  return `${API_BASE_URL}/api/jobs/${jobId}/metadata/cover`;
}

export async function requestEpubTranslation(file: File): Promise<{ jobId: string }> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${API_BASE_URL}/api/translate`, {
    method: "POST",
    body: formData,
  });

  return readApiData<{ jobId: string }>(response);
}

export async function requestPdfConversion(file: File): Promise<{ jobId: string }> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${API_BASE_URL}/api/pdf/convert`, {
    method: "POST",
    body: formData,
  });

  return readApiData<{ jobId: string }>(response);
}

export async function fetchTranslationJob(jobId: string): Promise<TranslationJob> {
  const response = await fetch(`${API_BASE_URL}/api/jobs/${jobId}`);

  const data = await readApiData<Omit<TranslationJob, "downloadUrl">>(response);
  return {
    ...data,
    downloadUrl:
      data.status === "done" ? `${API_BASE_URL}/api/jobs/${jobId}/download` : undefined,
  };
}

export async function fetchTranslationJobs(): Promise<TranslationJob[]> {
  const response = await fetch(`${API_BASE_URL}/api/jobs`);

  const data = await readApiData<Array<Omit<TranslationJob, "downloadUrl">>>(response);
  return data.map((job) => ({
    ...job,
    downloadUrl: job.status === "done" ? `${API_BASE_URL}/api/jobs/${job.id}/download` : undefined,
  }));
}

export async function fetchEpubMetadata(jobId: string): Promise<EpubMetadata> {
  const response = await fetch(`${API_BASE_URL}/api/jobs/${jobId}/metadata`);
  return readApiData<EpubMetadata>(response);
}

export async function updateEpubMetadata(jobId: string, metadata: EpubMetadata): Promise<EpubMetadata> {
  const response = await fetch(`${API_BASE_URL}/api/jobs/${jobId}/metadata`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(metadata),
  });
  return readApiData<EpubMetadata>(response);
}

export async function readLocalDocumentMetadata(file: File): Promise<EditableDocumentMetadata> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch(`${API_BASE_URL}/api/files/metadata/read`, { method: "POST", body: formData });
  return readApiData<EditableDocumentMetadata>(response);
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
  const data = await readApiData<{ fileName: string }>(response);
  return data.fileName;
}

async function mutateTranslationJob(jobId: string, action: "pause" | "resume"): Promise<TranslationJob> {
  const response = await fetch(`${API_BASE_URL}/api/jobs/${jobId}/${action}`, {
    method: "POST",
  });

  const data = await readApiData<Omit<TranslationJob, "downloadUrl">>(response);
  return {
    ...data,
    downloadUrl:
      data.status === "done" ? `${API_BASE_URL}/api/jobs/${jobId}/download` : undefined,
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
  const data = await readApiData<{ deleted: number }>(response);
  return data.deleted;
}

export async function reorderTranslationJob(jobId: string, position: number): Promise<TranslationJob> {
  const response = await fetch(`${API_BASE_URL}/api/jobs/${jobId}/queue`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ position }),
  });

  const data = await readApiData<Omit<TranslationJob, "downloadUrl">>(response);
  return {
    ...data,
    downloadUrl:
      data.status === "done" ? `${API_BASE_URL}/api/jobs/${jobId}/download` : undefined,
  };
}

export async function startQueuedTranslationJob(jobId: string): Promise<TranslationJob> {
  const response = await fetch(`${API_BASE_URL}/api/jobs/${jobId}/start`, {
    method: "POST",
  });
  const data = await readApiData<Omit<TranslationJob, "downloadUrl">>(response);
  return {
    ...data,
    downloadUrl:
      data.status === "done" ? `${API_BASE_URL}/api/jobs/${jobId}/download` : undefined,
  };
}
