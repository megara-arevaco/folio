import { test, expect } from "./fixtures";

async function seedLibrary(page: import("@playwright/test").Page) {
  const origin = new URL(page.url()).origin;
  const titles = ["El nombre de la rosa", "Un mar de historias", "La biblioteca de medianoche", "El bosque infinito", "Las ciudades invisibles", "Una habitación propia", "El camino de los libros"];
  for (const [index, title] of titles.entries()) {
    const response = await page.request.post(`${origin}/api/reading-log`, { data: {
      openLibraryKey: null, title, authors: [index === 0 ? "Umberto Eco" : "Autora de la biblioteca"], coverUrl: null,
      firstPublishYear: 2024, isbn: null, categories: [index % 2 ? "Ensayo" : "Ficción"],
    } });
    expect(response.ok()).toBeTruthy();
    const { data: book } = await response.json();
    const patched = await page.request.patch(`${origin}/api/reading-log/${book.id}`, { data: {
      status: index < 3 ? "read" : index < 5 ? "reading" : "to-read",
      finishedAt: index < 3 ? `2026-0${index + 1}-01T00:00:00.000Z` : null,
    } });
    expect(patched.ok()).toBeTruthy();
  }
  await page.goto(`${origin}/reading-log`);
}

test("explora el estante, combina filtros y conserva la edición de categorías y fechas", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1100 });
  await seedLibrary(page);
  await expect(page.locator(".reading-book")).toHaveCount(7);
  await expect(page.locator(".reading-shelf-canvas canvas")).toBeVisible();
  const before = await page.locator(".reading-stage__book h2").textContent();
  await page.getByRole("button", { name: "Libro siguiente" }).click();
  await expect(page.locator(".reading-stage__book h2")).not.toHaveText(before!);
  await page.getByRole("button", { name: "Abrir ficha" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Editar lectura de El nombre de la rosa", exact: true }).click();
  await page.getByRole("button", { name: "Añadir categoría", exact: true }).click();
  await page.getByRole("button", { name: "Filosofía", exact: true }).click();
  await expect(page.getByRole("button", { name: "Quitar categoría Filosofía" })).toBeVisible();
  await page.getByRole("button", { name: "Cerrar", exact: true }).click();
  const saved = page.waitForResponse(response => response.request().method() === "PATCH");
  await page.getByLabel("Mes y año").fill("2025-11");
  expect((await saved).ok()).toBeTruthy();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Leídos/ }).click();
  await expect(page.locator(".reading-book")).toHaveCount(3);
  await page.getByLabel("Filtrar por año").selectOption("2026");
  await expect(page.locator(".reading-book")).toHaveCount(2);
  await page.getByLabel("Buscar en tu biblioteca").fill("no existe este título");
  await expect(page.getByText("No hay libros con estos filtros.")).toBeVisible();
  await page.getByRole("button", { name: "Ver toda la biblioteca" }).click();
  await expect(page.locator(".reading-book")).toHaveCount(7);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "/tmp/folio-reading-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".reading-stage")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "/tmp/folio-reading-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Abrir ficha" }).click();
  const bounds = await page.getByRole("dialog").boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(errors).toEqual([]);
});

test("mantiene la biblioteca utilizable cuando WebGL no está disponible", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, contextId: string, ...args: unknown[]) {
      if (contextId === "webgl2" || contextId === "webgl") return null;
      return original.apply(this, [contextId, ...args] as Parameters<typeof original>);
    } as typeof original;
  });
  await seedLibrary(page);
  await expect(page.locator(".reading-shelf-fallback")).toBeVisible();
  await page.getByRole("button", { name: "Libro siguiente" }).click();
  await page.getByRole("button", { name: "Abrir ficha" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("añade desde el catálogo y permite cambiar de estado con un filtro activo", async ({ page }) => {
  await page.route("**/api/books/search?*", route => route.fulfill({ json: { ok: true, data: [{
    openLibraryKey: null, title: "Un nuevo comienzo", authors: ["Autora"], coverUrl: null,
    firstPublishYear: 2026, isbn: null, categories: [],
  }] } }));
  await page.goto(`${new URL(page.url()).origin}/reading-log`);
  await page.getByRole("button", { name: "＋ Añadir un libro", exact: true }).click();
  await page.getByLabel("Libro", { exact: true }).fill("Un nuevo comienzo");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await page.getByRole("button", { name: "Añadir", exact: true }).click();
  await expect(page.locator(".reading-book")).toHaveCount(1);
  await page.getByRole("button", { name: /^Pendientes/ }).click();
  await page.getByRole("button", { name: "Editar lectura de Un nuevo comienzo" }).click();
  await page.getByRole("combobox", { name: /^Estado/ }).selectOption("reading");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("No hay libros con estos filtros.")).toBeVisible();
  await page.getByRole("button", { name: /^Leyendo/ }).click();
  await expect(page.locator(".reading-book")).toHaveCount(1);
});
