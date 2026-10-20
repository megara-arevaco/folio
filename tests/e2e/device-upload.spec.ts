import { test, expect } from "./fixtures";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import AdmZip from "adm-zip";

test("envía cada formato compatible sin convertir ni modificar sus bytes", async ({ page, server, dataRoot }) => {
  const root = join(dataRoot, "devices");
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "existente.pdf"), "%PDF-existing");
  const listed = await (await page.request.get(`${server.origin}/api/devices`)).json();
  const id = listed.data[0].id;
  for (const extension of ["epub", "pdf", "mobi", "azw", "azw3", "kfx"]) {
    const zip = new AdmZip();
    zip.addFile("mimetype", Buffer.from("application/epub+zip"));
    const original = extension === "epub" ? zip.toBuffer() : Buffer.from(`original-${extension}\0\xff`, "latin1");
    const name = `sin-conversion.${extension}`;
    const response = await page.request.post(`${server.origin}/api/devices/${id}/books`, {
      multipart: { file: { name, mimeType: "application/octet-stream", buffer: original } },
    });
    expect(response.status()).toBe(201);
    const result = (await response.json()).data;
    expect(result.fileName).toBe(name);
    expect(await readFile(join(root, result.path))).toEqual(original);
  }
  const unsupported = await page.request.post(`${server.origin}/api/devices/${id}/books`, {
    multipart: { file: { name: "no.exe", mimeType: "application/octet-stream", buffer: Buffer.from("no") } },
  });
  expect(unsupported.status()).toBe(400);
});

test("prepara y edita la cola sin transferir, muestra progreso y conserva solo los fallos para reintento manual", async ({ page, server }) => {
  let connected = true;
  await page.route("**/api/devices", (route) => route.fulfill({ json: { ok: true, data: connected ? [{
    id: "reader-test", name: "Lector de prueba", books: [],
  }] : [] } }));
  const pending: Array<{ name: string; finish: (ok: boolean) => void }> = [];
  await page.route("**/api/devices/reader-test/books", async (route) => {
    const body = route.request().postDataBuffer()!.toString();
    const name = /filename="([^"]+)"/.exec(body)![1];
    const ok = await new Promise<boolean>((resolve) => pending.push({ name, finish: resolve }));
    await route.fulfill({ status: ok ? 201 : 409, json: ok
      ? { ok: true, data: { path: name, fileName: name } }
      : { ok: false, error: "Dispositivo desconectado" } });
  });
  await page.goto(`${server.origin}/device`);
  const data = await page.evaluateHandle(() => {
    const files = new DataTransfer();
    files.items.add(new File(["epub-original"], "primero.epub"));
    files.items.add(new File(["pdf-original"], "quitar.pdf"));
    return files;
  });
  await page.locator(".device-dropzone").dispatchEvent("drop", { dataTransfer: data });
  await page.getByLabel("Añadir archivos a la cola").setInputFiles({ name: "segundo.mobi", mimeType: "application/octet-stream", buffer: Buffer.from("mobi-original") });
  const queue = page.getByRole("list", { name: "Archivos pendientes de envío" });
  await expect(queue.getByRole("listitem")).toHaveCount(3);
  expect(pending).toHaveLength(0);
  await page.getByRole("button", { name: "Actualizar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Actualizar", exact: true })).toBeEnabled();
  await expect(queue.getByRole("listitem")).toHaveCount(3);
  await page.getByRole("button", { name: "Quitar quitar.pdf de la cola" }).click();
  await expect(queue.getByRole("listitem")).toHaveCount(2);
  await page.getByRole("button", { name: "Enviar (2)" }).click();
  await expect(page.getByText("Enviando 1 de 2", { exact: true })).toBeVisible();
  await expect(queue).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Actualizar", exact: true })).toBeDisabled();
  await expect.poll(() => pending.length).toBe(1);
  expect(pending[0].name).toBe("primero.epub");
  pending[0].finish(true);
  await expect(page.getByText("Enviando 2 de 2", { exact: true })).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveAttribute("value", "1");
  await expect.poll(() => pending.length).toBe(2);
  connected = false;
  pending[1].finish(false);
  await expect(queue.getByRole("listitem")).toHaveCount(1);
  await expect(queue).toContainText("segundo.mobi");
  await expect(queue).toContainText("Dispositivo desconectado");
  await expect(queue).not.toContainText("primero.epub");
  expect(pending).toHaveLength(2);
  connected = true;
  await page.getByRole("button", { name: "Enviar (1)" }).click();
  await expect.poll(() => pending.length).toBe(3);
  pending[2].finish(true);
  await expect(queue).toHaveCount(0);
  await expect(page.getByText("1 archivo enviado al dispositivo.")).toBeVisible();
});
