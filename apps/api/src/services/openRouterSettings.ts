import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";

export type OpenRouterSettingsSource = "settings" | "environment" | "none";
export type OpenRouterSettingsStatus = {
  configured: boolean;
  source: OpenRouterSettingsSource;
};

type StoredSettings = Record<string, unknown> & { openRouterApiKey?: string };

function settingsFilePath(): string {
  if (process.env.FOLIO_SETTINGS_PATH) return resolve(process.env.FOLIO_SETTINGS_PATH);
  const dataDirectory = resolve(process.env.FOLIO_DATA_DIR || join(process.cwd(), "tmp"));
  return join(dataDirectory, "settings.json");
}

function readSettings(): StoredSettings {
  try {
    const parsed: unknown = JSON.parse(readFileSync(settingsFilePath(), "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("El archivo de ajustes de Folio no es válido");
    }
    const settings = parsed as StoredSettings;
    if (settings.openRouterApiKey !== undefined && typeof settings.openRouterApiKey !== "string") {
      throw new Error("La clave guardada de OpenRouter no es válida");
    }
    return settings;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

function writeSettings(settings: StoredSettings): void {
  const path = settingsFilePath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    chmodSync(temporaryPath, 0o600);
    renameSync(temporaryPath, path);
    chmodSync(path, 0o600);
  } finally {
    try {
      unlinkSync(temporaryPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

function environmentApiKey(): string | null {
  const key = process.env.LLM_API_KEY?.trim() ?? "";
  return key && key !== "replace-me" ? key : null;
}

export function getOpenRouterApiKey(): string | null {
  const savedKey = readSettings().openRouterApiKey?.trim();
  return savedKey || environmentApiKey();
}

export function getOpenRouterSettingsStatus(): OpenRouterSettingsStatus {
  const savedKey = readSettings().openRouterApiKey?.trim();
  if (savedKey) return { configured: true, source: "settings" };
  if (environmentApiKey()) return { configured: true, source: "environment" };
  return { configured: false, source: "none" };
}

export function saveOpenRouterApiKey(apiKey: string): OpenRouterSettingsStatus {
  const settings = readSettings();
  settings.openRouterApiKey = apiKey;
  writeSettings(settings);
  return { configured: true, source: "settings" };
}

export function removeSavedOpenRouterApiKey(): OpenRouterSettingsStatus {
  const settings = readSettings();
  delete settings.openRouterApiKey;
  writeSettings(settings);
  return getOpenRouterSettingsStatus();
}
