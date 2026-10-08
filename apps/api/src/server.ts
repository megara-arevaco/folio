import "./environment";
import { integerSetting } from "./services/shared/limits";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyMultipart from "@fastify/multipart";
import fastifyCors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { translateRoutes } from "./routes/translate";
import { pdfRoutes } from "./routes/pdf";
import { jobsRoutes } from "./routes/jobs";
import { epubMetadataRoutes } from "./routes/epubMetadata";
import { deviceRoutes } from "./routes/devices";
import { readingLogRoutes } from "./routes/readingLog";
import { prepareJobsForShutdown, restoreJobsFromDisk } from "./services/jobs";

export async function createServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });
  const maxUploadMb = integerSetting("MAX_UPLOAD_MB", 100, 1, 1024);
  const allowedOrigins = (process.env.FOLIO_ALLOWED_ORIGINS ?? "").split(",").map(origin => origin.trim()).filter(Boolean);

  await app.register(fastifyCors, {
    origin: allowedOrigins,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
    exposedHeaders: ["X-Local-File-Id", "X-File-Name", "Content-Disposition"],
  });
  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && origin !== `${request.protocol}://${request.headers.host}` && !allowedOrigins.includes(origin)) {
      return reply.code(403).send({ ok: false, error: "Origen no autorizado" });
    }
  });
  await app.register(fastifyMultipart, {
    limits: { fileSize: maxUploadMb * 1024 * 1024, files: 2, fields: 10, parts: 12 },
  });
  await app.register(translateRoutes);
  await app.register(pdfRoutes);
  await app.register(jobsRoutes);
  await app.register(epubMetadataRoutes);
  await app.register(deviceRoutes);
  await app.register(readingLogRoutes);
  await restoreJobsFromDisk();
  app.addHook("onClose", prepareJobsForShutdown);
  const webRoot = resolve("apps/web/dist");
  if (existsSync(webRoot)) {
    await app.register(fastifyStatic, { root: webRoot });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) return reply.code(404).send({ ok: false, error: "Ruta desconocida" });
      return reply.sendFile("index.html");
    });
  }
  return app;
}

export async function startServer(): Promise<FastifyInstance> {
  const app = await createServer();
  const port = Number.parseInt(process.env.PORT ?? "3001", 10);
  const host = process.env.HOST ?? "127.0.0.1";
  await app.listen({ port, host });
  return app;
}
