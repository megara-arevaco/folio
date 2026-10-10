import { normalizeEpubMetadata } from "../../../../packages/contracts/src";
import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import { FastifyInstance } from "fastify";
import { archiveCompletedJobs, createJobRevision, deleteCompletedJobs, deleteJob, getJobRevisionPath, withJobOperation, getJob, listJobRevisions, listJobs, pauseActiveJobs, pauseJob, renameJobOutput, reorderQueuedJob, restoreJobRevision, resumeJob, serializeJob, setJobArchived, setJobGlossary, startQueuedJob } from "../services/jobs";
import { readEpubCover, readEpubMetadata, updateEpubCover, updateEpubMetadata } from "../services/epubMetadata";
import { fileOperations } from "../services/shared/files";
import type { GlossaryEntry } from "../types";
import { once } from "node:events";
import { attachmentContentDisposition } from "../http";

export async function jobsRoutes(fastify: FastifyInstance) {
  fastify.addHook("preValidation", async (request, reply) => {
    const { jobId } = request.params as { jobId?: unknown };
    if (jobId !== undefined && (typeof jobId !== "string" || !/^[a-zA-Z0-9_-]{1,240}$/.test(jobId))) {
      return reply.status(400).send({ ok: false, error: "Identificador de trabajo inválido" });
    }
  });
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
    return withJobOperation(jobId, async () => {
      const job = getJob(jobId);
      if (!job) return reply.status(404).send({ ok: false, error: "Trabajo no encontrado" });
      if (job.status !== "done" || !job.outputFileName) {
        return reply.status(409).send({ ok: false, error: "El resultado EPUB aún no está disponible para editar" });
      }

      reply.send({ ok: true, data: readEpubMetadata(job.outputFilePath) });
    });
  });

  fastify.patch("/api/jobs/:jobId/metadata", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    return withJobOperation(jobId, async () => {
      const job = getJob(jobId);
      if (!job) return reply.status(404).send({ ok: false, error: "Trabajo no encontrado" });
      if (job.status !== "done" || !job.outputFileName) {
        return reply.status(409).send({ ok: false, error: "El resultado EPUB aún no está disponible para editar" });
      }

      const metadata = normalizeEpubMetadata(request.body);
      if (!metadata) {
        return reply.status(400).send({ ok: false, error: "Metadatos inválidos: el título y el idioma son obligatorios" });
      }
      await createJobRevision(job);
      await updateEpubMetadata(job.outputFilePath, metadata);
      reply.send({ ok: true, data: metadata });
    });
  });

  fastify.get("/api/jobs/:jobId/metadata/cover", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    return withJobOperation(jobId, async () => {
      const job = getJob(jobId);
      if (!job) return reply.status(404).send({ ok: false, error: "Trabajo no encontrado" });
      if (job.status !== "done") return reply.status(409).send({ ok: false, error: "El EPUB aún no está disponible" });
      const cover = readEpubCover(job.outputFilePath);
      if (!cover) return reply.status(404).send({ ok: false, error: "El EPUB no tiene portada" });
      reply.type(cover.mediaType);
      return reply.send(cover.data);
    });
  });

  fastify.put("/api/jobs/:jobId/metadata/cover", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    return withJobOperation(jobId, async () => {
      const job = getJob(jobId);
      if (!job) return reply.status(404).send({ ok: false, error: "Trabajo no encontrado" });
      if (job.status !== "done") return reply.status(409).send({ ok: false, error: "El EPUB aún no está disponible" });
      const upload = await request.file();
      const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
      if (!upload || !allowed.has(upload.mimetype)) return reply.status(400).send({ ok: false, error: "La portada debe ser JPEG, PNG o WebP" });
      await createJobRevision(job);
      await updateEpubCover(job.outputFilePath, { data: await upload.toBuffer(), mediaType: upload.mimetype });
      reply.status(204).send();
    });
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

  fastify.get("/api/jobs/:jobId/original/download", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    return withJobOperation(jobId, async () => {
      const job = getJob(jobId);
      if (!job) return reply.status(404).send({ ok: false, error: "Trabajo no encontrado" });
      try { await access(job.inputFilePath); }
      catch { return reply.status(404).send({ ok: false, error: "El archivo original ya no está disponible" }); }
      reply.header("Content-Disposition", attachmentContentDisposition(job.inputFileName));
      reply.type(job.kind === "pdf-conversion" ? "application/pdf" : "application/epub+zip");
      const stream = createReadStream(job.inputFilePath);
      await once(stream, "open");
      return reply.send(stream);
    });
  });

  fastify.get("/api/jobs/:jobId/revisions", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = getJob(jobId);
    if (!job) return reply.status(404).send({ ok: false, error: "Trabajo no encontrado" });
    if (job.status !== "done") return reply.status(409).send({ ok: false, error: "El EPUB aún no está disponible" });
    reply.header("Cache-Control", "no-store").send({ ok: true, data: await listJobRevisions(job) });
  });

  fastify.get("/api/jobs/:jobId/revisions/:revisionId/download", async (request, reply) => {
    const { jobId, revisionId } = request.params as { jobId: string; revisionId: string };
    const job = getJob(jobId);
    if (!job) return reply.status(404).send({ ok: false, error: "Trabajo no encontrado" });
    const revisionPath = getJobRevisionPath(job, revisionId);
    if (!revisionPath) return reply.status(400).send({ ok: false, error: "Versión inválida" });
    try { await access(revisionPath); }
    catch { return reply.status(404).send({ ok: false, error: "Versión no encontrada" }); }
    reply.header("Content-Disposition", attachmentContentDisposition(`${revisionId}.epub`));
    reply.type("application/epub+zip");
    const stream = createReadStream(revisionPath);
    await once(stream, "open");
    return reply.send(stream);
  });

  fastify.post("/api/jobs/:jobId/revisions/:revisionId/restore", async (request, reply) => {
    const { jobId, revisionId } = request.params as { jobId: string; revisionId: string };
    return withJobOperation(jobId, async () => {
      const job = getJob(jobId);
      if (!job) return reply.status(404).send({ ok: false, error: "Trabajo no encontrado" });
      const restored = await fileOperations.run(job.outputFilePath, () => restoreJobRevision(job, revisionId));
      if (!restored) return reply.status(404).send({ ok: false, error: "No se ha podido restaurar esa versión" });
      reply.send({ ok: true, data: { restored: true } });
    });
  });

  fastify.get("/api/jobs/:jobId/glossary", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = getJob(jobId);
    if (!job) return reply.status(404).send({ ok: false, error: "Trabajo no encontrado" });
    if (job.kind !== "epub-translation") return reply.status(409).send({ ok: false, error: "Este trabajo no usa glosario" });
    reply.header("Cache-Control", "no-store").send({ ok: true, data: job.glossary });
  });

  fastify.put("/api/jobs/:jobId/glossary", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const glossary = (request.body as { glossary?: unknown } | null)?.glossary;
    if (!Array.isArray(glossary)) return reply.status(400).send({ ok: false, error: "El glosario no es válido" });
    const result = await withJobOperation(jobId, () => setJobGlossary(jobId, glossary as GlossaryEntry[]));
    if (result === "missing") return reply.status(404).send({ ok: false, error: "Trabajo no encontrado" });
    if (result === "not-editable") return reply.status(409).send({ ok: false, error: "Pausa el trabajo; el glosario solo se edita antes de reanudar" });
    if (result === "invalid") return reply.status(400).send({ ok: false, error: "Cada término debe tener origen y traducción; máximo 100 entradas" });
    reply.send({ ok: true, data: result.glossary });
  });

  fastify.get("/api/jobs/:jobId/download", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    return withJobOperation(jobId, async () => {
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
      const stream = createReadStream(job.outputFilePath);
      await once(stream, "open");
      return reply.send(stream);
    });
  });

  fastify.post("/api/jobs/completed/archive", async (_request, reply) => {
    const archived = await archiveCompletedJobs();
    reply.send({ ok: true, data: { archived } });
  });

  fastify.patch("/api/jobs/:jobId/archive", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const archived = (request.body as { archived?: unknown } | null)?.archived;
    if (typeof archived !== "boolean") return reply.status(400).send({ ok: false, error: "Estado de archivo inválido" });
    const result = await setJobArchived(jobId, archived);
    if (result === "missing") return reply.status(404).send({ ok: false, error: "Trabajo no encontrado" });
    if (result === "not-ready") return reply.status(409).send({ ok: false, error: "Solo se pueden archivar resultados completados" });
    reply.send({ ok: true, data: serializeJob(result) });
  });

  fastify.delete("/api/jobs/completed", async (request, reply) => {
    const confirmation = request.headers["x-folio-confirm"] ?? (request.body as { confirmation?: unknown } | null)?.confirmation;
    if (confirmation !== "DELETE COMPLETED JOBS") {
      return reply.status(409).send({ ok: false, error: "Esta ruta masiva es heredada y destructiva. Usa Archivar resultados listos; para borrado permanente se requiere la confirmación explícita DELETE COMPLETED JOBS." });
    }
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
    const { position } = (request.body ?? {}) as { position?: unknown };
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
