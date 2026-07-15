import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import AdmZip from "adm-zip";
import { listEbookDevices, parseKfxMetadata, resolveDeviceBook, uploadKnownDeviceBook } from "./devices";

async function createEpub(path: string) {
  const zip = new AdmZip();
  zip.addFile("META-INF/container.xml", Buffer.from(`<container><rootfiles><rootfile full-path="book.opf" /></rootfiles></container>`));
  zip.addFile("book.opf", Buffer.from(`<package><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Device book</dc:title><dc:creator xmlns:dc="http://purl.org/dc/elements/1.1/">Test author</dc:creator><dc:language xmlns:dc="http://purl.org/dc/elements/1.1/">es</dc:language></metadata><manifest /></package>`));
  await writeFile(path, zip.toBuffer());
}

test("listEbookDevices finds nested EPUB files in a configured device root", async () => {
  const root = await mkdtemp(join(tmpdir(), "ebook-device-"));
  process.env.EBOOK_DEVICE_ROOTS = root;
  try {
    await mkdir(join(root, "Books"));
    await createEpub(join(root, "Books", "book.epub"));
    const devices = await listEbookDevices();
    assert.equal(devices.length, 1);
    assert.equal(devices[0]?.books[0]?.title, "Device book");
    assert.equal(devices[0]?.books[0]?.path, "Books/book.epub");
    assert.equal(devices[0]?.books[0]?.format, "EPUB");
  } finally {
    delete process.env.EBOOK_DEVICE_ROOTS;
    await rm(root, { recursive: true, force: true });
  }
});

test("resolveDeviceBook rejects paths outside the detected device", async () => {
  const root = await mkdtemp(join(tmpdir(), "ebook-device-"));
  process.env.EBOOK_DEVICE_ROOTS = root;
  try {
    await createEpub(join(root, "book.epub"));
    const [device] = await listEbookDevices();
    assert.ok(device);
    assert.equal((await resolveDeviceBook(device.id, "book.epub"))?.fileName, "book.epub");
    assert.equal(await resolveDeviceBook(device.id, "../outside.epub"), null);
  } finally {
    delete process.env.EBOOK_DEVICE_ROOTS;
    await rm(root, { recursive: true, force: true });
  }
});

test("parseKfxMetadata reads internal title and author and removes import suffixes", () => {
  const data = Buffer.concat([
    Buffer.from("binary kindle_title_metadata\0book_id\0abc\0author\0"),
    Buffer.from("Pierre Hadot"),
    Buffer.from("\0title\0Ejercicios espirituales y filosofía antigua -- Pierre Hadot -- 2013 -- hash\0is_sample\0kindle_ebook_metadata"),
  ]);
  assert.deepEqual(parseKfxMetadata(data), {
    title: "Ejercicios espirituales y filosofía antigua",
    authors: ["Pierre Hadot"],
  });
});

test("parseKfxMetadata renders underscores as spaces", () => {
  const data = Buffer.from("kindle_title_metadata\0author\0C_S_Lewis\0title\0Mero_Cristianismo\0is_sample\0kindle_ebook_metadata");
  assert.deepEqual(parseKfxMetadata(data), {
    title: "Mero Cristianismo",
    authors: ["C S Lewis"],
  });
});

test("uploadKnownDeviceBook uses the Kindle documents folder and does not overwrite an existing file", async () => {
  const root = await mkdtemp(join(tmpdir(), "ebook-device-"));
  try {
    const booksDirectory = join(root, "Internal Storage", "documents", "Downloads", "Items01");
    await mkdir(booksDirectory, { recursive: true });
    await createEpub(join(booksDirectory, "existing.epub"));
    const device = { id: "kindle", name: "Kindle", root, books: [] };
    const first = await uploadKnownDeviceBook(device, "new.epub", Buffer.from("first"));
    const second = await uploadKnownDeviceBook(device, "new.epub", Buffer.from("second"));
    assert.equal(first.path, "Internal Storage/documents/Downloads/Items01/new.epub");
    assert.equal(second.path, "Internal Storage/documents/Downloads/Items01/new (2).epub");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("uploadKnownDeviceBook rejects unsupported file formats", async () => {
  const root = await mkdtemp(join(tmpdir(), "ebook-device-"));
  try {
    await assert.rejects(
      uploadKnownDeviceBook({ id: "kindle", name: "Kindle", root, books: [] }, "script.exe", Buffer.from("bad")),
      /Formato no compatible/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
