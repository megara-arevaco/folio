import { createReadStream } from "node:fs";
import { FastifyInstance } from "fastify";
import { deleteCompletedJobs, deleteJob, getJob, listJobs, pauseActiveJobs, pauseJob, renameJobOutput, reorderQueuedJob, resumeJob, serializeJob, startQueuedJob } from "../services/jobs";
import { readEpubCover, readEpubMetadata, updateEpubCoverBuffer, updateEpubMetadata, type EpubMetadata } from "../services/epubMetadata";
import { writeFile } from "node:fs/promises";
import { attachmentContentDisposition } from "../http";

export async function jobsRoutes(fastify: FastifyInstance) {
  fastify.get("/api/jobs", async (_request, reply) => {
    reply.send({ ok: true, data: listJobs().map(serializeJob) });
  });

  fastify.get("/api/jobs/:jobId", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = getJob(jobId);

    if (!job) {
      return reply.status(404).send({ ok: false, error: "Trabajo no encontrado" });
    }

    reply.send({ ok: true, data: serializeJob(job) });
  });

  fastify.get("/api/jobs/:jobId/metadata", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = getJob(jobId);
    if (!job) return reply.status(404).send({ ok: false, error: "Trabajo no encontrado" });
    if (job.kind !== "epub-translation" || job.status !== "done" || !job.outputFileName) {
      return reply.status(409).send({ ok: false, error: "La traducción aún no tiene un EPUB editable" });
    }

    reply.send({ ok: true, data: readEpubMetadata(job.outputFilePath) });
  });

  fastify.patch("/api/jobs/:jobId/metadata", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = getJob(jobId);
    if (!job) return reply.status(404).send({ ok: false, error: "Trabajo no encontrado" });
    if (job.kind !== "epub-translation" || job.status !== "done" || !job.outputFileName) {
      return reply.status(409).send({ ok: false, error: "La traducción aún no tiene un EPUB editable" });
    }

    const body = request.body as Partial<EpubMetadata> | null;
    if (!body || typeof body.title !== "string" || !Array.isArray(body.authors) ||
      !body.authors.every((author) => typeof author === "string") ||
      typeof body.language !== "string" || typeof body.publisher !== "string" ||
      typeof body.description !== "string") {
      return reply.status(400).send({ ok: false, error: "Metadatos inválidos" });
    }

    const metadata: EpubMetadata = {
      title: body.title.trim(),
      authors: body.authors.map((author) => author.trim()).filter(Boolean),
      language: body.language.trim(),
      publisher: body.publisher.trim(),
      description: body.description.trim(),
    };
    if (!metadata.title || !metadata.language) {
      return reply.status(400).send({ ok: false, error: "El título y el idioma son obligatorios" });
    }
    await updateEpubMetadata(job.outputFilePath, metadata);
    reply.send({ ok: true, data: metadata });
  });

  fastify.get("/api/jobs/:jobId/metadata/cover", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = getJob(jobId);
    if (!job) return reply.status(404).send({ ok: false, error: "Trabajo no encontrado" });
    if (job.kind !== "epub-translation" || job.status !== "done") return reply.status(409).send({ ok: false, error: "El EPUB aún no está disponible" });
    const cover = readEpubCover(job.outputFilePath);
    if (!cover) return reply.status(404).send({ ok: false, error: "El EPUB no tiene portada" });
    reply.type(cover.mediaType);
    return reply.send(cover.data);
  });

  fastify.put("/api/jobs/:jobId/metadata/cover", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = getJob(jobId);
    if (!job) return reply.status(404).send({ ok: false, error: "Trabajo no encontrado" });
    if (job.kind !== "epub-translation" || job.status !== "done") return reply.status(409).send({ ok: false, error: "El EPUB aún no está disponible" });
    const upload = await request.file();
    const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
    if (!upload || !allowed.has(upload.mimetype)) return reply.status(400).send({ ok: false, error: "La portada debe ser JPEG, PNG o WebP" });
    const updated = updateEpubCoverBuffer(job.outputFilePath, { data: await upload.toBuffer(), mediaType: upload.mimetype });
    await writeFile(job.outputFilePath, updated);
    reply.status(204).send();
  });

  fastify.patch("/api/jobs/:jobId/metadata/filename", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const { fileName } = (request.body ?? {}) as { fileName?: unknown };
    if (typeof fileName !== "string") return reply.status(400).send({ ok: false, error: "Nombre de archivo inválido" });
    const result = await renameJobOutput(jobId, fileName);
    if (result === "missing") return reply.status(404).send({ ok: false, error: "Trabajo no encontrado" });
    if (result === "not-ready") return reply.status(409).send({ ok: false, error: "El EPUB aún no está disponible" });
    if (result === "exists") return reply.status(409).send({ ok: false, error: "Ya existe un EPUB con ese nombre" });
    if (result === "invalid") return reply.status(400).send({ ok: false, error: "Nombre de archivo inválido" });
    reply.send({ ok: true, data: { fileName: result.outputFileName } });
  });

  fastify.get("/api/jobs/:jobId/download", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = getJob(jobId);

    if (!job) {
      return reply.status(404).send({ ok: false, error: "Trabajo no encontrado" });
    }

    if (job.status !== "done" || !job.outputFileName) {
      return reply.status(409).send({ ok: false, error: "El trabajo aun no esta listo" });
    }

    reply.header(
      "Content-Disposition",
      attachmentContentDisposition(job.outputFileName),
    );
    reply.type("application/epub+zip");
    return reply.send(createReadStream(job.outputFilePath));
  });

  fastify.delete("/api/jobs/completed", async (_request, reply) => {
    const deleted = await deleteCompletedJobs();
    reply.send({ ok: true, data: { deleted } });
  });

  fastify.delete("/api/jobs/:jobId", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const result = await deleteJob(jobId);

    if (result === "missing") {
      return reply.status(404).send({ ok: false, error: "Trabajo no encontrado" });
    }
    if (result === "processing") {
      return reply.status(409).send({ ok: false, error: "Pausa el trabajo antes de borrarlo" });
    }
    reply.status(204).send();
  });

  fastify.patch("/api/jobs/:jobId/queue", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const { position } = request.body as { position?: unknown };
    if (!Number.isInteger(position) || (position as number) < 0) {
      return reply.status(400).send({ ok: false, error: "Posición de cola inválida" });
    }

    const result = await reorderQueuedJob(jobId, position as number);
    if (result === "missing") {
      return reply.status(404).send({ ok: false, error: "Trabajo no encontrado" });
    }
    if (result === "not-queued") {
      return reply.status(409).send({ ok: false, error: "Solo se pueden reordenar trabajos en cola" });
    }
    reply.send({ ok: true, data: serializeJob(result) });
  });

  fastify.post("/api/jobs/:jobId/pause", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = pauseJob(jobId);

    if (!job) {
      return reply.status(404).send({ ok: false, error: "Trabajo no encontrado" });
    }

    reply.send({ ok: true, data: serializeJob(job) });
  });

  fastify.post("/api/jobs/pause-active", async (_request, reply) => {
    await pauseActiveJobs();
    reply.status(204).send();
  });

  fastify.post("/api/jobs/:jobId/start", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const result = await startQueuedJob(jobId);
    if (result === "missing") {
      return reply.status(404).send({ ok: false, error: "Trabajo no encontrado" });
    }
    if (result === "not-queued") {
      return reply.status(409).send({ ok: false, error: "Solo se pueden iniciar trabajos en cola" });
    }
    reply.send({ ok: true, data: serializeJob(result) });
  });

  fastify.post("/api/jobs/:jobId/resume", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = resumeJob(jobId);

    if (!job) {
      return reply.status(404).send({ ok: false, error: "Trabajo no encontrado" });
    }

    reply.send({ ok: true, data: serializeJob(job) });
  });
}
