import { randomUUID } from "node:crypto";
import { link, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";

export async function writeFileAtomically(filePath: string, content: string | Buffer): Promise<void> {
  const temporaryPath = resolve(dirname(filePath), `.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, content);
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

/** Serialize operations on the same resource, allowing retries after a failure. */
export class ResourceLocks {
  private readonly chains = new Map<string, Promise<unknown>>();

  run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    this.chains.set(key, next);
    void next.finally(() => {
      if (this.chains.get(key) === next) this.chains.delete(key);
    }).catch(() => undefined);
    return next;
  }

  async flush(): Promise<void> {
    await Promise.all([...this.chains.values()]);
  }
}

export const fileOperations = new ResourceLocks();

/** Publish a complete new artifact without replacing an existing book. */
export async function publishNewFile(filePath: string, content: Buffer): Promise<string> {
  const directory = dirname(filePath);
  const temporaryPath = resolve(directory, `.${randomUUID()}.publish`);
  const extension = extname(filePath);
  const stem = basename(filePath, extension);
  try {
    await writeFile(temporaryPath, content, { flag: "wx" });
    for (let copy = 0; copy < 10000; copy++) {
      const destination = copy === 0 ? filePath : resolve(directory, `${stem} (${copy + 1})${extension}`);
      try { await link(temporaryPath, destination); return destination; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    }
    throw new Error("No se ha encontrado un nombre de salida libre");
  } finally { await rm(temporaryPath, { force: true }).catch(() => undefined); }
}
