import type { ApiResponse } from "../../../../packages/contracts/src";

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? window.location.origin;

export async function readErrorMessage(
  response: Response,
  fallback = "No se ha podido completar la petición",
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
    throw new Error("La respuesta del servidor no es válida");
  }
  return (payload as ApiResponse<T>).data;
}
