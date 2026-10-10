import type { EbookDevice } from "../../../../packages/contracts/src";
import i18n from "../i18n";
export type { DeviceBook, EbookDevice } from "../../../../packages/contracts/src";
import { API_BASE_URL, readApiData, readErrorMessage } from "./http";

export type DeviceDiagnostics = {
  bridgeConfigured: boolean;
  bridgeReachable: boolean | null;
  bridgeDeviceCount: number | null;
  localDeviceCount: number;
};

export async function fetchDeviceDiagnostics(): Promise<DeviceDiagnostics> {
  return readApiData<DeviceDiagnostics>(await fetch(`${API_BASE_URL}/api/devices/diagnostics`, { cache: "no-store" }));
}

export async function fetchEbookDevices(): Promise<EbookDevice[]> {
  const response = await fetch(`${API_BASE_URL}/api/devices`);
  if (!response.ok) throw new Error(await readErrorMessage(response, i18n.t("metadata.deviceListError")));
  return readApiData<EbookDevice[]>(response);
}

export function getDeviceBookUrl(deviceId: string, path: string): string {
  return `${API_BASE_URL}/api/devices/${encodeURIComponent(deviceId)}/books/download?path=${encodeURIComponent(path)}`;
}

export async function fetchDeviceBook(deviceId: string, path: string, fileName: string): Promise<File> {
  const response = await fetch(getDeviceBookUrl(deviceId, path));
  if (!response.ok) throw new Error(await readErrorMessage(response, i18n.t("metadata.deviceReadError")));
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
    throw new Error(await readErrorMessage(response, i18n.t("metadata.deviceOverwriteError")));
  }
}

export async function deleteDeviceBook(deviceId: string, path: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/devices/${encodeURIComponent(deviceId)}/books?path=${encodeURIComponent(path)}`, { method: "DELETE" });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, i18n.t("metadata.deviceDeleteError")));
  }
}

export async function uploadDeviceBook(deviceId: string, file: File): Promise<{ path: string; fileName: string }> {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch(`${API_BASE_URL}/api/devices/${encodeURIComponent(deviceId)}/books`, { method: "POST", body });
  if (!response.ok) throw new Error(await readErrorMessage(response, i18n.t("metadata.deviceSendError")));
  return readApiData<{ path: string; fileName: string }>(response);
}
