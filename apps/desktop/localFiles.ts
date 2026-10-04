import { dialog, BrowserWindow } from "electron";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { lstat, readFile, writeFile, rename, rm } from "node:fs/promises";
import type { LocalFiles } from "../api/src/routes/epubMetadata";

type Grant = { path: string; inode: number; device: number; modified: number; size: number };
const grants = new Map<string, Grant>();
export const localFiles: LocalFiles = {
  async open() {
    const window = BrowserWindow.getFocusedWindow();
    const options = { properties: ["openFile" as const], filters: [{ name: "Libros", extensions: ["epub", "pdf"] }] };
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return null;
    const path = result.filePaths[0];
    if (!/\.(epub|pdf)$/i.test(path)) throw new Error("Selecciona un EPUB o PDF");
    const info = await lstat(path);
    if (!info.isFile() || info.size > 100 * 1024 * 1024) throw new Error("Archivo inválido o demasiado grande");
    const id = randomUUID();
    const data = await readFile(path);
    // Limit temporary permissions to avoid retaining every file opened in a long session.
    if (grants.size >= 100) grants.delete(grants.keys().next().value!);
    grants.set(id, { path, inode: info.ino, device: info.dev, modified: info.mtimeMs, size: info.size });
    return { id, name: basename(path), data };
  },
  async overwrite(id, data) {
    const grant = grants.get(id);
    if (!grant) throw new Error("Vuelve a abrir el archivo para guardar");
    const info = await lstat(grant.path);
    if (!info.isFile() || info.ino !== grant.inode || info.dev !== grant.device || info.mtimeMs !== grant.modified || info.size !== grant.size) {
      grants.delete(id);
      throw new Error("El archivo ha cambiado; vuelve a abrirlo antes de guardar");
    }
    const temporary = join(dirname(grant.path), `.folio-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, data, { flag: "wx", mode: info.mode });
      await rename(temporary, grant.path);
      const updated = await lstat(grant.path);
      grants.set(id, { ...grant, inode: updated.ino, modified: updated.mtimeMs, size: updated.size });
    } finally { await rm(temporary, { force: true }); }
  },
};
