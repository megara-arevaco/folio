import { fileOperations } from "./shared/files";
import { checkDocumentSize, LimitedOperations } from "./shared/limits";
import type { DeviceBook, EbookDevice as PublicEbookDevice } from "../../../../packages/contracts/src";
export type { DeviceBook } from "../../../../packages/contracts/src";
import { createHash, randomUUID } from "node:crypto";
import { execFile, type ExecFileOptions } from "node:child_process";
import { mkdtemp, open, readdir, realpath, rename, rm, stat, writeFile, link } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, resolve, sep, delimiter } from "node:path";
import { promisify } from "node:util";
import { readEpubMetadata } from "./epubMetadata";

export type EbookDevice = PublicEbookDevice & { root: string };

const MAX_BOOKS = 1000;
const MAX_DEPTH = 10;
const EBOOK_EXTENSIONS = new Set(["epub", "kfx", "azw", "azw3", "mobi", "pdf"]);
const SKIP_DIRECTORIES = new Set([".cache", "system", "fonts", "voice", "audible", "screenshots"]);
const STAT_CONCURRENCY = 12;
const rawExecFileAsync = promisify(execFile);
const transfers = new LimitedOperations(2);
const execFileAsync = (file: string, args: string[], options: ExecFileOptions) => transfers.run(() => rawExecFileAsync(file, args, options));

function configuredRoots(): string[] {
  const defaults = process.platform === "win32" ? "" : `/media:/run/user/${process.getuid?.() ?? 1000}/gvfs`;
  const value = process.env.EBOOK_DEVICE_ROOTS ?? defaults;
  return value.split(delimiter).map((item) => item.trim()).filter(Boolean).map((item) => resolve(item));
}

function deviceId(root: string): string {
  return createHash("sha256").update(root).digest("hex").slice(0, 20);
}

function deviceName(root: string): string {
  const name = basename(root);
  if (name.startsWith("mtp:host=")) {
    return name.slice("mtp:host=".length).replace(/_[A-Z0-9]{12,}$/i, "").replace(/_/g, " ");
  }
  return name;
}

function metadataFromFileName(fileName: string): { title: string; authors: string[] } {
  const stem = fileName
    .replace(/\.[^.]+$/i, "")
    .replace(/_[A-Z0-9]{10,}$/i, "")
    .replace(/_/g, " ")
    .trim();
  const parts = stem.split(/\s+--\s+/).map((part) => part.trim()).filter(Boolean);
  return {
    title: parts[0] || stem,
    authors: parts[1] ? [parts[1]] : [],
  };
}

const KFX_METADATA_KEYS = [
  "book_id", "override_kindle_font", "cover_image", "author", "description",
  "issue_date", "content_id", "cde_content_type", "publisher", "ASIN", "language",
  "title", "is_sample", "asset_id", "kindle_ebook_metadata", "kindle_audit_metadata",
];

