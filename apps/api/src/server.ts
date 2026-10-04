import "./environment";
import { integerSetting } from "./services/shared/limits";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyMultipart from "@fastify/multipart";
import fastifyCors from "@fastify/cors";
import { translateRoutes } from "./routes/translate";
import { pdfRoutes } from "./routes/pdf";
import { jobsRoutes } from "./routes/jobs";
import { epubMetadataRoutes, type LocalFiles } from "./routes/epubMetadata";
import { deviceRoutes } from "./routes/devices";
import { readingLogRoutes } from "./routes/readingLog";
import { prepareJobsForShutdown, restoreJobsFromDisk } from "./services/jobs";

export async function createServer(options: { localFiles?: LocalFiles } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: true, forceCloseConnections: options.localFiles ? true : false });
  const maxUploadMb = integerSetting("MAX_UPLOAD_MB", 100, 1, 1024);

  await app.register(fastifyCors, {
    origin: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
    exposedHeaders: ["X-Local-File-Id", "X-File-Name", "Content-Disposition"],
  });
  await app.register(fastifyMultipart, {
    limits: { fileSize: maxUploadMb * 1024 * 1024, files: 2, fields: 10, parts: 12 },
  });
  await app.register(translateRoutes);
  await app.register(pdfRoutes);
  await app.register(jobsRoutes);
  await app.register(epubMetadataRoutes, { localFiles: options.localFiles });
  await app.register(deviceRoutes);
  await app.register(readingLogRoutes);
  await restoreJobsFromDisk();
  app.addHook("onClose", prepareJobsForShutdown);
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
