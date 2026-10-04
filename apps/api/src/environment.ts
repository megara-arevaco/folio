import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

// Imported before the API services, some of which read configuration at import time.
// Resolve from the repository rather than the shell's working directory. Node keeps
// explicitly supplied environment variables (including Docker's) ahead of .env.
try {
  if (process.env.FOLIO_DESKTOP !== "true") {
    loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
  }
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
