import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import type { Job, TextItem } from "../../types";
import { ResourceLocks, writeFileAtomically } from "../shared/files";
import { getJobDir } from "./paths";
import { fromPersistedJobRecord, isPersistedJobRecord, toPersistedJobRecord } from "./records";
export type { PersistedJobRecord } from "./records";

export class JobPersistence {
  private readonly operations = new ResourceLocks();
  private readonly deleted = new WeakSet<Job>();

  persist(job: Job): Promise<void> {
    if (this.deleted.has(job)) return Promise.resolve();
    const snapshot = JSON.stringify(toPersistedJobRecord(job), null, 2);
    return this.operations.run(job.id, async () => {
      if (this.deleted.has(job)) return;
      await mkdir(getJobDir(job), { recursive: true });
      await writeFileAtomically(resolve(getJobDir(job), "job.json"), snapshot);
    });
  }

  checkpoint(job: Job, items: TextItem[]): Promise<void> {
    const snapshot = JSON.stringify(items, null, 2);
    return this.operations.run(job.id, async () => {
      if (this.deleted.has(job)) return;
      await mkdir(getJobDir(job), { recursive: true });
      await writeFileAtomically(resolve(getJobDir(job), "translated-items.json"), snapshot);
    });
  }

  async readCheckpoint(job: Job): Promise<TextItem[]> {
    let raw: string;
    try {
      raw = await readFile(resolve(getJobDir(job), "translated-items.json"), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && job.checkpointBatchIndex === 0) return [];
      throw new Error("No se puede recuperar el checkpoint EPUB; se conserva para revisión");
    }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new Error("Checkpoint EPUB dañado; se conserva para revisión"); }
    const ids = new Set<string>();
    if (!Array.isArray(parsed) || !parsed.every((item) => {
      if (!item || typeof item.id !== "string" || !item.id || typeof item.text !== "string" || !item.text.trim() || ids.has(item.id)) return false;
      ids.add(item.id);
      return true;
    }) || (job.checkpointBatchIndex > 0 && parsed.length === 0)) {
      throw new Error("Checkpoint EPUB inválido; se conserva para revisión");
    }
    return parsed;
  }

  async delete(job: Job): Promise<void> {
    // Fence new writes before waiting for existing operations.
    this.deleted.add(job);
    await this.operations.run(job.id, () => rm(getJobDir(job), { recursive: true, force: true }));
  }

  flush(): Promise<void> { return this.operations.flush(); }
}

export async function readJobsFromDisk(rootDir: string): Promise<{ jobs: Job[]; errors: Array<{ directory: string; message: string }> }> {
  await mkdir(rootDir, { recursive: true });
  const jobs: Job[] = [];
  const errors: Array<{ directory: string; message: string }> = [];
  for (const entry of await readdir(rootDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const jobDir = resolve(rootDir, entry.name);
    try {
      const record: unknown = JSON.parse(await readFile(resolve(jobDir, "job.json"), "utf8"));
      if (!isPersistedJobRecord(record)) throw new Error("Registro de trabajo inválido");
      if (record.id !== entry.name || dirname(resolve(record.inputFilePath)) !== jobDir ||
        basename(record.inputFilePath) !== (record.kind === "pdf-conversion" ? "input.pdf" : "input.epub")) {
        throw new Error("Rutas de trabajo inválidas");
      }
      const outputDir = dirname(resolve(record.outputFilePath));
      if (outputDir !== jobDir && outputDir !== resolve(process.env.OUTPUT_DIR ?? jobDir)) {
        throw new Error("La salida está fuera del directorio configurado");
      }
      if (!record.outputFilePath.toLowerCase().endsWith(".epub") ||
        (record.outputFileName !== null && record.outputFileName !== basename(record.outputFilePath))) {
        throw new Error("Nombre de salida inválido");
      }
      jobs.push(fromPersistedJobRecord(record));
    } catch (error) {
      // Leave the original record and checkpoints untouched for diagnosis/recovery.
      errors.push({ directory: entry.name, message: error instanceof Error ? error.message : String(error) });
    }
  }
  jobs.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  return { jobs, errors };
}
