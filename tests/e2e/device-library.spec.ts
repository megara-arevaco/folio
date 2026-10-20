import { test, expect } from "./fixtures";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import AdmZip from "adm-zip";
import { PNG } from "pngjs";

test("pagina, virtualiza y conserva la selección entre páginas y al buscar", async ({ page, server }) => {
  const books = Array.from({ length: 300 }, (_, index) => ({
    path: `book-${index}.epub`, fileName: `book-${index}.epub`, title: `Libro ${String(index + 1).padStart(3, "0")}`,
    authors: ["Autor de prueba"], size: 2048, modifiedAt: "2026-10-20T10:00:00Z", format: "EPUB",
  }));
  await page.route("**/api/devices", (route) => route.fulfill({ json: { ok: true, data: [{ id: "test-reader", name: "Lector de prueba", books }] } }));
  await page.route("**/api/devices/*/books/cover?**", (route) => route.fulfill({ status: 404 }));
  await page.goto(`${server.origin}/device`);
  await page.getByRole("button", { name: "Lista", exact: true }).click();
  const scroll = page.getByRole("region", { name: "Archivos de Lector de prueba" });
  await expect(page.getByText("1–25 de 300 libros")).toBeVisible();
  await expect(scroll.getByText("Libro 001", { exact: true })).toBeVisible();
  const firstCover = scroll.locator('img').first();
  await expect.poll(() => firstCover.evaluate((image: HTMLImageElement) => image.hidden)).toBe(true);
  const rowCount = await scroll.locator("tbody tr[data-index]").count();
  expect(rowCount).toBeGreaterThan(0);
  expect(rowCount).toBeLessThan(25);
  await page.getByRole("checkbox", { name: "Seleccionar Libro 001", exact: true }).check();
  await page.getByRole("button", { name: "Página siguiente" }).click();
  await expect(page.getByText("26–50 de 300 libros")).toBeVisible();
  await expect(scroll.getByText("Libro 026", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Borrar seleccionados (1)" })).toBeVisible();
  await page.getByRole("button", { name: "Página anterior" }).click();
  await expect(page.getByRole("checkbox", { name: "Seleccionar Libro 001", exact: true })).toBeChecked();
  await page.getByRole("checkbox", { name: "Seleccionar los libros de esta página" }).check();
  await expect(page.getByRole("button", { name: "Borrar seleccionados (25)" })).toBeVisible();
  await page.getByLabel("Por página", { exact: true }).selectOption("100");
  await expect(page.getByText("1–100 de 300 libros")).toBeVisible();
  await scroll.evaluate((element) => { window.scrollTo(0, element.getBoundingClientRect().bottom + window.scrollY - window.innerHeight); });
  await expect(scroll.getByText("Libro 100", { exact: true })).toBeVisible();
  expect(await scroll.locator("tbody tr[data-index]").count()).toBeLessThan(25);
  await page.getByRole("searchbox").fill("Libro 299");
  await expect(page.getByText("1–1 de 1 libro")).toBeVisible();
  await expect(scroll.getByText("Libro 299", { exact: true })).toBeVisible();
  await page.getByRole("searchbox").fill("sin-coincidencias");
  await expect(page.getByText("0–0 de 0 libros")).toBeVisible();
  await expect(page.getByText("Sin resultados. Prueba con menos palabras.")).toBeVisible();
  await page.getByRole("searchbox").fill("");
  await expect(page.getByText("1–100 de 300 libros")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Seleccionar Libro 001", exact: true })).toBeChecked();
});

test("extrae miniaturas de EPUB y PDF y rechaza rutas fuera del dispositivo", async ({ page, server, dataRoot }) => {
  const root = join(dataRoot, "devices");
  await mkdir(root, { recursive: true });
  const pdf = await PDFDocument.create();
  pdf.addPage([300, 450]);
  await writeFile(join(root, "documento.pdf"), await pdf.save());
  const png = new PNG({ width: 100, height: 150 });
  png.data.fill(180);
  const epub = new AdmZip();
  epub.addFile("mimetype", Buffer.from("application/epub+zip"));
  epub.addFile("META-INF/container.xml", Buffer.from('<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>'));
  epub.addFile("book.opf", Buffer.from('<package><metadata><title>Prueba</title></metadata><manifest><item id="cover" href="cover.png" media-type="image/png" properties="cover-image"/></manifest></package>'));
  epub.addFile("cover.png", PNG.sync.write(png));
  await writeFile(join(root, "libro.epub"), epub.toBuffer());
  const listed = await (await page.request.get(`${server.origin}/api/devices`)).json();
  const id = listed.data[0].id;
  for (const path of ["libro.epub", "documento.pdf"]) {
    const response = await page.request.get(`${server.origin}/api/devices/${id}/books/cover?path=${path}`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/jpeg");
    expect(response.headers()["cache-control"]).toContain("private");
    const bytes = await response.body();
    expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(bytes.length).toBeLessThan(512 * 1024);
    expect(await (await page.request.get(response.url())).body()).toEqual(bytes);
  }
  const outside = await page.request.get(`${server.origin}/api/devices/${id}/books/cover?path=../outside.pdf`);
  expect(outside.status()).toBe(404);
});

test("virtualiza filas de altura variable en móvil y alcanza el final de cada página", async ({ page, server }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const books = Array.from({ length: 60 }, (_, index) => ({
    path: `mobile-${index}.pdf`, fileName: `mobile-${index}.pdf`, title: `Libro móvil ${index + 1}`,
    authors: ["Un autor con un nombre largo para comprobar el ajuste de las filas"], size: 1024, format: "PDF", modifiedAt: "2026-10-20",
  }));
  await page.route("**/api/devices", (route) => route.fulfill({ json: { ok: true, data: [{ id: "mobile", name: "Lector móvil", books }] } }));
  await page.route("**/api/devices/*/books/cover?**", (route) => route.fulfill({ status: 404 }));
  await page.goto(`${server.origin}/device`);
  await page.getByRole("button", { name: "Lista", exact: true }).click();
  const scroll = page.getByRole("region", { name: "Archivos de Lector móvil" });
  await expect(scroll.getByText("Libro móvil 1", { exact: true })).toBeVisible();
  expect(await scroll.locator("tr[data-index]").count()).toBeLessThan(15);
  await page.getByRole("button", { name: "Página siguiente" }).click();
  await expect(scroll.getByText("Libro móvil 26", { exact: true })).toBeVisible();
  await scroll.evaluate((element) => { window.scrollTo(0, element.getBoundingClientRect().bottom + window.scrollY - window.innerHeight); });
  await expect(scroll.getByText("Libro móvil 50", { exact: true })).toBeVisible();
  await page.getByRole("searchbox").fill("Libro móvil 59");
  await expect(scroll.getByText("Libro móvil 59", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test("la cuadrícula virtual conserva selección y página al cambiar de vista y de ancho", async ({ page, server }) => {
  const books = Array.from({ length: 300 }, (_, i) => ({ path: `${i}.epub`, fileName: `${i}.epub`, title: `Volumen ${i + 1}`, authors: ["Autora de prueba"], size: 1048576, format: "EPUB", modifiedAt: "2026-10-20" }));
  await page.route("**/api/devices", route => route.fulfill({ json: { ok: true, data: [{ id: "grid", name: "Biblioteca", books }] } }));
  await page.route("**/api/devices/*/books/cover?**", route => route.fulfill({ status: 404 }));
  await page.goto(`${server.origin}/device`);
  await expect(page.getByRole("button", { name: "Cuadrícula", exact: true })).toHaveAttribute("aria-pressed", "true");
  const region = page.getByRole("region", { name: "Archivos de Biblioteca" });
  await expect(region.getByRole("heading", { name: "Volumen 1", exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: "Seleccionar Volumen 1", exact: true }).check();
  await page.getByLabel("Por página", { exact: true }).selectOption("100");
  expect(await region.getByRole("article").count()).toBeLessThan(30);
  await region.evaluate(el => { window.scrollTo(0, el.getBoundingClientRect().bottom + window.scrollY - window.innerHeight); });
  await expect(region.getByRole("heading", { name: "Volumen 100", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Página siguiente" }).click();
  await expect(region.getByRole("heading", { name: "Volumen 101", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Lista", exact: true }).click();
  await expect(region.getByText("Volumen 101", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Página anterior" }).click();
  await expect(page.getByRole("checkbox", { name: "Seleccionar Volumen 1", exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Cuadrícula", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(region.getByRole("heading", { name: "Volumen 1", exact: true })).toBeVisible();
  await region.evaluate(el => { window.scrollTo(0, el.getBoundingClientRect().bottom + window.scrollY - window.innerHeight); });
  await expect(region.getByRole("heading", { name: "Volumen 100", exact: true })).toBeVisible();
  await page.getByRole("searchbox").fill("Volumen 299");
  await expect(region.getByRole("heading", { name: "Volumen 299", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});
