import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { test, expect, launchServer } from "./fixtures";

const TEST_API_KEY = "sk-or-v1-folio-e2e-secret";

test("opens Settings from the mobile navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Abrir navegación" }).click();
  await page.getByRole("link", { name: "Ajustes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ajustes", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Abrir navegación" })).toHaveAttribute("aria-expanded", "false");
});

test("saves an OpenRouter key privately without returning it to the interface", async ({ page, dataRoot }) => {
  await page.getByRole("link", { name: "Ajustes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ajustes", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Copia global y restauración local", exact: true })).toBeVisible();
  await expect(page.getByText(/folio-data\.mjs restore/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Límites de llamadas IA de Folio", exact: true })).toBeVisible();
  await expect(page.getByText("No hay ninguna clave de OpenRouter configurada.", { exact: true })).toBeVisible();
  const origin = new URL(page.url()).origin;
  const invalidKey = await page.request.put(`${origin}/api/settings/openrouter`, { data: { apiKey: "  " } });
  expect(invalidKey.status()).toBe(400);
  const foreignOrigin = await page.request.put(`${origin}/api/settings/openrouter`, {
    data: { apiKey: TEST_API_KEY },
    headers: { Origin: "https://example.com" },
  });
  expect(foreignOrigin.status()).toBe(403);

  const input = page.getByLabel("Clave de API", { exact: true });
  await expect(input).toHaveAttribute("type", "password");
  await input.fill(TEST_API_KEY);
  await page.getByRole("button", { name: "Guardar clave", exact: true }).click();
  await expect(page.getByText("Clave guardada. Se usará en las próximas tareas.", { exact: true })).toBeVisible();
  await expect(input).toHaveValue("");

  const statusResponse = await page.request.get(`${new URL(page.url()).origin}/api/settings/openrouter`);
  expect(statusResponse.ok()).toBe(true);
  const statusPayload = await statusResponse.json();
  expect(statusPayload.data).toEqual({ configured: true, source: "settings" });
  expect(JSON.stringify(statusPayload)).not.toContain(TEST_API_KEY);

  const stored = JSON.parse(await readFile(join(dataRoot, "settings.json"), "utf8")) as { openRouterApiKey?: string };
  expect(stored.openRouterApiKey).toBe(TEST_API_KEY);
  if (process.platform !== "win32") {
    expect((await stat(join(dataRoot, "settings.json"))).mode & 0o077).toBe(0);
  }

  await page.reload();
  await expect(page.getByText("Se está usando la clave guardada en este servidor.", { exact: true })).toBeVisible();
  await expect(input).toHaveValue("");
  await page.getByRole("button", { name: "Eliminar clave guardada", exact: true }).click();
  await expect(page.getByText("Clave guardada eliminada.", { exact: true })).toBeVisible();
  await expect(page.getByText("No hay ninguna clave de OpenRouter configurada.", { exact: true })).toBeVisible();
});

test("keeps the saved OpenRouter key available after an API restart", async ({ dataRoot, browser }) => {
  const first = await launchServer(dataRoot);
  try {
    const page = await browser.newPage();
    await page.goto(first.origin);
    const response = await page.request.put(`${first.origin}/api/settings/openrouter`, { data: { apiKey: TEST_API_KEY } });
    expect(response.ok()).toBe(true);
    expect(JSON.stringify(await response.json())).not.toContain(TEST_API_KEY);
    await page.close();
  } finally {
    await first.close();
  }

  const second = await launchServer(dataRoot);
  try {
    const page = await browser.newPage();
    await page.goto(second.origin);
    const response = await page.request.get(`${second.origin}/api/settings/openrouter`);
    expect(response.ok()).toBe(true);
    const payload = await response.json();
    expect(payload.data).toEqual({ configured: true, source: "settings" });
    expect(JSON.stringify(payload)).not.toContain(TEST_API_KEY);
    await page.close();
  } finally {
    await second.close();
  }
});
