import { fetchWithDeadline, readBoundedBody, readBoundedJson } from "../services/shared/network";
import { maxDocumentBytes } from "../services/shared/limits";
import { normalizeEpubMetadata } from "../../../../packages/contracts/src";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { attachmentContentDisposition } from "../http";
import { readEpubCover, readEpubMetadata, updateEpubCoverBuffer, updateEpubMetadataBuffer, type EpubMetadata } from "../services/epubMetadata";
import { readPdfMetadata, updatePdfMetadataBuffer } from "../services/pdfMetadata";

type EditableFormat = "epub" | "pdf";

function editableFormat(fileName: string): EditableFormat | null {
  const normalized = fileName.toLowerCase();
  if (normalized.endsWith(".epub")) return "epub";
  if (normalized.endsWith(".pdf")) return "pdf";
  return null;
}

function isPdfBuffer(buffer: Buffer): boolean {
  return buffer.subarray(0, 1024).includes(Buffer.from("%PDF-"));
}

function pdfErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/firma|signature/i.test(message)) {
    return "No se puede editar un PDF firmado porque el cambio invalidaría su firma digital";
  }
  return /encrypt/i.test(message)
    ? "No se pueden editar los metadatos de un PDF cifrado o protegido"
    : "No se han podido leer los metadatos del PDF";
}

function parseMetadata(value: unknown, requireLanguage: boolean): EpubMetadata | null {
  if (typeof value !== "string") return null;
  try {
    return normalizeEpubMetadata(JSON.parse(value), requireLanguage);
  } catch {
    return null;
  }
}

async function readMetadata(request: FastifyRequest, reply: FastifyReply) {
  const upload = await request.file();
  const format = upload ? editableFormat(upload.filename) : null;
  if (!upload || !format) {
    return reply.status(400).send({ ok: false, error: "Selecciona un archivo EPUB o PDF válido" });
  }

  const buffer = await upload.toBuffer();
  if (format === "pdf") {
    if (!isPdfBuffer(buffer)) return reply.status(400).send({ ok: false, error: "El archivo no contiene un PDF válido" });
    try {
      return reply.send({
        ok: true,
        data: { ...await readPdfMetadata(buffer), format, coverDataUrl: null },
      });
    } catch (error) {
      return reply.status(422).send({ ok: false, error: pdfErrorMessage(error) });
    }
  }

  const cover = readEpubCover(buffer);
  return reply.send({
    ok: true,
    data: {
      ...readEpubMetadata(buffer),
      format,
      coverDataUrl: cover ? `data:${cover.mediaType};base64,${cover.data.toString("base64")}` : null,
    },
  });
}

async function updateMetadata(request: FastifyRequest, reply: FastifyReply) {
  let document: { buffer: Buffer; filename: string } | null = null;
  let cover: { data: Buffer; mediaType: string } | null = null;
  let rawMetadata: unknown = null;
  for await (const part of request.parts()) {
    if (part.type === "field" && part.fieldname === "metadata") rawMetadata = part.value;
    if (part.type === "file" && part.fieldname === "file") document = { buffer: await part.toBuffer(), filename: part.filename };
    if (part.type === "file" && part.fieldname === "cover") cover = { data: await part.toBuffer(), mediaType: part.mimetype };
  }

  const format = document ? editableFormat(document.filename) : null;
  if (!document || !format) {
    return reply.status(400).send({ ok: false, error: "Selecciona un archivo EPUB o PDF válido" });
  }
  const metadata = parseMetadata(rawMetadata, format === "epub");
  if (!metadata) {
    return reply.status(400).send({
      ok: false,
      error: format === "epub" ? "El título y el idioma son obligatorios" : "El título es obligatorio",
    });
  }

  if (format === "pdf") {
    if (cover) return reply.status(400).send({ ok: false, error: "Los PDF no admiten una portada independiente" });
    if (!isPdfBuffer(document.buffer)) return reply.status(400).send({ ok: false, error: "El archivo no contiene un PDF válido" });
    let updated: Buffer;
    try {
      updated = await updatePdfMetadataBuffer(document.buffer, metadata);
    } catch (error) {
      return reply.status(422).send({ ok: false, error: pdfErrorMessage(error) });
    }
    reply.header("Content-Disposition", attachmentContentDisposition(document.filename));
    reply.type("application/pdf");
    return reply.send(updated);
  }

  let updated = updateEpubMetadataBuffer(document.buffer, metadata);
  if (cover) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(cover.mediaType)) {
      return reply.status(400).send({ ok: false, error: "La portada debe ser JPEG, PNG o WebP" });
    }
    updated = updateEpubCoverBuffer(updated, cover);
  }
  reply.header("Content-Disposition", attachmentContentDisposition(document.filename));
  reply.type("application/epub+zip");
  return reply.send(updated);
}

