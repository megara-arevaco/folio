import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { deleteKnownDeviceBook, listEbookDevices, resolveKnownDeviceBook, uploadKnownDeviceBook } from "../apps/api/src/services/devices";

const port = Number.parseInt(process.env.DEVICE_BRIDGE_PORT ?? "3002", 10);
const token = process.env.DEVICE_BRIDGE_TOKEN ?? "epub-translator-local-device-bridge";
const CACHE_TTL_MS = 60_000;
let deviceCache: { createdAt: number; data: Awaited<ReturnType<typeof listEbookDevices>> } | null = null;
const MAX_UPLOAD_BYTES = Number.parseInt(process.env.MAX_UPLOAD_MB ?? "100", 10) * 1024 * 1024;

async function getDevices() {
  if (deviceCache && Date.now() - deviceCache.createdAt < CACHE_TTL_MS) return deviceCache.data;
  const data = await listEbookDevices();
  deviceCache = { createdAt: Date.now(), data };
  return data;
}

async function readRequestBody(request: AsyncIterable<Buffer | string>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_UPLOAD_BYTES) throw new Error("El archivo supera el tamaño máximo permitido");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

createServer(async (request, response) => {
  if (request.headers["x-device-bridge-token"] !== token) {
    response.writeHead(403).end();
    return;
  }
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  try {
    if (request.method === "GET" && url.pathname === "/devices") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ ok: true, data: await getDevices() }));
      return;
    }
    const match = url.pathname.match(/^\/devices\/([^/]+)\/book$/);
    if (request.method === "GET" && match) {
      const device = (await getDevices()).find((item) => item.id === decodeURIComponent(match[1]!));
      const book = device ? await resolveKnownDeviceBook(device, url.searchParams.get("path") ?? "") : null;
      if (!book) { response.writeHead(404).end(); return; }
      response.setHeader("Content-Type", "application/octet-stream");
      response.setHeader("X-File-Name", encodeURIComponent(book.fileName));
      createReadStream(book.path).pipe(response);
      return;
    }
    if (request.method === "POST" && match) {
      const device = (await getDevices()).find((item) => item.id === decodeURIComponent(match[1]!));
      if (!device) {
        response.writeHead(404, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: false, error: "Dispositivo no encontrado" }));
        return;
      }
      const encodedName = request.headers["x-file-name"];
      const fileName = typeof encodedName === "string" ? decodeURIComponent(encodedName) : "";
      const result = await uploadKnownDeviceBook(device, fileName, await readRequestBody(request));
      deviceCache = null;
      response.writeHead(201, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true, data: result }));
      return;
    }
    if (request.method === "DELETE" && match) {
      const device = (await getDevices()).find((item) => item.id === decodeURIComponent(match[1]!));
      const deleted = device ? await deleteKnownDeviceBook(device, url.searchParams.get("path") ?? "") : false;
      if (deleted) deviceCache = null;
      response.writeHead(deleted ? 204 : 404).end();
      return;
    }
    response.writeHead(404).end();
  } catch (error) {
    response.writeHead(500, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Device bridge listening on port ${port}`);
});
