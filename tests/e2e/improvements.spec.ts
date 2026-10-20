import { test, expect, launchServer } from "./fixtures";
import AdmZip from "adm-zip";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { createServer as createHttpServer } from "node:http";
import { once } from "node:events";

function fictionalEpub(paragraphCount = 2) {
  const zip = new AdmZip();
  zip.addFile("mimetype", Buffer.from("application/epub+zip"));
  zip.addFile("META-INF/container.xml", Buffer.from(`<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`));
  zip.addFile("OEBPS/content.opf", Buffer.from(`<?xml version="1.0"?><package version="3.0" unique-identifier="id" xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">fictional-test</dc:identifier><dc:title>La casa del faro</dc:title><dc:creator>Autora de prueba</dc:creator><dc:language>en</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>`));
  const paragraphs = Array.from({ length: paragraphCount }, (_, index) => `<p>At dawn, Mira opened the old book and found a map beneath the last page. She carried it across the harbour to the waiting keeper. Passage ${index + 1}.</p>`).join("");
  zip.addFile("OEBPS/chapter.xhtml", Buffer.from(`<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter</title></head><body><h1>The quiet lighthouse</h1>${paragraphs}</body></html>`));
  return zip.toBuffer();
}

test("verifica la muestra Mock por API sin crear un trabajo ni modificar originales; integra metadatos, versiones, lecturas y archivo", async ({ page }) => {
  const origin = new URL(page.url()).origin;
  await expect(page.getByRole("heading", { name: "Antes de procesar" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Previsualizar muestra" })).toHaveCount(0);
  const preflight = await page.request.get(`${origin}/api/preflight`);
  expect((await preflight.json()).data.translation.mode).toBe("mock");
  const sample = await page.request.post(`${origin}/api/previews/epub-translation`, { multipart: {
    file: { name: "faro-ficticio.epub", mimeType: "application/epub+zip", buffer: fictionalEpub() },
  } });
  expect(sample.ok()).toBe(true);
  const preview = (await sample.json()).data;
  expect(preview.mock).toBe(true);
  expect(preview.sample.some((item: { source: string; result: string }) => item.source.includes("The quiet lighthouse") && item.result.includes("[ES] The quiet lighthouse"))).toBe(true);
  await page.locator('input[type="file"]').setInputFiles({ name: "faro-ficticio.epub", mimeType: "application/epub+zip", buffer: fictionalEpub() });
  const beforeStart = await page.request.get(`${new URL(page.url()).origin}/api/jobs`);
  expect(await beforeStart.json()).toMatchObject({ ok: true, data: [] });

  await page.getByRole("button", { name: "Traducir EPUB", exact: true }).click();
  await expect(page.getByText("[ES] The quiet lighthouse", { exact: true })).toHaveCount(0);
  await expect(page.locator('.job-status__label[data-status="done"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/^Último avance:/)).toBeVisible();
  await page.getByRole("button", { name: "Editar metadatos", exact: true }).click();
  await expect(page.getByText("Original recibido")).toBeVisible();
  const originalLink = page.getByRole("link", { name: "Descargar original" });
  const originalResponse = await page.request.get(await originalLink.getAttribute("href") || "");
  expect(originalResponse.ok()).toBe(true);
  const original = new AdmZip(await originalResponse.body());
  expect(original.readAsText("OEBPS/content.opf")).toContain("La casa del faro");

  await page.getByLabel("Título", { exact: true }).fill("La casa del faro editada");
  await page.getByRole("button", { name: "Guardar y sobrescribir" }).click();
  await expect(page.getByText("Metadatos guardados en el EPUB procesado.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Versiones anteriores" })).toBeVisible();
  const metadataUrl = new URL(page.url());
  const jobId = metadataUrl.pathname.split("/").filter(Boolean).slice(-1)[0]!;
  const invalidRevision = await page.request.get(`${metadataUrl.origin}/api/jobs/${jobId}/revisions/not-a-version/download`);
  expect(invalidRevision.status()).toBe(400);
  const restore = page.getByRole("button", { name: "Restaurar versión" }).first();
  page.once("dialog", (dialog) => dialog.accept());
  await restore.click();
  await expect(page.getByLabel("Título", { exact: true })).toHaveValue("La casa del faro");
  await expect(page.getByText("Versión restaurada. El resultado anterior también se conservó.")).toBeVisible();

  await page.getByRole("button", { name: "Añadir a lecturas", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Lecturas", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "La casa del faro", exact: true })).toBeVisible();

  await page.goto(`${new URL(page.url()).origin}/translations`);
  await expect(page.locator('.job-status__label[data-status="done"]')).toBeVisible();
  await page.getByRole("button", { name: "Archivar resultados listos" }).click();
  await expect(page.getByText(/1 resultado archivado/)).toBeVisible();
  await page.locator("details.job-archive > summary").click();
  await expect(page.getByRole("link", { name: "Descargar", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Restaurar en la cola" }).click();
  await expect(page.locator('.job-status__label[data-status="done"]')).toBeVisible();
});

test("edita el glosario y recupera el trabajo pausado tras reiniciar con almacenamiento aislado", async ({ page, dataRoot, server }) => {
  const origin = new URL(page.url()).origin;
  const upload = await page.request.post(`${origin}/api/translate`, {
    multipart: { file: { name: "capitulo-largo-ficticio.epub", mimeType: "application/epub+zip", buffer: fictionalEpub(1200) } },
  });
  expect(upload.status()).toBe(201);
  const { data: { jobId } } = await upload.json();
  await page.request.post(`${origin}/api/jobs/${jobId}/pause`);
  await expect.poll(async () => {
    const response = await page.request.get(`${origin}/api/jobs/${jobId}`);
    return (await response.json()).data.status;
  }, { timeout: 30_000 }).toBe("paused");

  await page.goto(`${origin}/translations`);
  await page.getByRole("button", { name: "Editar glosario" }).click();
  await page.getByRole("button", { name: "Añadir término" }).click();
  await page.getByLabel("Término original").fill("Old Keeper");
  await page.getByLabel("Traducción preferida").fill("Antiguo guardián");
  await page.getByRole("button", { name: "Guardar glosario" }).click();
  await expect(page.getByText("Glosario guardado para este trabajo.")).toBeVisible();
  const response = await page.request.get(`${origin}/api/jobs/${jobId}/glossary`);
  expect((await response.json()).data).toEqual([{ source: "Old Keeper", target: "Antiguo guardián", type: "term" }]);

  await server.close();
  const restarted = await launchServer(dataRoot);
  try {
    await page.goto(`${restarted.origin}/translations`);
    await expect(page.locator('.job-status__label[data-status="paused"]')).toBeVisible();
    const recoveredGlossary = await page.request.get(`${restarted.origin}/api/jobs/${jobId}/glossary`);
    expect((await recoveredGlossary.json()).data).toEqual([{ source: "Old Keeper", target: "Antiguo guardián", type: "term" }]);
    await page.getByRole("button", { name: "Reanudar" }).click();
    await expect(page.locator('.job-status__label[data-status="done"]')).toBeVisible({ timeout: 30_000 });
  } finally { await restarted.close(); }
});

test("recupera un fallo simulado de proveedor sin salir de localhost ni perder el original", async ({ page, dataRoot, server }) => {
  let failTranslations = true;
  const provider = createHttpServer((request, response) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => { raw += chunk; });
    request.on("end", () => {
      const body = JSON.parse(raw) as { messages?: Array<{ role?: string; content?: string }> };
      if (body.messages?.[0]?.content?.includes("editor literario")) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ glossary: [] }) } }] }));
        return;
      }
      if (failTranslations) {
        response.writeHead(503, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "test-only outage" }));
        return;
      }
      const userPrompt = body.messages?.[1]?.content ?? "";
      const match = userPrompt.match(/Items:\n([\s\S]*)$/);
      const items = match ? JSON.parse(match[1]!) as Array<{ id: string; text: string }> : [];
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items: items.map((item) => ({ id: item.id, text: `Traducción simulada: ${item.text}` })) }) } }] }));
    });
  });
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  const address = provider.address();
  if (!address || typeof address === "string") throw new Error("No se ha podido iniciar el proveedor de prueba");

  await server.close();
  const restarted = await launchServer(dataRoot, {
    LLM_MOCK: "false",
    LLM_API_BASE_URL: `http://127.0.0.1:${address.port}/api/v1`,
    LLM_API_KEY: "sk-or-v1-fake-local-test-only",
    LLM_MODEL: "test/local-stub",
  });
  try {
    const upload = await page.request.post(`${restarted.origin}/api/translate`, {
      multipart: { file: { name: "fallo-simulado.epub", mimeType: "application/epub+zip", buffer: fictionalEpub() } },
    });
    expect(upload.status()).toBe(201);
    const { data: { jobId } } = await upload.json();
    await expect.poll(async () => (await (await page.request.get(`${restarted.origin}/api/jobs/${jobId}`)).json()).data.status, { timeout: 30_000 }).toBe("error");
    const failed = await page.request.get(`${restarted.origin}/api/jobs/${jobId}`);
    expect((await failed.json()).data.error).toContain("503");
    await page.goto(`${restarted.origin}/translations`);
    await expect(page.locator(".job-error")).toContainText("503");
    await expect(page.getByText(/Corrige la causa/)).toBeVisible();
    failTranslations = false;
    await page.getByRole("button", { name: "Reanudar" }).click();
    await expect.poll(async () => (await (await page.request.get(`${restarted.origin}/api/jobs/${jobId}`)).json()).data.status, { timeout: 30_000 }).toBe("done");
    const job = (await (await page.request.get(`${restarted.origin}/api/jobs/${jobId}`)).json()).data;
    const result = await page.request.get(`${restarted.origin}${job.downloadUrl}`);
    expect(result.ok()).toBe(true);
    const resultZip = new AdmZip(await result.body());
    expect(resultZip.readAsText("OEBPS/chapter.xhtml")).toContain("Traducción simulada: The quiet lighthouse");
    const original = await page.request.get(`${restarted.origin}/api/jobs/${jobId}/original/download`);
    expect(new AdmZip(await original.body()).readAsText("OEBPS/chapter.xhtml")).toContain("The quiet lighthouse");
  } finally {
    await restarted.close();
    await new Promise<void>((resolve, reject) => provider.close((error) => error ? reject(error) : resolve()));
  }
});

