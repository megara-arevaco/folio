import Fastify, { type FastifyInstance } from "fastify";
import fastifyMultipart from "@fastify/multipart";
import fastifyCors from "@fastify/cors";
import { translateRoutes } from "./routes/translate";
import { pdfRoutes } from "./routes/pdf";
import { jobsRoutes } from "./routes/jobs";
import { epubMetadataRoutes } from "./routes/epubMetadata";
import { deviceRoutes } from "./routes/devices";
import { readingLogRoutes } from "./routes/readingLog";
import { prepareJobsForShutdown, restoreJobsFromDisk } from "./services/jobs";

export async function createServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });
  const maxUploadMb = Number.parseInt(process.env.MAX_UPLOAD_MB ?? "100", 10);

  await app.register(fastifyCors, {
    origin: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
  });
  await app.register(fastifyMultipart, {
    limits: { fileSize: maxUploadMb * 1024 * 1024 },
  });
  await app.register(translateRoutes);
  await app.register(pdfRoutes);
  await app.register(jobsRoutes);
  await app.register(epubMetadataRoutes);
  await app.register(deviceRoutes);
  await app.register(readingLogRoutes);
  await restoreJobsFromDisk();
  return app;
}

export async function startServer(): Promise<FastifyInstance> {
  const app = await createServer();
  const port = Number.parseInt(process.env.PORT ?? "3001", 10);
  const host = process.env.HOST ?? "0.0.0.0";
  await app.listen({ port, host });
  return app;
}

if (process.env.EPUB_TRANSLATOR_STANDALONE === "true") {
  startServer()
    .then((app) => {
      let stopping = false;
      const shutdown = async () => {
        if (stopping) return;
        stopping = true;
        await prepareJobsForShutdown();
        await app.close();
        process.exit(0);
      };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
