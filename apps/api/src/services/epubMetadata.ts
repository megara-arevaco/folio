import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import { dirname, posix, resolve } from "node:path";
import AdmZip from "adm-zip";
import * as cheerio from "cheerio";

export type EpubMetadata = {
  title: string;
  authors: string[];
  language: string;
  publisher: string;
  description: string;
};

export type EpubCover = { data: Buffer; mediaType: string };

function localName(name: string): string {
  const parts = name.split(":");
  return parts[parts.length - 1]?.toLowerCase() ?? "";
}

function findChildrenByLocalName(
  element: cheerio.Cheerio<any>,
  name: string,
): cheerio.Cheerio<any> {
  return element.children().filter((_, child) => localName(child.name) === name);
}

function getPackageDocument(zip: AdmZip): { entryName: string; $: cheerio.CheerioAPI } {
  const container = zip.getEntry("META-INF/container.xml");
  if (!container) throw new Error("El EPUB no contiene META-INF/container.xml");

  const containerXml = cheerio.load(container.getData().toString("utf-8"), { xmlMode: true });
  const rootfile = containerXml("rootfile").first();
  const entryName = rootfile.attr("full-path")?.trim();
  if (!entryName) throw new Error("No se ha encontrado el paquete OPF del EPUB");

  const packageEntry = zip.getEntry(entryName);
  if (!packageEntry) throw new Error("El paquete OPF indicado por el EPUB no existe");

  return {
    entryName,
    $: cheerio.load(packageEntry.getData().toString("utf-8"), { xmlMode: true }),
  };
}

function getMetadataElement($: cheerio.CheerioAPI): cheerio.Cheerio<any> {
  const metadata = $("metadata").first();
  if (metadata.length === 0) throw new Error("El EPUB no contiene una sección de metadatos");
  return metadata;
}

function getCoverEntry(zip: AdmZip): { entryName: string; mediaType: string } | null {
  const { entryName: opfPath, $ } = getPackageDocument(zip);
  const metadata = getMetadataElement($);
  const legacyCoverId = metadata.children("meta").filter((_, item) => $(item).attr("name") === "cover").first().attr("content");
  const coverItem = $("manifest item").filter((_, item) => {
    const properties = ($(item).attr("properties") ?? "").split(/\s+/);
    return properties.includes("cover-image") || (legacyCoverId ? $(item).attr("id") === legacyCoverId : false);
  }).first();
  const href = coverItem.attr("href");
  if (!href) return null;
  const decodedHref = decodeURIComponent(href.split("#")[0]!);
  return {
    entryName: posix.normalize(posix.join(posix.dirname(opfPath), decodedHref)),
    mediaType: coverItem.attr("media-type") ?? "application/octet-stream",
  };
}

export function readEpubCover(epub: string | Buffer): EpubCover | null {
  const zip = new AdmZip(epub);
  const cover = getCoverEntry(zip);
  if (!cover) return null;
  const entry = zip.getEntry(cover.entryName);
  return entry ? { data: entry.getData(), mediaType: cover.mediaType } : null;
}

