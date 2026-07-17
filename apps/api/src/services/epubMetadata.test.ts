import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import AdmZip from "adm-zip";
import { readEpubCover, readEpubMetadata, updateEpubCoverBuffer, updateEpubMetadata } from "./epubMetadata";

async function createTestEpub(): Promise<{ root: string; epubPath: string }> {
  const root = await mkdtemp(join(tmpdir(), "epub-metadata-"));
  const epubPath = join(root, "book.epub");
  const zip = new AdmZip();
  zip.addFile("mimetype", Buffer.from("application/epub+zip"));
  zip.addFile("META-INF/container.xml", Buffer.from(`<?xml version="1.0"?>
    <container><rootfiles><rootfile full-path="EPUB/package.opf" /></rootfiles></container>`));
  zip.addFile("EPUB/package.opf", Buffer.from(`<?xml version="1.0"?>
    <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:identifier>urn:test:book</dc:identifier>
        <dc:title>Original title</dc:title>
        <dc:creator>First author</dc:creator>
        <dc:language>en</dc:language>
      </metadata>
      <manifest />
      <spine />
    </package>`));
  await writeFile(epubPath, zip.toBuffer());
  return { root, epubPath };
}

test("readEpubMetadata resolves the OPF path declared by the container", async () => {
  const { root, epubPath } = await createTestEpub();
  try {
    assert.deepEqual(readEpubMetadata(epubPath), {
      title: "Original title",
      authors: ["First author"],
      language: "en",
      publisher: "",
      description: "",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("updateEpubMetadata persists editable fields without removing other OPF metadata", async () => {
  const { root, epubPath } = await createTestEpub();
  try {
    await updateEpubMetadata(epubPath, {
      title: "Título & edición",
      authors: ["Autora Uno", "Autor Dos"],
      language: "es",
      publisher: "Editorial Local",
      description: "Una descripción <breve>.",
    });

    assert.deepEqual(readEpubMetadata(epubPath), {
      title: "Título & edición",
      authors: ["Autora Uno", "Autor Dos"],
      language: "es",
      publisher: "Editorial Local",
      description: "Una descripción <breve>.",
    });
    assert.match(new AdmZip(epubPath).readAsText("EPUB/package.opf"), /urn:test:book/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("updateEpubMetadata preserves attributes and refinements on retained metadata", async () => {
  const { root, epubPath } = await createTestEpub();
  try {
    const zip = new AdmZip(epubPath);
    zip.updateFile("EPUB/package.opf", Buffer.from(`<?xml version="1.0"?>
      <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
          <dc:identifier>urn:test:book</dc:identifier>
          <dc:title id="main-title" xml:lang="en">Original title</dc:title>
          <meta refines="#main-title" property="title-type">main</meta>
          <dc:creator id="author-1" opf:role="aut" xmlns:opf="http://www.idpf.org/2007/opf">First author</dc:creator>
          <meta refines="#author-1" property="role" scheme="marc:relators">aut</meta>
          <dc:language>en</dc:language>
        </metadata>
        <manifest />
        <spine />
      </package>`));
    await writeFile(epubPath, zip.toBuffer());

    await updateEpubMetadata(epubPath, {
      title: "Título actualizado",
      authors: ["Autora actualizada"],
      language: "es",
      publisher: "",
      description: "",
    });

    assert.deepEqual(readEpubMetadata(epubPath), {
      title: "Título actualizado",
      authors: ["Autora actualizada"],
      language: "es",
      publisher: "",
      description: "",
    });
    const opf = new AdmZip(epubPath).readAsText("EPUB/package.opf");
    assert.match(opf, /<dc:title id="main-title" xml:lang="en">T(?:í|&#xed;)tulo actualizado<\/dc:title>/);
    assert.match(opf, /<meta refines="#main-title" property="title-type">main<\/meta>/);
    assert.match(opf, /<dc:creator id="author-1" opf:role="aut"[^>]*>Autora actualizada<\/dc:creator>/);
    assert.match(opf, /<meta refines="#author-1" property="role" scheme="marc:relators">aut<\/meta>/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("updateEpubCoverBuffer adds a cover when the EPUB does not have one", async () => {
  const { root, epubPath } = await createTestEpub();
  try {
    const original = new AdmZip(epubPath).toBuffer();
    const image = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const updated = updateEpubCoverBuffer(original, { data: image, mediaType: "image/png" });
    const cover = readEpubCover(updated);

    assert.equal(cover?.mediaType, "image/png");
    assert.deepEqual(cover?.data, image);
    const opf = new AdmZip(updated).readAsText("EPUB/package.opf");
    assert.match(opf, /properties="cover-image"/);
    assert.match(opf, /name="cover"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