function cleanIonText(value: Buffer): string {
  const decoded = value.toString("utf-8");
  const candidates = decoded.match(/[\p{Script=Latin}\p{N}][\p{Script=Latin}\p{N}\p{M}\s.,;:!?¿¡'’"«»&()_\-–—/]+/gu) ?? [];
  return candidates.map((item) => item.trim()).sort((left, right) => right.length - left.length)[0] ?? "";
}

function cleanImportedTitle(title: string): string {
  const withoutArchiveData = title.split(/\s+--\s+/)[0]!.replace(/_/g, " ").trim();
  if (/^[\p{Script=Latin}\p{N}]+(?:-[\p{Script=Latin}\p{N}]+)+$/u.test(withoutArchiveData)) {
    const readable = withoutArchiveData.replace(/-/g, " ");
    return readable.charAt(0).toLocaleUpperCase("es") + readable.slice(1);
  }
  return withoutArchiveData;
}

export function parseKfxMetadata(data: Buffer): { title?: string; authors?: string[] } {
  const marker = data.indexOf("kindle_title_metadata");
  if (marker < 0) return {};
  const endMarker = data.indexOf("kindle_ebook_metadata", marker + 1);
  const metadataEnd = endMarker > marker ? endMarker : Math.min(data.length, marker + 256 * 1024);
  const fields = new Map<string, { start: number; end: number }>();
  const positions = KFX_METADATA_KEYS
    .map((key) => ({ key, position: data.indexOf(key, marker + "kindle_title_metadata".length) }))
    .filter((item) => item.position >= 0 && item.position < metadataEnd)
    .sort((left, right) => left.position - right.position);
  positions.forEach((item, index) => fields.set(item.key, {
    start: item.position + Buffer.byteLength(item.key),
    end: positions[index + 1]?.position ?? metadataEnd,
  }));

  const value = (key: string) => {
    const field = fields.get(key);
    return field ? cleanIonText(data.subarray(field.start, field.end)) : "";
  };
  const title = cleanImportedTitle(value("title"));
  const author = value("author").replace(/_/g, " ").replace(/\s+/g, " ").trim();
  return {
    ...(title ? { title } : {}),
    ...(author ? { authors: [author] } : {}),
  };
}

async function readKfxMetadata(path: string, size: number): Promise<{ title?: string; authors?: string[] }> {
  const bytesToRead = Math.min(size, 3 * 1024 * 1024);
  const buffer = Buffer.alloc(bytesToRead);
  const handle = await open(path, "r");
  try {
    const { bytesRead } = await handle.read(buffer, 0, bytesToRead, size - bytesToRead);
    return parseKfxMetadata(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

async function collectBooks(root: string): Promise<DeviceBook[]> {
  const books: DeviceBook[] = [];
  async function walk(directory: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH || books.length >= MAX_BOOKS) return;
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (books.length >= MAX_BOOKS) break;
      if (entry.isSymbolicLink()) continue;
      const absolutePath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name.toLowerCase()) || entry.name.toLowerCase().endsWith(".sdr")) continue;
        await walk(absolutePath, depth + 1);
      }
    }

    const files = entries.filter((entry) => entry.isFile() && EBOOK_EXTENSIONS.has(entry.name.split(".").pop()?.toLowerCase() ?? ""));
    for (let offset = 0; offset < files.length && books.length < MAX_BOOKS; offset += STAT_CONCURRENCY) {
      const batch = files.slice(offset, offset + STAT_CONCURRENCY);
      const results = await Promise.all(batch.map(async (entry): Promise<DeviceBook | null> => {
        const format = entry.name.split(".").pop()?.toLowerCase() ?? "";
        const absolutePath = resolve(directory, entry.name);
        try {
          const info = await stat(absolutePath);
          const fallbackMetadata = metadataFromFileName(entry.name);
          let title = fallbackMetadata.title;
          let authors: string[] = fallbackMetadata.authors;
          if (format === "epub") try {
            const metadata = readEpubMetadata(absolutePath);
            title = metadata.title || title;
            authors = metadata.authors;
          } catch { /* Keep file-system fallback data for malformed books. */ }
          if (format === "kfx") try {
            const internalMetadata = await readKfxMetadata(absolutePath, info.size);
            title = internalMetadata.title || title;
            authors = internalMetadata.authors?.length ? internalMetadata.authors : authors;
          } catch { /* Keep the filename fallback if MTP cannot seek in the file. */ }
          return {
            path: relative(root, absolutePath).split(sep).join("/"),
            fileName: entry.name,
            title,
            authors,
            size: info.size,
            modifiedAt: info.mtime.toISOString(),
            format: format.toUpperCase(),
          };
        } catch { return null; /* The device may have disconnected during the scan. */ }
      }));
      books.push(...results.filter((book): book is DeviceBook => Boolean(book)).slice(0, MAX_BOOKS - books.length));
    }
  }
  await walk(root, 0);
  return books.sort((left, right) => left.title.localeCompare(right.title, "es"));
}

