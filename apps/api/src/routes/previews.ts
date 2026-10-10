import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import "@fastify/multipart";
import { maxDocumentBytes } from "../services/shared/limits";
import { getProcessingPreflight, previewEpubTranslation, previewPdf } from "../services/previews";
import { AiBudgetExceededError } from "../services/aiBudget";

async function readPreviewUpload(request: FastifyRequest, reply: FastifyReply, extension: ".epub" | ".pdf") {
  const file = await request.file();
  if (!file) {
    reply.status(400).send({ ok: false, error: "Selecciona un archivo para previsualizar" });
    return null;
  }
  if (!file.filename.toLowerCase().endsWith(extension)) {
    reply.status(400).send({ ok: false, error: `Solo se permiten archivos ${extension}` });
    return null;
  }
  const buffer = await file.toBuffer();
  if (file.file.truncated || buffer.byteLength > maxDocumentBytes()) {
    reply.status(413).send({ ok: false, error: "El documento supera el tamaño permitido" });
    return null;
  }
  return { buffer, fileName: file.filename };
}

export async function previewRoutes(fastify: FastifyInstance) {
  fastify.get("/api/preflight", async (_request, reply) => {
    reply.header("Cache-Control", "no-store").send({ ok: true, data: await getProcessingPreflight() });
  });

  fastify.post("/api/previews/epub-translation", async (request, reply) => {
    const upload = await readPreviewUpload(request, reply, ".epub");
    if (!upload) return;
    try {
      const data = await previewEpubTranslation(upload.buffer);
      return reply.header("Cache-Control", "no-store").send({ ok: true, data });
    } catch (error) {
      const status = error instanceof AiBudgetExceededError ? 429 : 422;
      return reply.status(status).send({ ok: false, error: error instanceof Error ? error.message : "No se ha podido preparar la muestra EPUB" });
    }
  });

  fastify.post("/api/previews/pdf-conversion", async (request, reply) => {
    const upload = await readPreviewUpload(request, reply, ".pdf");
    if (!upload) return;
    try {
      const data = await previewPdf(upload.buffer, upload.fileName);
      return reply.header("Cache-Control", "no-store").send({ ok: true, data });
    } catch (error) {
      const status = error instanceof AiBudgetExceededError ? 429 : 422;
      return reply.status(status).send({ ok: false, error: error instanceof Error ? error.message : "No se ha podido preparar la muestra PDF" });
    }
  });
}
