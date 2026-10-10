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
import { settingsRoutes } from "./routes/settings";
import { previewRoutes } from "./routes/previews";
import { prepareJobsForShutdown, restoreJobsFromDisk } from "./services/jobs";
import { acquireFolioInstanceLock, assertNoRestoreJournalPending } from "./services/maintenanceLock";

export async function createServer(): Promise<FastifyInstance> {
  const releaseInstanceLock = await acquireFolioInstanceLock();
  let app: FastifyInstance | undefined;
  try {
    await assertNoRestoreJournalPending();
    app = Fastify({ logger: true });
    app.addHook("onClose", async () => {
      try { await prepareJobsForShutdown(); }
      finally { await releaseInstanceLock(); }
    });
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
    await app.register(settingsRoutes);
    await app.register(previewRoutes);
    const webRoot = resolve("apps/web/dist");
    if (existsSync(webRoot)) {
      await app.register(fastifyStatic, { root: webRoot });
      app.setNotFoundHandler((request, reply) => {
        if (request.url.startsWith("/api/")) return reply.code(404).send({ ok: false, error: "Ruta desconocida" });
        return reply.sendFile("index.html");
      });
    }
    // The instance lock and restore-journal check both precede worker recovery or any data writes.
    await restoreJobsFromDisk();
    return app;
  } catch (error) {
    if (app) await app.close().catch(() => undefined);
    await releaseInstanceLock().catch(() => undefined);
    throw error;
  }
}

export async function startServer(): Promise<FastifyInstance> {
  const app = await createServer();
  const port = Number.parseInt(process.env.PORT ?? "3001", 10);
  const host = process.env.HOST ?? "127.0.0.1";
  try {
    await app.listen({ port, host });
    return app;
  } catch (error) {
    await app.close().catch(() => undefined);
    throw error;
  }
}