test("verifica muestras PDF y diagnóstico por API sin mostrar sus paneles", async ({ page }) => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage().drawText("Fictional local sample page, made only for Folio preview checks.", { x: 48, y: 720, font, size: 14 });

  await page.getByRole("link", { name: "Convertir PDF", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Convertir PDF", exact: true })).toBeVisible();
  await page.locator('input[type="file"][accept=".pdf"]').setInputFiles({ name: "muestra-ficticia.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) });
  await expect(page.getByRole("button", { name: "Previsualizar muestra" })).toHaveCount(0);
  const sample = await page.request.post(`${new URL(page.url()).origin}/api/previews/pdf-conversion`, { multipart: {
    file: { name: "muestra-ficticia.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) },
  } });
  expect(sample.ok()).toBe(true);
  const preview = (await sample.json()).data;
  expect(preview.provider).toBe("local");
  expect(preview.pages[0].text).toContain("Fictional local sample page");
  expect(preview.structure.bookmarkCount).toBe(0);

  await page.getByRole("link", { name: "Dispositivo", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Diagnóstico de conexión" })).toHaveCount(0);
  const diagnostics = await page.request.get(`${new URL(page.url()).origin}/api/devices/diagnostics`);
  expect(diagnostics.ok()).toBe(true);
});
