import { open } from "node:fs/promises";

export function integerSetting(name: string, fallback: number, minimum = 1, maximum = 900000): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} debe ser un entero entre ${minimum} y ${maximum}`);
  }
  return value;
}
export const maxDocumentBytes = () => integerSetting("MAX_UPLOAD_MB", 100, 1, 1024) * 1024 * 1024;
export function checkDocumentSize(bytes: number): void {
  if (bytes > maxDocumentBytes()) throw new Error("El documento supera el tamaño permitido");
}
export async function readDocument(path: string): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    checkDocumentSize((await handle.stat()).size);
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      size += chunk.length;
      checkDocumentSize(size);
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, size);
  } finally { await handle.close(); }
}
export function checkPdfPageCount(pages: number): void {
  if (pages > integerSetting("PDF_MAX_PAGES", 2000, 1, 10000)) throw new Error("El PDF supera el número de páginas permitido");
}

/** Bound expensive operations and the number waiting for a slot. */
export class LimitedOperations {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  constructor(private readonly maximum: number, private readonly maximumWaiting = 8) {}

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active < this.maximum) this.active++;
    else {
      if (this.waiting.length >= this.maximumWaiting) throw new Error("Hay demasiadas operaciones pendientes; vuelve a intentarlo más tarde");
      await new Promise<void>((resume) => this.waiting.push(resume));
    }
    try { return await operation(); }
    finally {
      const next = this.waiting.shift();
      if (next) next(); else this.active--;
    }
  }
}