export function updateEpubCoverBuffer(epub: string | Buffer, cover: EpubCover): Buffer {
  const zip = new AdmZip(epub);
  const { entryName: opfPath, $ } = getPackageDocument(zip);
  const metadata = getMetadataElement($);
  const legacyCoverId = metadata.children("meta").filter((_, item) => $(item).attr("name") === "cover").first().attr("content");
  let coverItem = $("manifest item").filter((_, item) => {
    const properties = ($(item).attr("properties") ?? "").split(/\s+/);
    return properties.includes("cover-image") || (legacyCoverId ? $(item).attr("id") === legacyCoverId : false);
  }).first();

  let coverPath: string;
  if (coverItem.length > 0 && coverItem.attr("href")) {
    coverPath = posix.normalize(posix.join(posix.dirname(opfPath), decodeURIComponent(coverItem.attr("href")!.split("#")[0]!)));
    coverItem.attr("media-type", cover.mediaType);
    const properties = new Set((coverItem.attr("properties") ?? "").split(/\s+/).filter(Boolean));
    properties.add("cover-image");
    coverItem.attr("properties", Array.from(properties).join(" "));
  } else {
    const extension = cover.mediaType === "image/png" ? "png" : cover.mediaType === "image/webp" ? "webp" : "jpg";
    const href = `cover-edited.${extension}`;
    coverPath = posix.join(posix.dirname(opfPath), href);
    $("manifest").first().append(`<item id="cover-image-edited" href="${href}" media-type="${cover.mediaType}" properties="cover-image"></item>`);
    coverItem = $("manifest item").last();
  }

  let legacyMeta = metadata.children("meta").filter((_, item) => $(item).attr("name") === "cover").first();
  if (legacyMeta.length === 0) {
    metadata.append("<meta name=\"cover\"></meta>");
    legacyMeta = metadata.children("meta").last();
  }
  legacyMeta.attr("content", coverItem.attr("id") ?? "cover-image-edited");
  zip.updateFile(opfPath, Buffer.from($.xml(), "utf-8"));
  if (zip.getEntry(coverPath)) zip.updateFile(coverPath, cover.data);
  else zip.addFile(coverPath, cover.data);
  return zip.toBuffer();
}

export function readEpubMetadata(epub: string | Buffer): EpubMetadata {
  const { $ } = getPackageDocument(new AdmZip(epub));
  const metadata = getMetadataElement($);
  const text = (name: string) => findChildrenByLocalName(metadata, name).first().text().trim();

  return {
    title: text("title"),
    authors: findChildrenByLocalName(metadata, "creator")
      .toArray()
      .map((creator) => $(creator).text().trim())
      .filter(Boolean),
    language: text("language"),
    publisher: text("publisher"),
    description: text("description"),
  };
}

function replaceMetadataField(
  metadata: cheerio.Cheerio<any>,
  name: string,
  values: string[],
): void {
  const existing = findChildrenByLocalName(metadata, name);
  const normalizedValues = values.map((item) => item.trim()).filter(Boolean);

  existing.each((index) => {
    const item = existing.eq(index);
    if (index < normalizedValues.length) {
      item.text(normalizedValues[index]!);
      return;
    }

    const id = item.attr("id") ?? item.attr("xml:id");
    if (id) {
      findChildrenByLocalName(metadata, "meta")
        .filter((_, meta) => meta.attribs?.refines === `#${id}`)
        .remove();
    }
    item.remove();
  });

  for (const value of normalizedValues.slice(existing.length)) {
    metadata.append(`<dc:${name}></dc:${name}>`);
    findChildrenByLocalName(metadata, name).last().text(value);
  }
}

export function updateEpubMetadataBuffer(epub: string | Buffer, values: EpubMetadata): Buffer {
  const zip = new AdmZip(epub);
  const { entryName, $ } = getPackageDocument(zip);
  const metadata = getMetadataElement($);
  if (!metadata.attr("xmlns:dc")) {
    metadata.attr("xmlns:dc", "http://purl.org/dc/elements/1.1/");
  }

  replaceMetadataField(metadata, "title", [values.title]);
  replaceMetadataField(metadata, "creator", values.authors);
  replaceMetadataField(metadata, "language", [values.language]);
  replaceMetadataField(metadata, "publisher", [values.publisher]);
  replaceMetadataField(metadata, "description", [values.description]);
  zip.updateFile(entryName, Buffer.from($.xml(), "utf-8"));
  return zip.toBuffer();
}

export async function updateEpubMetadata(epubPath: string, values: EpubMetadata): Promise<void> {
  const updatedEpub = updateEpubMetadataBuffer(epubPath, values);

  const temporaryPath = resolve(dirname(epubPath), `.${randomUUID()}.epub.tmp`);
  try {
    await writeFile(temporaryPath, updatedEpub);
    await rename(temporaryPath, epubPath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}
