import { test, expect, launchServer } from "./fixtures";
import AdmZip from "adm-zip";
import { load } from "cheerio";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { join } from "node:path";
import { readFile } from "node:fs/promises";

function epub() {
  const zip = new AdmZip();
  zip.addFile("mimetype", Buffer.from("application/epub+zip"));
  zip.addFile("META-INF/container.xml", Buffer.from(`<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`));
  zip.addFile("OEBPS/content.opf", Buffer.from(`<?xml version="1.0"?><package version="3.0" unique-identifier="id" xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">folio-test</dc:identifier><dc:title>Un libro de prueba</dc:title><dc:creator>Autora E2E</dc:creator><dc:language>en</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>`));
  zip.addFile("OEBPS/chapter.xhtml", Buffer.from(`<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter</title></head><body><h1>A quiet library</h1><p>The reader opened the book and began a new adventure.</p></body></html>`));
  return zip.toBuffer();
}

test("abre Folio y permite navegar por todas las herramientas", async ({ page }) => {
  await expect(page).toHaveTitle(/Folio/);
  await expect(page.getByRole("link", { name: "Folio", exact: true })).toBeVisible();
  for (const name of ["Convertir PDF", "Metadatos", "Dispositivo", "Lecturas", "Traducir EPUB"]) {
    await page.getByRole("link", { name, exact: true }).click();
    await expect(page.getByRole("heading", { name, exact: true }).first()).toBeVisible();
  }
  await page.goto(`${new URL(page.url()).origin}/reading-log`);
  await expect(page.getByRole("heading", { name: "Lecturas", exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => typeof (window as unknown as { require?: unknown }).require)).toBe("undefined");
});

test("traduce un EPUB, edita metadatos y conserva el resultado al recargar", async ({ page, dataRoot }) => {
  await page.locator('input[type="file"]').setInputFiles({ name: "aventura.epub", mimeType: "application/epub+zip", buffer: epub() });
  await page.getByRole("button", { name: "Traducir EPUB", exact: true }).click();
  await expect(page.locator('.job-status__label[data-status="done"]')).toBeVisible({ timeout: 30_000 });
  await page.getByRole("row", { name: "Editar metadatos de aventura.epub" }).click();
  await page.getByLabel("Título", { exact: true }).fill("La aventura de Folio");
  await page.getByRole("button", { name: "Guardar y sobrescribir" }).click();
  await expect(page.getByText("Metadatos guardados en el EPUB procesado.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Título", { exact: true })).toHaveValue("La aventura de Folio");
  await page.getByRole("link", { name: "Traducir EPUB", exact: true }).click();
  const href = await page.getByRole("link", { name: "Descargar", exact: true }).getAttribute("href");
  const response = await page.request.get(href!);
  expect(response.ok()).toBe(true);
  const destination = join(dataRoot, "descarga.epub");
  const downloading = page.waitForEvent("download");
  await page.getByRole("link", { name: "Descargar", exact: true }).click();
  await (await downloading).saveAs(destination);
  const zip = new AdmZip(await readFile(destination));
  expect(zip.readAsText("OEBPS/content.opf")).toContain("La aventura de Folio");
  expect(zip.getEntry("OEBPS/chapter.xhtml")).toBeTruthy();
});

test("convierte un PDF local en un EPUB descargable", async ({ page }) => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.setTitle("Documento de prueba");
  pdf.addPage().drawText("A book prepared with Folio. A story for the local library.", { x: 60, y: 700, font, size: 16 });
  await page.getByRole("link", { name: "Convertir PDF", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Convertir PDF", exact: true })).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveAttribute("accept", ".pdf");
  await page.locator('input[type="file"]').setInputFiles({ name: "documento.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) });
  await page.getByRole("button", { name: "Convertir PDF", exact: true }).click();
  await expect(page.locator('.job-status__label[data-status="done"]')).toBeVisible({ timeout: 30_000 });
  const href = await page.getByRole("link", { name: "Descargar", exact: true }).getAttribute("href");
  const response = await page.request.get(href!);
  expect(response.ok()).toBe(true);
  const zip = new AdmZip(await response.body());
  expect(zip.readAsText("mimetype")).toBe("application/epub+zip");
  expect(zip.getEntries().some(entry => entry.entryName.endsWith(".xhtml") && zip.readAsText(entry).includes("A book prepared with Folio"))).toBe(true);
});

test("edita un archivo en el navegador y descarga el resultado", async ({ page, dataRoot }) => {
  const path = join(dataRoot, "original.epub");
  await page.evaluate(() => Object.defineProperty(window, "showOpenFilePicker", { value: undefined }));
  await page.getByRole("link", { name: "Metadatos", exact: true }).click();
  await page.getByLabel("Archivo EPUB o PDF", { exact: true }).setInputFiles({ name: "original.epub", mimeType: "application/epub+zip", buffer: epub() });
  await expect(page.getByLabel("Título", { exact: true })).toHaveValue("Un libro de prueba");
  await page.getByLabel("Título", { exact: true }).fill("Original actualizado");
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Guardar y descargar" }).click();
  await (await downloading).saveAs(path);
  await expect(page.getByText("EPUB actualizado y descargado.")).toBeVisible();
  expect(new AdmZip(await readFile(path)).readAsText("OEBPS/content.opf")).toContain("Original actualizado");
});

test("sobrescribe usando el permiso de escritura del navegador", async ({ page }) => {
  await page.evaluate(bytes => {
    let content = new Uint8Array(bytes);
    const handle = {
      getFile: async () => new File([content], "original.epub", { type: "application/epub+zip" }),
      createWritable: async () => ({
        write: async (blob: Blob) => { content = new Uint8Array(await blob.arrayBuffer()); },
        close: async () => { Object.assign(window, { savedBook: Array.from(content) }); },
        abort: async () => {},
      }),
    };
    Object.defineProperty(window, "showOpenFilePicker", { value: async () => [handle] });
  }, Array.from(epub()));
  await page.getByRole("link", { name: "Metadatos", exact: true }).click();
  await page.getByRole("button", { name: "Seleccionar EPUB o PDF" }).click();
  await expect(page.getByLabel("Título", { exact: true })).toHaveValue("Un libro de prueba");
  await page.getByLabel("Título", { exact: true }).fill("Edición con permiso");
  await page.getByRole("button", { name: "Guardar y sobrescribir" }).click();
  await expect(page.getByText("EPUB guardado. El archivo original se ha sobrescrito.")).toBeVisible();
  const bytes = await page.evaluate(() => (window as unknown as { savedBook: number[] }).savedBook);
  const metadata = load(new AdmZip(Buffer.from(bytes)).readAsText("OEBPS/content.opf"), { xml: true });
  expect(metadata("dc\\:title").text()).toBe("Edición con permiso");
});

test("guarda lecturas, permite editarlas y borrarlas desde la interfaz", async ({ page }) => {
  const origin = new URL(page.url()).origin;
  // Seed via the real HTTP API; catalog searches otherwise require the external network.
  const response = await page.request.post(`${origin}/api/reading-log`, { data: {
    openLibraryKey: null, title: "Lectura de Folio", authors: ["Autora E2E"], coverUrl: null,
    firstPublishYear: 2026, isbn: null, categories: ["Ficción"],
  } });
  expect(response.status()).toBe(201);
  await page.getByRole("link", { name: "Lecturas", exact: true }).click();
  await page.getByRole("button", { name: "Editar lectura de Lectura de Folio" }).click();
  const saved = page.waitForResponse(response => response.url().includes("/api/reading-log/") && response.request().method() === "PATCH");
  await page.getByRole("combobox", { name: /^Estado/ }).selectOption("read");
  expect((await saved).ok()).toBe(true);
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.getByText("Leído", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Editar lectura de Lectura de Folio" }).click();
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Borrar", exact: true }).click();
  await expect(page.getByText("Todavía no has registrado ninguna lectura.")).toBeVisible();
});

test("rechaza archivos incompatibles y peticiones de otros orígenes", async ({ page }) => {
  await page.locator('input[type="file"]').setInputFiles({ name: "archivo.txt", mimeType: "text/plain", buffer: Buffer.from("Texto") });
  await expect(page.getByText(/Solo se permiten archivos .epub/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Traducir EPUB", exact: true })).toBeDisabled();
  const response = await page.request.get(`${new URL(page.url()).origin}/api/reading-log`, { headers: { Origin: "https://example.com" } });
  expect(response.status()).toBe(403);
});


test("conserva las lecturas al reiniciar el servidor de Folio", async ({ dataRoot, browser }) => {
  const first = await launchServer(dataRoot);
  try {
    const page = await browser.newPage();
    await page.goto(first.origin);
    await expect(page.getByRole("heading", { name: "Traducir EPUB", exact: true })).toBeVisible();
    const response = await page.request.post(`${new URL(page.url()).origin}/api/reading-log`, { data: {
      openLibraryKey: null, title: "Libro persistente", authors: ["Autora E2E"], coverUrl: null,
      firstPublishYear: 2026, isbn: null, categories: [],
    } });
    expect(response.status()).toBe(201);
  } finally { await first.close(); }
  const second = await launchServer(dataRoot);
  try {
    const page = await browser.newPage();
    await page.goto(second.origin);
    await page.getByRole("link", { name: "Lecturas", exact: true }).click();
    await expect(page.getByRole("button", { name: "Editar lectura de Libro persistente" })).toBeVisible();
  } finally { await second.close(); }
});