async function candidateDeviceRoots(): Promise<string[]> {
  const candidates: string[] = [];
  for (const configured of configuredRoots()) {
    let root: string;
    try { root = await realpath(configured); } catch { continue; }
    const isMountContainer = ["media", "host-media", "gvfs", "host-gvfs"].includes(basename(root));
    if (!isMountContainer) {
      candidates.push(root);
      continue;
    }
    let firstLevel;
    try { firstLevel = await readdir(root, { withFileTypes: true }); } catch { continue; }
    for (const first of firstLevel.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())) {
      const firstPath = resolve(root, first.name);
      if (["gvfs", "host-gvfs"].includes(basename(root))) {
        if (await collectBooks(firstPath).then((books) => books.length > 0)) candidates.push(firstPath);
        continue;
      }
      let secondLevel;
      try { secondLevel = await readdir(firstPath, { withFileTypes: true }); } catch { continue; }
      const directories = secondLevel.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink());
      const mountedDevices: string[] = [];
      for (const directory of directories) {
        const path = resolve(firstPath, directory.name);
        if (await collectBooks(path).then((books) => books.length > 0)) mountedDevices.push(path);
      }
      if (mountedDevices.length > 0) candidates.push(...mountedDevices);
      else if (await collectBooks(firstPath).then((books) => books.length > 0)) candidates.push(firstPath);
    }
  }
  return Array.from(new Set(candidates));
}

export async function listEbookDevices(): Promise<EbookDevice[]> {
  const devices: EbookDevice[] = [];
  for (const root of await candidateDeviceRoots()) {
    const books = await collectBooks(root);
    if (books.length > 0) devices.push({ id: deviceId(root), name: deviceName(root), root, books });
  }
  return devices;
}

export async function resolveDeviceBook(deviceIdValue: string, bookPath: string): Promise<{ path: string; fileName: string } | null> {
  const device = (await listEbookDevices()).find((item) => item.id === deviceIdValue);
  if (!device) return null;
  return resolveKnownDeviceBook(device, bookPath);
}

export async function resolveKnownDeviceBook(device: EbookDevice, bookPath: string): Promise<{ path: string; fileName: string } | null> {
  if (!device.books.some((book) => book.path === bookPath)) return null;
  const requested = resolve(device.root, bookPath);
  const canonicalRoot = await realpath(device.root);
  let canonicalFile: string;
  try { canonicalFile = await realpath(requested); } catch { return null; }
  if (canonicalFile !== canonicalRoot && !canonicalFile.startsWith(`${canonicalRoot}${sep}`)) return null;
  const extension = canonicalFile.split(".").pop()?.toLowerCase() ?? "";
  if (!EBOOK_EXTENSIONS.has(extension)) return null;
  return { path: canonicalFile, fileName: basename(canonicalFile) };
}

export async function deleteDeviceBook(deviceIdValue: string, bookPath: string): Promise<boolean> {
  const device = (await listEbookDevices()).find((item) => item.id === deviceIdValue);
  return device ? deleteKnownDeviceBook(device, bookPath) : false;
}

export async function deleteKnownDeviceBook(device: EbookDevice, bookPath: string): Promise<boolean> {
  const book = await resolveKnownDeviceBook(device, bookPath);
  if (!book) return false;
  return fileOperations.run(book.path, async () => {
    const current = await resolveKnownDeviceBook(device, bookPath);
    if (!current) return false;
    await rm(current.path);
    return true;
  });
}

export async function replaceKnownDeviceBook(device: EbookDevice, bookPath: string, data: Buffer): Promise<boolean> {
  checkDocumentSize(data.length);
  const book = await resolveKnownDeviceBook(device, bookPath);
  if (!book) return false;
  return fileOperations.run(book.path, () => replaceKnownDeviceBookUnlocked(device, bookPath, data));
}

async function replaceKnownDeviceBookUnlocked(device: EbookDevice, bookPath: string, data: Buffer): Promise<boolean> {
  const book = await resolveKnownDeviceBook(device, bookPath);
  if (!book) return false;
  const isGvfsMtp = device.root.split(sep).some((part) => part === "gvfs") || basename(device.root).startsWith("mtp:host=");
  if (isGvfsMtp) {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "kindle-replace-"));
    const source = join(temporaryDirectory, book.fileName);
    try {
      await writeFile(source, data);
      await execFileAsync(process.env.GIO_COMMAND ?? "gio", ["copy", "--overwrite", "--no-target-directory", source, book.path], {
        timeout: 5 * 60 * 1000,
        maxBuffer: 1024 * 1024,
      });
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
    return true;
  }

  const temporaryPath = join(dirname(book.path), `.${randomUUID()}.${book.fileName}.tmp`);
  try {
    await writeFile(temporaryPath, data);
    await rename(temporaryPath, book.path);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
  return true;
}

