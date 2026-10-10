import { parsePublicDevices } from "../../../../packages/contracts/src/devices";
import { fetchWithDeadline, readBoundedBody, readBoundedJson } from "../services/shared/network";
import { maxDocumentBytes } from "../services/shared/limits";
import { createReadStream } from "node:fs";
import type { FastifyInstance } from "fastify";
import { attachmentContentDisposition } from "../http";
import { deleteDeviceBook, listEbookDevices, replaceDeviceBook, resolveDeviceBook, uploadDeviceBook } from "../services/devices";
import { prepareKindleUpload } from "../services/kindle";

export async function deviceRoutes(fastify: FastifyInstance) {
  fastify.addHook("preValidation", async (request, reply) => {
    const { deviceId } = request.params as { deviceId?: unknown };
    const { path } = request.query as { path?: unknown };
    if (deviceId !== undefined && (typeof deviceId !== "string" || !/^[a-zA-Z0-9_-]{1,240}$/.test(deviceId)) ||
      path !== undefined && (typeof path !== "string" || !path || path.length > 4096 || path.includes("\0"))) {
      return reply.status(400).send({ ok: false, error: "Dispositivo o ruta inválidos" });
    }
  });
  fastify.get("/api/devices/diagnostics", async (_request, reply) => {
    const bridgeConfigured = Boolean(process.env.DEVICE_BRIDGE_URL);
    let bridgeReachable: boolean | null = null;
    let bridgeDeviceCount: number | null = null;
    if (bridgeConfigured) {
      try {
        const response = await fetchWithDeadline(`${process.env.DEVICE_BRIDGE_URL}/devices`, {
          headers: { "X-Device-Bridge-Token": process.env.DEVICE_BRIDGE_TOKEN ?? "folio-local-device-bridge" },
        });
        if (!response.ok) throw new Error("El puente respondió con error");
        const payload = await readBoundedJson(response) as { ok?: unknown; data?: unknown } | null;
        const devices = payload?.ok === true ? parsePublicDevices(payload.data) : null;
        if (!devices) throw new Error("Respuesta inválida del puente");
        bridgeReachable = true;
        bridgeDeviceCount = devices.length;
      } catch { bridgeReachable = false; }
    }
    const localDeviceCount = (await listEbookDevices()).length;
    reply.header("Cache-Control", "no-store").send({ ok: true, data: {
      bridgeConfigured, bridgeReachable, bridgeDeviceCount, localDeviceCount,
    } });
  });

  fastify.get("/api/devices", async (_request, reply) => {
    const bridgeUrl = process.env.DEVICE_BRIDGE_URL;
    if (bridgeUrl) {
      try {
        const response = await fetchWithDeadline(`${bridgeUrl}/devices`, { headers: { "X-Device-Bridge-Token": process.env.DEVICE_BRIDGE_TOKEN ?? "folio-local-device-bridge" } });
        if (response.ok) {
          const payload = await readBoundedJson(response) as { ok?: unknown; data?: unknown } | null;
          const devices = payload?.ok === true ? parsePublicDevices(payload.data) : null;
          if (!devices) throw new Error("Respuesta de dispositivos inválida");
          return reply.send({ ok: true, data: devices });
        }
      } catch { /* Fall back to mounts visible inside the API container. */ }
    }
    return reply.send({ ok: true, data: (await listEbookDevices()).map(({ id, name, books }) => ({ id, name, books })) });
  });

  fastify.get("/api/devices/:deviceId/books/download", async (request, reply) => {
    const { deviceId } = request.params as { deviceId: string };
    const { path } = request.query as { path?: string };
    if (!path) return reply.status(400).send({ ok: false, error: "Ruta de libro inválida" });
    const bridgeUrl = process.env.DEVICE_BRIDGE_URL;
    if (bridgeUrl) {
      try {
        const url = `${bridgeUrl}/devices/${encodeURIComponent(deviceId)}/book?path=${encodeURIComponent(path)}`;
        const response = await fetchWithDeadline(url, { headers: { "X-Device-Bridge-Token": process.env.DEVICE_BRIDGE_TOKEN ?? "folio-local-device-bridge" } });
        if (response.ok && response.body) {
          const fileName = decodeURIComponent(response.headers.get("x-file-name") ?? "book.epub").replace(/["\r\n]/g, "-");
          reply.header("Content-Disposition", attachmentContentDisposition(fileName));
          reply.type("application/octet-stream");
          return reply.send(Buffer.from(await readBoundedBody(response, maxDocumentBytes())));
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
        const response = await fetchWithDeadline(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-Device-Bridge-Token": process.env.DEVICE_BRIDGE_TOKEN ?? "folio-local-device-bridge",
            "X-File-Name": encodeURIComponent(fileName),
          },
          body: bridgePayload,
        });
        const detail = await readBoundedJson(response).catch(() => null) as { data?: { path: string; fileName: string }; error?: string } | null;
        if (response.ok && detail?.data) return reply.status(201).send({ ok: true, data: detail.data });
        if (response.status === 404) return reply.status(404).send({ ok: false, error: "Dispositivo no encontrado" });
        return reply.status(response.status === 400 ? 400 : 409).send({ ok: false, error: detail?.error ?? "El Kindle ha rechazado el archivo" });
      } catch {
        return reply.status(502).send({ ok: false, error: "No se ha podido confirmar la operación en el dispositivo; comprueba el resultado antes de reintentarlo" });
      }
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
        const response = await fetchWithDeadline(url, {
          method: "PUT",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-Device-Bridge-Token": process.env.DEVICE_BRIDGE_TOKEN ?? "folio-local-device-bridge",
          },
          body: bridgePayload,
        });
        if (response.status === 204) return reply.status(204).send();
        if (response.status === 404) return reply.status(404).send({ ok: false, error: "Libro no encontrado en el dispositivo" });
        const detail = await readBoundedJson(response).catch(() => null) as { error?: string } | null;
        return reply.status(409).send({ ok: false, error: detail?.error ?? "El Kindle ha rechazado la sobrescritura" });
      } catch {
        return reply.status(502).send({ ok: false, error: "No se ha podido confirmar la operación en el dispositivo; comprueba el resultado antes de reintentarlo" });
      }
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
        const response = await fetchWithDeadline(url, { method: "DELETE", headers: { "X-Device-Bridge-Token": process.env.DEVICE_BRIDGE_TOKEN ?? "folio-local-device-bridge" } });
        if (response.status === 204) return reply.status(204).send();
        if (response.status === 404) return reply.status(404).send({ ok: false, error: "Libro no encontrado en el dispositivo" });
        const detail = await readBoundedJson(response).catch(() => null) as { error?: string } | null;
        return reply.status(409).send({ ok: false, error: detail?.error ?? "El Kindle ha rechazado el borrado" });
      } catch {
        return reply.status(502).send({ ok: false, error: "No se ha podido confirmar la operación en el dispositivo; comprueba el resultado antes de reintentarlo" });
      }
    }
    try {
      if (await deleteDeviceBook(deviceId, path)) return reply.status(204).send();
      return reply.status(404).send({ ok: false, error: "Libro no encontrado en el dispositivo" });
    } catch {
      return reply.status(409).send({ ok: false, error: "No se ha podido borrar el libro del dispositivo" });
    }
  });
}
