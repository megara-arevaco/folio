import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export async function executableAvailable(command: string, args = ["--version"]): Promise<boolean> {
  try {
    await exec(command, args, { timeout: 3000, maxBuffer: 128 * 1024, windowsHide: true });
    return true;
  } catch { return false; }
}

export async function getRuntimeDependencies() {
  const [poppler, calibre, gio] = await Promise.all([
    executableAvailable(process.env.PDF_RENDER_COMMAND ?? "pdftoppm", ["-v"]),
    executableAvailable(process.env.EBOOK_CONVERT_COMMAND ?? "ebook-convert"),
    process.platform === "linux" ? executableAvailable(process.env.GIO_COMMAND ?? "gio") : Promise.resolve(false),
  ]);
  return { poppler, calibre, gio, platform: process.platform };
}

export async function requirePdfRenderer(): Promise<void> {
  if (!await executableAvailable(process.env.PDF_RENDER_COMMAND ?? "pdftoppm", ["-v"])) {
    throw new Error("Este PDF necesita OCR, pero Poppler (pdftoppm) no está disponible. Instala Poppler y reinicia Folio, o utiliza un PDF con texto seleccionable. El original se conserva.");
  }
}

export async function requireKindleConverter(): Promise<void> {
  if (!await executableAvailable(process.env.EBOOK_CONVERT_COMMAND ?? "ebook-convert")) {
    throw new Error("La conversión a AZW3 requiere Calibre (ebook-convert). Instala Calibre y reinicia Folio, o descarga el EPUB para transferirlo manualmente.");
  }
}

export async function requireGio(): Promise<void> {
  if (!await executableAvailable(process.env.GIO_COMMAND ?? "gio")) {
    throw new Error("La transferencia MTP en Linux requiere GIO. Instala las herramientas GIO/GVFS o descarga el libro para transferirlo manualmente.");
  }
}