export async function replaceDeviceBook(deviceIdValue: string, bookPath: string, data: Buffer): Promise<boolean> {
  const device = (await listEbookDevices()).find((item) => item.id === deviceIdValue);
  return device ? replaceKnownDeviceBook(device, bookPath, data) : false;
}

function safeUploadFileName(fileName: string): string {
  const normalized = basename(fileName).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  const extension = extname(normalized).slice(1).toLowerCase();
  if (!normalized || !EBOOK_EXTENSIONS.has(extension)) {
    throw new Error("Formato no compatible. Usa EPUB, AZW, AZW3, MOBI, KFX o PDF");
  }
  return normalized;
}

async function isDirectory(path: string): Promise<boolean> {
  try { return (await stat(path)).isDirectory(); } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return false;
    throw error;
  }
}

async function uploadDirectory(device: EbookDevice): Promise<string> {
  const root = await realpath(device.root);
  const confined = async (directory: string) => {
    const canonical = await realpath(directory);
    if (canonical !== root && !canonical.startsWith(root + sep)) throw new Error("La carpeta de subida está fuera del dispositivo");
    return canonical;
  };
  const commonDirectories = [
    "Internal Storage/documents/Downloads/Items01",
    "Internal storage/documents/Downloads/Items01",
    "documents/Downloads/Items01",
    "Internal Storage/documents",
    "Internal storage/documents",
    "documents",
  ];
  for (const directory of commonDirectories) {
    const candidate = resolve(device.root, directory);
    if (await isDirectory(candidate)) return confined(candidate);
  }

  const existingBookDirectory = device.books[0] ? dirname(resolve(device.root, device.books[0].path)) : device.root;
  return confined(await isDirectory(existingBookDirectory) ? existingBookDirectory : device.root);
}

async function availableUploadPath(directory: string, fileName: string): Promise<string> {
  const extension = extname(fileName);
  const stem = basename(fileName, extension);
  for (let copy = 1; copy < 10_000; copy++) {
    const candidateName = copy === 1 ? fileName : `${stem} (${copy})${extension}`;
    const candidate = resolve(directory, candidateName);
    try { await stat(candidate); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return candidate;
      throw error;
    }
  }
  throw new Error("No se ha podido encontrar un nombre libre en el dispositivo");
}

export async function uploadKnownDeviceBook(device: EbookDevice, fileName: string, data: Buffer): Promise<{ path: string; fileName: string }> {
  checkDocumentSize(data.length);
  return fileOperations.run(`device-upload:${await realpath(device.root)}`, () => uploadKnownDeviceBookUnlocked(device, fileName, data));
}

async function uploadKnownDeviceBookUnlocked(device: EbookDevice, fileName: string, data: Buffer): Promise<{ path: string; fileName: string }> {
  const safeName = safeUploadFileName(fileName);
  const directory = await uploadDirectory(device);
  let destination = await availableUploadPath(directory, safeName);
  const isGvfsMtp = device.root.split(sep).some((part) => part === "gvfs") || basename(device.root).startsWith("mtp:host=");
  if (isGvfsMtp) {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "kindle-copy-"));
    const source = join(temporaryDirectory, safeName);
    try {
      await writeFile(source, data);
      await execFileAsync(process.env.GIO_COMMAND ?? "gio", ["copy", "--no-target-directory", source, destination], {
        timeout: 5 * 60 * 1000,
        maxBuffer: 1024 * 1024,
      });
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  } else {
    const temporaryPath = join(directory, `.${randomUUID()}.upload`);
    try {
      await writeFile(temporaryPath, data, { flag: "wx" });
      for (let attempt = 0; ; attempt++) {
        try { await link(temporaryPath, destination); break; }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST" || attempt >= 9999) throw error;
          destination = await availableUploadPath(directory, safeName);
        }
      }
    } finally { await rm(temporaryPath, { force: true }).catch(() => undefined); }
  }
  return {
    path: relative(device.root, destination).split(sep).join("/"),
    fileName: basename(destination),
  };
}

export async function uploadDeviceBook(deviceIdValue: string, fileName: string, data: Buffer): Promise<{ path: string; fileName: string } | null> {
  const device = (await listEbookDevices()).find((item) => item.id === deviceIdValue);
  return device ? uploadKnownDeviceBook(device, fileName, data) : null;
}
