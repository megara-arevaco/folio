import { FastifyInstance } from "fastify";
import { createJob, persistJobUpload, startJobProcessing, deleteJob } from "../services/jobs";

export async function translateRoutes(fastify: FastifyInstance) {
  fastify.post("/api/translate", async (request, reply) => {
    const file = await request.file();

    if (!file) {
      return reply.status(400).send({ ok: false, error: "No se ha enviado ningun archivo" });
    }

    if (!file.filename.toLowerCase().endsWith(".epub")) {
      return reply.status(400).send({ ok: false, error: "Solo se permiten archivos .epub" });
    }

    const job = createJob(file.filename, "epub-translation");
    try {
      await persistJobUpload(job, file);
      await startJobProcessing(job.id);
    } catch (error) {
      await deleteJob(job.id);
      throw error;
    }

    reply.status(201).send({ ok: true, data: { jobId: job.id } });
  });
}
