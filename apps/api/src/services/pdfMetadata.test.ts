import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { readPdfMetadata, updatePdfMetadataBuffer } from "./pdfMetadata";

async function createTestPdf(): Promise<Buffer> {
  const document = await PDFDocument.create();
  document.addPage([300, 400]);
  document.setTitle("Original title");
  document.setAuthor("Original author");
  document.setLanguage("en");
  document.setSubject("Original subject");
  return Buffer.from(await document.save());
}

test("readPdfMetadata reads the standard PDF document properties", async () => {
  assert.deepEqual(await readPdfMetadata(await createTestPdf()), {
    title: "Original title",
    authors: ["Original author"],
    language: "en",
    publisher: "",
    description: "Original subject",
  });
});

test("updatePdfMetadataBuffer preserves pages and updates editable properties", async () => {
  const updated = await updatePdfMetadataBuffer(await createTestPdf(), {
    title: "Título actualizado",
    authors: ["Autora Uno", "Autor Dos"],
    language: "es",
    publisher: "Editorial Local",
    description: "Asunto actualizado",
  });

  assert.deepEqual(await readPdfMetadata(updated), {
    title: "Título actualizado",
    authors: ["Autora Uno", "Autor Dos"],
    language: "es",
    publisher: "Editorial Local",
    description: "Asunto actualizado",
  });
  assert.equal((await PDFDocument.load(updated)).getPageCount(), 1);
});
