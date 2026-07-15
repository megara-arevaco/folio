import { FastifyInstance } from "fastify";
import { createJob, persistJobUpload, startJobProcessing } from "../services/jobs";

export async function pdfRoutes(fastify: FastifyInstance) {
  fastify.post("/api/pdf/convert", async (request, reply) => {
    const file = await request.file();

    if (!file) {
      return reply.status(400).send({ ok: false, error: "No se ha enviado ningun archivo" });
    }

    if (!file.filename.endsWith(".pdf")) {
      return reply.status(400).send({ ok: false, error: "Solo se permiten archivos .pdf" });
    }

    const job = createJob(file.filename, "pdf-conversion");
    await persistJobUpload(job, file);
    void startJobProcessing(job.id);

    reply.status(201).send({ ok: true, data: { jobId: job.id } });
  });
}
