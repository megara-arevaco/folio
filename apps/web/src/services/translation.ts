import type { PublicJob as TranslationJob, EpubMetadata, EditableDocumentMetadata } from "../../../../packages/contracts/src";
import i18n from "../i18n";
export type { JobStatus as TranslationJobStatus, JobKind as TranslationJobKind, JobProgress as TranslationJobProgress, PublicJob as TranslationJob, EpubMetadata, EditableDocumentFormat, EditableDocumentMetadata } from "../../../../packages/contracts/src";
import { API_BASE_URL, readApiData, readErrorMessage } from "./http";

export function getEpubCoverUrl(jobId: string): string {
  return `${API_BASE_URL}/api/jobs/${jobId}/metadata/cover`;
}

export type GlossaryEntry = { source: string; target: string; type?: "name" | "place" | "term" | "title" };
export type JobRevision = { id: string; createdAt: string; fileName: string };
export type ProcessingPreflight = {
  translation: { provider: "OpenRouter" | "custom"; mode: "mock" | "live"; model: string | null; keyConfigured: boolean; batchTokenEstimate: number; hardTotalTokenLimit: null };
  pdf: { provider: "local" | "OpenRouter"; mode: "local" | "live"; model: string | null; maxPages: number; maxOutputTokensPerRequest: number | null; hardTotalSpendLimit: null };
  costEstimate: null;
  costNote: string;
  aiBudget: {
    caps: { deployment: AiBudgetUsage; job: AiBudgetUsage; samples: AiBudgetUsage; sample: AiBudgetUsage; maxOutputTokensPerRequest: number };
    usage: { deployment: AiBudgetUsage; samples: AiBudgetUsage };
  };
};
export type AiBudgetUsage = { requests: number; inputTokenBound: number; outputTokens: number };
export type EpubSamplePreview = { chapter: string; chapterCount: number; textCharacters: number; sample: Array<{ source: string; result: string }>; sampleCharacters: number; mock: boolean; originalsModified: false };
export type PdfSamplePreview = {
  provider: "local" | "openrouter";
  pageCount: number | null;
  pages: Array<{ page: number; text: string; needsOcr: boolean }>;
  structure?: { bookmarkCount: number; tocInSample: boolean; warnings: Array<"no-bookmarks" | "no-index-in-sample" | "ocr-needed"> };
  originalsModified: false;
};

export async function fetchProcessingPreflight(): Promise<ProcessingPreflight> {
  return readApiData<ProcessingPreflight>(await fetch(`${API_BASE_URL}/api/preflight`, { cache: "no-store" }));
}

async function requestFilePreview<T>(path: string, file: File): Promise<T> {
  const formData = new FormData();
  formData.append("file", file);
  return readApiData<T>(await fetch(`${API_BASE_URL}${path}`, { method: "POST", body: formData }));
}

export function previewEpubTranslation(file: File): Promise<EpubSamplePreview> {
  return requestFilePreview("/api/previews/epub-translation", file);
}

export function previewPdfConversion(file: File): Promise<PdfSamplePreview> {
  return requestFilePreview("/api/previews/pdf-conversion", file);
}

export async function fetchJobGlossary(jobId: string): Promise<GlossaryEntry[]> {
  return readApiData<GlossaryEntry[]>(await fetch(`${API_BASE_URL}/api/jobs/${jobId}/glossary`, { cache: "no-store" }));
}

export async function updateJobGlossary(jobId: string, glossary: GlossaryEntry[]): Promise<GlossaryEntry[]> {
  return readApiData<GlossaryEntry[]>(await fetch(`${API_BASE_URL}/api/jobs/${jobId}/glossary`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ glossary }),
  }));
}

export async function fetchJobRevisions(jobId: string): Promise<JobRevision[]> {
  return readApiData<JobRevision[]>(await fetch(`${API_BASE_URL}/api/jobs/${jobId}/revisions`, { cache: "no-store" }));
}

export async function restoreJobRevision(jobId: string, revisionId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/jobs/${jobId}/revisions/${encodeURIComponent(revisionId)}/restore`, { method: "POST" });
  await readApiData(response);
}

export function getJobOriginalUrl(jobId: string): string {
  return `${API_BASE_URL}/api/jobs/${jobId}/original/download`;
}

export function getJobRevisionUrl(jobId: string, revisionId: string): string {
  return `${API_BASE_URL}/api/jobs/${jobId}/revisions/${encodeURIComponent(revisionId)}/download`;
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
  if (!fileId) throw new Error(i18n.t("metadata.permissionError"));
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

export async function archiveCompletedTranslationJobs(): Promise<number> {
  const response = await fetch(`${API_BASE_URL}/api/jobs/completed/archive`, { method: "POST" });
  const data = await readApiData<{ archived: number }>(response);
  return data.archived;
}

export async function setTranslationJobArchived(jobId: string, archived: boolean): Promise<TranslationJob> {
  const response = await fetch(`${API_BASE_URL}/api/jobs/${jobId}/archive`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archived }),
  });
  const data = await readApiData<Omit<TranslationJob, "downloadUrl">>(response);
  return { ...data, downloadUrl: data.status === "done" ? `${API_BASE_URL}/api/jobs/${jobId}/download` : undefined };
}

export async function deleteCompletedTranslationJobs(confirmation: "DELETE COMPLETED JOBS"): Promise<number> {
  const response = await fetch(`${API_BASE_URL}/api/jobs/completed`, {
    method: "DELETE",
    headers: { "X-Folio-Confirm": confirmation },
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
