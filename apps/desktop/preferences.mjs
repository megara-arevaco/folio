import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export function readPreferences(directory) {
  try {
    const value = JSON.parse(readFileSync(join(directory, "desktop-preferences.json"), "utf8"));
    if (!value || value.version !== 1 || !["es", "en"].includes(value.language)) {
      throw new Error("Formato de preferencias no compatible");
    }
    return { version: 1, language: value.language };
  } catch (error) {
    if (error.code === "ENOENT") return { version: 1, language: "es" };
    throw new Error("No se pueden leer las preferencias. Se conserva desktop-preferences.json para revisión.", { cause: error });
  }
}

export function writeLanguage(directory, language) {
  if (!["es", "en"].includes(language)) throw new Error("Idioma no admitido");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "desktop-preferences.json");
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify({ version: 1, language })}\n`, { mode: 0o600, flag: "wx" });
    renameSync(temporary, path);
  } finally { rmSync(temporary, { force: true }); }
  return { version: 1, language };
}
