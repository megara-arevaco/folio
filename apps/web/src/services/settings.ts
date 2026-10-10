import { API_BASE_URL, readApiData } from "./http";

export type OpenRouterSettingsSource = "settings" | "environment" | "none";
export type OpenRouterSettings = {
  configured: boolean;
  source: OpenRouterSettingsSource;
};

export async function fetchOpenRouterSettings(): Promise<OpenRouterSettings> {
  const response = await fetch(`${API_BASE_URL}/api/settings/openrouter`, { cache: "no-store" });
  return readApiData<OpenRouterSettings>(response);
}

export async function saveOpenRouterApiKey(apiKey: string): Promise<OpenRouterSettings> {
  const response = await fetch(`${API_BASE_URL}/api/settings/openrouter`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey }),
  });
  return readApiData<OpenRouterSettings>(response);
}

export async function removeSavedOpenRouterApiKey(): Promise<OpenRouterSettings> {
  const response = await fetch(`${API_BASE_URL}/api/settings/openrouter`, { method: "DELETE" });
  return readApiData<OpenRouterSettings>(response);
}