export async function epubMetadataRoutes(fastify: FastifyInstance) {
  fastify.post("/api/files/local/open", async (_request, reply) => {
    const bridgeUrl = process.env.DEVICE_BRIDGE_URL;
    if (!bridgeUrl) return reply.status(503).send({ ok: false, error: "El selector local no está disponible" });
    try {
      const response = await fetchWithDeadline(`${bridgeUrl}/local-file/open`, {
        method: "POST",
        headers: { "X-Device-Bridge-Token": process.env.DEVICE_BRIDGE_TOKEN ?? "folio-local-device-bridge" },
      }, 10 * 60 * 1000);
      if (response.status === 204) return reply.status(204).send();
      if (!response.ok) return reply.status(502).send({ ok: false, error: "No se ha podido abrir el selector local" });
      const fileId = response.headers.get("x-local-file-id");
      const fileName = decodeURIComponent(response.headers.get("x-file-name") ?? "book.epub").replace(/["\r\n]/g, "-");
      if (!fileId) return reply.status(502).send({ ok: false, error: "El selector local no ha devuelto un archivo válido" });
      reply.header("X-Local-File-Id", fileId);
      reply.header("X-File-Name", encodeURIComponent(fileName));
      reply.type("application/octet-stream");
      return reply.send(Buffer.from(await readBoundedBody(response, maxDocumentBytes())));
    } catch {
      return reply.status(503).send({ ok: false, error: "El puente de archivos local no está disponible" });
    }
  });

  fastify.put("/api/files/local/:fileId", async (request, reply) => {
    const { fileId } = request.params as { fileId: string };
    const upload = await request.file();
    if (!upload) return reply.status(400).send({ ok: false, error: "Falta el archivo editado" });
    const bridgeUrl = process.env.DEVICE_BRIDGE_URL;
    if (!bridgeUrl) return reply.status(503).send({ ok: false, error: "La escritura local no está disponible" });
    try {
      const data = await upload.toBuffer();
      const payload = new Uint8Array(data.byteLength);
      payload.set(data);
      const response = await fetchWithDeadline(`${bridgeUrl}/local-file/${encodeURIComponent(fileId)}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Device-Bridge-Token": process.env.DEVICE_BRIDGE_TOKEN ?? "folio-local-device-bridge",
        },
        body: payload,
      });
      if (response.status === 204) return reply.status(204).send();
      if (response.status === 404) return reply.status(410).send({ ok: false, error: "El permiso temporal del archivo ha caducado; vuelve a abrirlo" });
      return reply.status(409).send({ ok: false, error: "No se ha podido sobrescribir el archivo local" });
    } catch {
      return reply.status(503).send({ ok: false, error: "El puente de archivos local no está disponible" });
    }
  });

  fastify.post("/api/files/metadata/read", readMetadata);
  fastify.post("/api/files/metadata/update", updateMetadata);
  fastify.post("/api/epub/metadata/read", readMetadata);
  fastify.post("/api/epub/metadata/update", updateMetadata);
}
