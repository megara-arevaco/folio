import { test, expect } from "./fixtures";

test("Folio switches between Spanish and English and remembers the choice", async ({ page }) => {
  const language = page.getByLabel("Idioma");
  await language.selectOption("en");

  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("link", { name: "Translate EPUB", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Translate EPUB", exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Language")).toHaveValue("en");
  await expect(page.getByRole("link", { name: "Reading log", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();

  await page.getByLabel("Language").selectOption("es");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(page.getByRole("link", { name: "Traducir EPUB", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ajustes", exact: true })).toBeVisible();
});
