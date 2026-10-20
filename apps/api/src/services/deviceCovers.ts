import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { promisify } from "node:util";
import { readEpubCover } from "./epubMetadata";
import { checkDocumentSize, LimitedOperations } from "./shared/limits";

type CoverSource = { path: string; fileName: string } | { data: Buffer; fileName: string } | { thumbnail: Buffer };
const exec = promisify(execFile);
const work = new LimitedOperations(2, 48);
const cache = new Map<string, { data: Buffer | null; expires: number }>();
const pending = new Map<string, Promise<Buffer | null>>();

export function getDeviceCover(key: string, load: () => Promise<CoverSource | null>): Promise<Buffer | null> {
  const existing = cache.get(key);
  if (existing && existing.expires > Date.now()) {
    cache.delete(key);
    cache.set(key, existing);
    return Promise.resolve(existing.data);
  }
  const active = pending.get(key);
  if (active) return active;
  const task = work.run(async () => {
    const source = await load();
    const data = !source ? null : "thumbnail" in source ? source.thumbnail : await extractCover(source);
    if (data && data.length > 512 * 1024) throw new Error("La miniatura supera el tamaño permitido");
    cache.delete(key);
    cache.set(key, { data, expires: Date.now() + (data ? 3600000 : 30000) });
    while (cache.size > 128) cache.delete(cache.keys().next().value!);
    return data;
  });
  pending.set(key, task);
  void task.finally(() => pending.delete(key)).catch(() => undefined);
  return task;
}

async function extractCover(source: Exclude<CoverSource, { thumbnail: Buffer }>): Promise<Buffer | null> {
  const extension = extname(source.fileName).toLowerCase();
  if (![".epub", ".pdf", ".azw", ".azw3", ".mobi", ".kfx"].includes(extension)) return null;
  checkDocumentSize("data" in source ? source.data.length : (await stat(source.path)).size);
  const directory = await mkdtemp(join(tmpdir(), "folio-cover-"));
  try {
    const input = "path" in source ? source.path : join(directory, `input${extension}`);
    if ("data" in source) await writeFile(input, source.data);
    let image = join(directory, "cover.jpg");
    if (extension === ".pdf") {
      await exec(process.env.PDF_RENDER_COMMAND || "pdftoppm", ["-f", "1", "-l", "1", "-singlefile", "-scale-to", "480", "-jpeg", input, join(directory, "cover")], { timeout: 20000, maxBuffer: 1024 * 1024 });
    } else if (extension === ".epub") {
      const cover = readEpubCover(input);
      if (!cover || cover.data.length > 8 * 1024 * 1024) return null;
      image = join(directory, "embedded-cover");
      await writeFile(image, cover.data);
    } else {
      await exec(process.env.EBOOK_META_COMMAND || "ebook-meta", [input, "--get-cover", image], { timeout: 20000, maxBuffer: 1024 * 1024 });
    }
    const output = join(directory, "thumbnail.jpg");
    await exec("python3", ["-c", "import sys,warnings; from PIL import Image,ImageOps; Image.MAX_IMAGE_PIXELS=20000000; warnings.simplefilter('error', Image.DecompressionBombWarning); im=ImageOps.exif_transpose(Image.open(sys.argv[1])); im.thumbnail((320,480)); im.convert('RGB').save(sys.argv[2], 'JPEG', quality=80)", image, output], { timeout: 10000, maxBuffer: 1024 * 1024 });
    return await readFile(output);
  } catch {
    // Missing tools, absent embedded covers and unsupported documents use the UI placeholder.
    return null;
  } finally { await rm(directory, { recursive: true, force: true }); }
}
