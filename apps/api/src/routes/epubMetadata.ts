import type { FastifyInstance } from "fastify";
import { readEpubCover, readEpubMetadata, updateEpubCoverBuffer, updateEpubMetadataBuffer, type EpubMetadata } from "../services/epubMetadata";

function parseMetadata(value: unknown): EpubMetadata | null {
  if (typeof value !== "string") return null;
  try {
    const metadata = JSON.parse(value) as Partial<EpubMetadata>;
    if (typeof metadata.title !== "string" || !Array.isArray(metadata.authors) ||
      !metadata.authors.every((author) => typeof author === "string") ||
      typeof metadata.language !== "string" || typeof metadata.publisher !== "string" ||
      typeof metadata.description !== "string") return null;
    const normalized = {
      title: metadata.title.trim(),
      authors: metadata.authors.map((author) => author.trim()).filter(Boolean),
      language: metadata.language.trim(),
      publisher: metadata.publisher.trim(),
      description: metadata.description.trim(),
    };
    return normalized.title && normalized.language ? normalized : null;
  } catch {
    return null;
  }
}

export async function epubMetadataRoutes(fastify: FastifyInstance) {
  fastify.post("/api/epub/metadata/read", async (request, reply) => {
    const upload = await request.file();
    if (!upload || !upload.filename.toLowerCase().endsWith(".epub")) {
      return reply.status(400).send({ ok: false, error: "Selecciona un archivo EPUB válido" });
    }
    const buffer = await upload.toBuffer();
    const cover = readEpubCover(buffer);
    reply.send({
      ok: true,
      data: {
        ...readEpubMetadata(buffer),
        coverDataUrl: cover ? `data:${cover.mediaType};base64,${cover.data.toString("base64")}` : null,
      },
    });
  });

  fastify.post("/api/epub/metadata/update", async (request, reply) => {
    let epub: { buffer: Buffer; filename: string } | null = null;
    let cover: { data: Buffer; mediaType: string } | null = null;
    let rawMetadata: unknown = null;
    for await (const part of request.parts()) {
      if (part.type === "field" && part.fieldname === "metadata") rawMetadata = part.value;
      if (part.type === "file" && part.fieldname === "file") epub = { buffer: await part.toBuffer(), filename: part.filename };
      if (part.type === "file" && part.fieldname === "cover") cover = { data: await part.toBuffer(), mediaType: part.mimetype };
    }
    if (!epub || !epub.filename.toLowerCase().endsWith(".epub")) {
      return reply.status(400).send({ ok: false, error: "Selecciona un archivo EPUB válido" });
    }
    const metadata = parseMetadata(rawMetadata);
    if (!metadata) {
      return reply.status(400).send({ ok: false, error: "El título y el idioma son obligatorios" });
    }

    let updated = updateEpubMetadataBuffer(epub.buffer, metadata);
    if (cover) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(cover.mediaType)) {
        return reply.status(400).send({ ok: false, error: "La portada debe ser JPEG, PNG o WebP" });
      }
      updated = updateEpubCoverBuffer(updated, cover);
    }
    const safeName = epub.filename.replace(/["\r\n]/g, "-");
    reply.header("Content-Disposition", `attachment; filename="${safeName}"`);
    reply.type("application/epub+zip");
    return reply.send(updated);
  });
}
