import { loadEnvFile } from "node:process";
import { resolve, join } from "node:path";

// Imported before the API services, some of which read configuration at import time.
// Load from the execution directory or an explicit path. Node keeps environment
// variables supplied by the process (including Docker's) ahead of .env.
try {
  loadEnvFile(resolve(process.env.FOLIO_ENV_FILE ?? ".env"));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

if (process.env.FOLIO_DATA_DIR) {
  const root = resolve(process.env.FOLIO_DATA_DIR);
  process.env.JOBS_TMP_ROOT ??= join(root, "jobs");
  process.env.OUTPUT_DIR ??= join(root, "books");
  process.env.READING_DB_PATH ??= join(root, "reading-log.sqlite");
  process.env.READING_LOG_PATH ??= join(root, "reading-log.json");
}
