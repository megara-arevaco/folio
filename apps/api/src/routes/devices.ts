import { createReadStream } from "node:fs";
import type { FastifyInstance } from "fastify";
import { attachmentContentDisposition } from "../http";
import { deleteDeviceBook, listEbookDevices, replaceDeviceBook, resolveDeviceBook, uploadDeviceBook } from "../services/devices";
import { prepareKindleUpload } from "../services/kindle";

export async function deviceRoutes(fastify: FastifyInstance) {
  fastify.get("/api/devices", async (_request, reply) => {
    const bridgeUrl = process.env.DEVICE_BRIDGE_URL;
    if (bridgeUrl) {
      try {
        const response = await fetch(`${bridgeUrl}/devices`, { headers: { "X-Device-Bridge-Token": process.env.DEVICE_BRIDGE_TOKEN ?? "epub-translator-local-device-bridge" } });
        if (response.ok) return reply.send(await response.json());
      } catch { /* Fall back to mounts visible inside the API container. */ }
    }
    return reply.send({ ok: true, data: await listEbookDevices() });
  });

  fastify.get("/api/devices/:deviceId/books/download", async (request, reply) => {
    const { deviceId } = request.params as { deviceId: string };
    const { path } = request.query as { path?: string };
    if (!path) return reply.status(400).send({ ok: false, error: "Ruta de libro inválida" });
    const bridgeUrl = process.env.DEVICE_BRIDGE_URL;
    if (bridgeUrl) {
      try {
        const url = `${bridgeUrl}/devices/${encodeURIComponent(deviceId)}/book?path=${encodeURIComponent(path)}`;
        const response = await fetch(url, { headers: { "X-Device-Bridge-Token": process.env.DEVICE_BRIDGE_TOKEN ?? "epub-translator-local-device-bridge" } });
        if (response.ok && response.body) {
          const fileName = decodeURIComponent(response.headers.get("x-file-name") ?? "book.epub").replace(/["\r\n]/g, "-");
          reply.header("Content-Disposition", attachmentContentDisposition(fileName));
          reply.type("application/octet-stream");
          return reply.send(Buffer.from(await response.arrayBuffer()));
        }
      } catch { /* Fall back to a directly mounted device. */ }
    }
    const book = await resolveDeviceBook(deviceId, path);
    if (!book) return reply.status(404).send({ ok: false, error: "Libro no encontrado en el dispositivo" });
    reply.header("Content-Disposition", attachmentContentDisposition(book.fileName));
    reply.type("application/octet-stream");
    return reply.send(createReadStream(book.path));
  });

  fastify.post("/api/devices/:deviceId/books", async (request, reply) => {
    const { deviceId } = request.params as { deviceId: string };
    const upload = await request.file();
    if (!upload) return reply.status(400).send({ ok: false, error: "Selecciona un archivo para enviar" });
    const uploadedData = await upload.toBuffer();
    let prepared: Awaited<ReturnType<typeof prepareKindleUpload>>;
    try {
      prepared = await prepareKindleUpload(uploadedData, upload.filename);
    } catch (error) {
      return reply.status(422).send({ ok: false, error: error instanceof Error ? error.message : "No se ha podido convertir el EPUB" });
    }
    const { data, fileName } = prepared;
    const bridgeUrl = process.env.DEVICE_BRIDGE_URL;
    if (bridgeUrl) {
      try {
        const bridgePayload = new Uint8Array(data.byteLength);
        bridgePayload.set(data);
        const url = `${bridgeUrl}/devices/${encodeURIComponent(deviceId)}/book`;
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-Device-Bridge-Token": process.env.DEVICE_BRIDGE_TOKEN ?? "epub-translator-local-device-bridge",
            "X-File-Name": encodeURIComponent(fileName),
          },
          body: bridgePayload,
        });
        const detail = await response.json().catch(() => null) as { data?: { path: string; fileName: string }; error?: string } | null;
        if (response.ok && detail?.data) return reply.status(201).send({ ok: true, data: detail.data });
        if (response.status === 404) return reply.status(404).send({ ok: false, error: "Dispositivo no encontrado" });
        return reply.status(response.status === 400 ? 400 : 409).send({ ok: false, error: detail?.error ?? "El Kindle ha rechazado el archivo" });
      } catch { /* Fall back to a directly mounted writable device. */ }
    }
    try {
      const result = await uploadDeviceBook(deviceId, fileName, data);
      if (!result) return reply.status(404).send({ ok: false, error: "Dispositivo no encontrado" });
      return reply.status(201).send({ ok: true, data: result });
    } catch (error) {
      return reply.status(409).send({ ok: false, error: error instanceof Error ? error.message : "No se ha podido enviar el archivo" });
    }
  });

  fastify.put("/api/devices/:deviceId/books/content", async (request, reply) => {
    const { deviceId } = request.params as { deviceId: string };
    const { path } = request.query as { path?: string };
    if (!path) return reply.status(400).send({ ok: false, error: "Ruta de libro inválida" });
    const upload = await request.file();
    if (!upload) return reply.status(400).send({ ok: false, error: "Falta el archivo editado" });
    const data = await upload.toBuffer();
    const bridgeUrl = process.env.DEVICE_BRIDGE_URL;
    if (bridgeUrl) {
      try {
        const bridgePayload = new Uint8Array(data.byteLength);
        bridgePayload.set(data);
        const url = `${bridgeUrl}/devices/${encodeURIComponent(deviceId)}/book?path=${encodeURIComponent(path)}`;
        const response = await fetch(url, {
          method: "PUT",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-Device-Bridge-Token": process.env.DEVICE_BRIDGE_TOKEN ?? "epub-translator-local-device-bridge",
          },
          body: bridgePayload,
        });
        if (response.status === 204) return reply.status(204).send();
        if (response.status === 404) return reply.status(404).send({ ok: false, error: "Libro no encontrado en el dispositivo" });
        const detail = await response.json().catch(() => null) as { error?: string } | null;
        return reply.status(409).send({ ok: false, error: detail?.error ?? "El Kindle ha rechazado la sobrescritura" });
      } catch { /* Fall back to a directly mounted writable device. */ }
    }
    try {
      if (await replaceDeviceBook(deviceId, path, data)) return reply.status(204).send();
      return reply.status(404).send({ ok: false, error: "Libro no encontrado en el dispositivo" });
    } catch (error) {
      return reply.status(409).send({ ok: false, error: error instanceof Error ? error.message : "No se ha podido sobrescribir el archivo" });
    }
  });

  fastify.delete("/api/devices/:deviceId/books", async (request, reply) => {
    const { deviceId } = request.params as { deviceId: string };
    const { path } = request.query as { path?: string };
    if (!path) return reply.status(400).send({ ok: false, error: "Ruta de libro inválida" });
    const bridgeUrl = process.env.DEVICE_BRIDGE_URL;
    if (bridgeUrl) {
      try {
        const url = `${bridgeUrl}/devices/${encodeURIComponent(deviceId)}/book?path=${encodeURIComponent(path)}`;
        const response = await fetch(url, { method: "DELETE", headers: { "X-Device-Bridge-Token": process.env.DEVICE_BRIDGE_TOKEN ?? "epub-translator-local-device-bridge" } });
        if (response.status === 204) return reply.status(204).send();
        if (response.status === 404) return reply.status(404).send({ ok: false, error: "Libro no encontrado en el dispositivo" });
        const detail = await response.json().catch(() => null) as { error?: string } | null;
        return reply.status(409).send({ ok: false, error: detail?.error ?? "El Kindle ha rechazado el borrado" });
      } catch { /* Fall back to a directly mounted writable device. */ }
    }
    try {
      if (await deleteDeviceBook(deviceId, path)) return reply.status(204).send();
      return reply.status(404).send({ ok: false, error: "Libro no encontrado en el dispositivo" });
    } catch {
      return reply.status(409).send({ ok: false, error: "No se ha podido borrar el libro del dispositivo" });
    }
  });
}
