import { checkDocumentSize, readDocument, LimitedOperations } from "./shared/limits";
import { openValidatedZip } from "./shared/zip";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const conversions = new LimitedOperations(2);

export type KindleUpload = {
  data: Buffer;
  fileName: string;
  converted: boolean;
};

export function kindleOutputFileName(fileName: string): string {
  const safeName = basename(fileName).replace(/[\u0000-\u001f\u007f]/g, "").trim() || "libro.epub";
  return `${basename(safeName, extname(safeName))}.azw3`;
}

export async function prepareKindleUpload(data: Buffer, fileName: string): Promise<KindleUpload> {
  return conversions.run(() => prepareKindleUploadUnlocked(data, fileName));
}

async function prepareKindleUploadUnlocked(data: Buffer, fileName: string): Promise<KindleUpload> {
  checkDocumentSize(data.length);
  if (extname(fileName).toLowerCase() !== ".epub") return { data, fileName, converted: false };

  openValidatedZip(data);
  const directory = await mkdtemp(join(tmpdir(), "epub-to-kindle-"));
  const inputPath = join(directory, "input.epub");
  const outputPath = join(directory, "output.azw3");
  try {
    await writeFile(inputPath, data);
    const command = process.env.EBOOK_CONVERT_COMMAND ?? "ebook-convert";
    await execFileAsync(command, [inputPath, outputPath, "--output-profile", "kindle_pw3"], {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 5 * 60 * 1000,
    });
    return {
      data: await readDocument(outputPath),
      fileName: kindleOutputFileName(fileName),
      converted: true,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`No se ha podido convertir el EPUB a AZW3: ${detail}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
