import type { ApiResponse } from "../../../../packages/contracts/src";
import i18n from "../i18n";

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? window.location.origin;

export async function readErrorMessage(
  response: Response,
  fallback = i18n.t("common.requestError"),
): Promise<string> {
  try {
    const payload: unknown = await response.json();
    if (payload && typeof payload === "object" && "error" in payload &&
      typeof payload.error === "string" && payload.error.trim()) {
      return payload.error;
    }
  } catch {
    // A proxy or server can return an empty body or HTML instead of JSON.
  }
  return fallback;
}

export async function readApiData<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(await readErrorMessage(response));
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object" || !("ok" in payload) ||
    payload.ok !== true || !("data" in payload)) {
    throw new Error(i18n.t("common.invalidResponse"));
  }
  return (payload as ApiResponse<T>).data;
}
