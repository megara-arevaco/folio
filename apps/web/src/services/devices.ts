export type DeviceBook = {
  path: string;
  fileName: string;
  title: string;
  authors: string[];
  size: number;
  modifiedAt: string;
  format: string;
};

export type EbookDevice = { id: string; name: string; books: DeviceBook[] };

type ApiResponse<T> = { ok: true; data: T };
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

export async function fetchEbookDevices(): Promise<EbookDevice[]> {
  const response = await fetch(`${API_BASE_URL}/api/devices`);
  if (!response.ok) throw new Error("No se han podido consultar los dispositivos");
  return ((await response.json()) as ApiResponse<EbookDevice[]>).data;
}

export function getDeviceBookUrl(deviceId: string, path: string): string {
  return `${API_BASE_URL}/api/devices/${encodeURIComponent(deviceId)}/books/download?path=${encodeURIComponent(path)}`;
}

export async function fetchDeviceBook(deviceId: string, path: string, fileName: string): Promise<File> {
  const response = await fetch(getDeviceBookUrl(deviceId, path));
  if (!response.ok) throw new Error("No se ha podido leer el libro del dispositivo");
  const type = fileName.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/epub+zip";
  return new File([await response.blob()], fileName, { type });
}

export async function replaceDeviceBook(deviceId: string, path: string, file: Blob, fileName: string): Promise<void> {
  const body = new FormData();
  body.append("file", file, fileName);
  const response = await fetch(`${API_BASE_URL}/api/devices/${encodeURIComponent(deviceId)}/books/content?path=${encodeURIComponent(path)}`, {
    method: "PUT",
    body,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error ?? "No se ha podido sobrescribir el archivo del dispositivo");
  }
}

export async function deleteDeviceBook(deviceId: string, path: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/devices/${encodeURIComponent(deviceId)}/books?path=${encodeURIComponent(path)}`, { method: "DELETE" });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error ?? "No se ha podido borrar el libro del dispositivo");
  }
}

export async function uploadDeviceBook(deviceId: string, file: File): Promise<{ path: string; fileName: string }> {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch(`${API_BASE_URL}/api/devices/${encodeURIComponent(deviceId)}/books`, { method: "POST", body });
  const payload = await response.json().catch(() => null) as { data?: { path: string; fileName: string }; error?: string } | null;
  if (!response.ok || !payload?.data) throw new Error(payload?.error ?? "No se ha podido enviar el archivo al dispositivo");
  return payload.data;
}
