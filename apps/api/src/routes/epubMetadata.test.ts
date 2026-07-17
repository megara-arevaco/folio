import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import fastifyMultipart from "@fastify/multipart";
import { PDFDocument } from "pdf-lib";
import { epubMetadataRoutes } from "./epubMetadata";
import { readPdfMetadata } from "../services/pdfMetadata";

function multipartBody(
  fields: Array<{ name: string; value: string }>,
  file: { name: string; type: string; data: Buffer },
): { boundary: string; body: Buffer } {
  const boundary = "----epub-translator-test-boundary";
  const chunks: Buffer[] = [];
  for (const field of fields) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field.name}"\r\n\r\n${field.value}\r\n`));
  }
  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`));
  chunks.push(file.data, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { boundary, body: Buffer.concat(chunks) };
}

async function createPdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  pdf.setTitle("Original");
  return Buffer.from(await pdf.save());
}

test("generic metadata routes read and return an edited PDF copy", async () => {
  const app = Fastify();
  await app.register(fastifyMultipart);
  await app.register(epubMetadataRoutes);
  try {
    const original = await createPdf();
    const readRequest = multipartBody([], { name: "book.PDF", type: "application/pdf", data: original });
    const readResponse = await app.inject({
      method: "POST",
      url: "/api/files/metadata/read",
      headers: { "content-type": `multipart/form-data; boundary=${readRequest.boundary}` },
      payload: readRequest.body,
    });
    assert.equal(readResponse.statusCode, 200);
    assert.equal(readResponse.json().data.format, "pdf");
    assert.equal(readResponse.json().data.title, "Original");

    const metadata = {
      title: "Título nuevo",
      authors: ["Autora"],
      language: "es",
      publisher: "Editorial",
      description: "Descripción",
    };
    const updateRequest = multipartBody(
      [{ name: "metadata", value: JSON.stringify(metadata) }],
      { name: "book.pdf", type: "application/pdf", data: original },
    );
    const updateResponse = await app.inject({
      method: "POST",
      url: "/api/files/metadata/update",
      headers: { "content-type": `multipart/form-data; boundary=${updateRequest.boundary}` },
      payload: updateRequest.body,
    });
    assert.equal(updateResponse.statusCode, 200);
    assert.match(updateResponse.headers["content-type"] ?? "", /^application\/pdf/);
    assert.deepEqual(await readPdfMetadata(updateResponse.rawPayload), metadata);
  } finally {
    await app.close();
  }
});
