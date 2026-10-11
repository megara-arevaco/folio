import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PDFDocument } from "pdf-lib";

// No providers, physical devices, personal data or published services.
test("desktop API requires a session token and encrypts saved credentials", async () => {
  const data = await mkdtemp(join(tmpdir(), "folio-desktop-api-"));
  let app;
  try {
    Object.assign(process.env, {
      FOLIO_ENV_FILE: join(data, "absent.env"), FOLIO_DATA_DIR: data,
      FOLIO_DESKTOP_TOKEN: "test-session-token", FOLIO_WEB_ROOT: resolve("apps/web/dist"),
      LLM_MOCK: "true", PDF_CONVERSION_PROVIDER: "local",
      PDF_RENDER_COMMAND: "folio-nonexistent-tool-for-test", PDF_OCR: "true",
    });
    const api = await import("../../dist/desktop/api.mjs");
    api.configureSettingsSecretCodec({
      encrypt: (value) => `test-cipher:${Buffer.from(value).toString("base64")}`,
      decrypt: (value) => Buffer.from(value.slice(12), "base64").toString(),
    });
    app = await api.createServer();
    assert.equal((await app.inject({ url: "/api/jobs" })).statusCode, 401);
    assert.equal((await app.inject({ url: "/api/jobs", headers: { "x-folio-desktop-token": "wrong" } })).statusCode, 401);
    const headers = { "x-folio-desktop-token": "test-session-token" };
    assert.equal((await app.inject({ url: "/api/jobs", headers })).statusCode, 200);
    assert.equal((await app.inject({ url: "/", headers })).statusCode, 200);
    assert.equal((await app.inject({ url: "/api/jobs", headers: { ...headers, origin: "https://untrusted.invalid" } })).statusCode, 403);
    const saved = await app.inject({ method: "PUT", url: "/api/settings/openrouter", headers, payload: { apiKey: "fake-key" } });
    assert.equal(saved.statusCode, 200);
    assert.ok(!saved.body.includes("fake-key"));
    const stored = await readFile(join(data, "settings.json"), "utf8");
    assert.ok(!stored.includes("fake-key"));
    assert.ok(JSON.parse(stored).encryptedOpenRouterApiKey);
    const status = await app.inject({ url: "/api/settings/openrouter", headers });
    assert.equal(status.json().data.source, "settings");
    assert.equal((await app.inject({ method: "DELETE", url: "/api/settings/openrouter", headers })).statusCode, 200);
    assert.equal(JSON.parse(await readFile(join(data, "settings.json"), "utf8")).encryptedOpenRouterApiKey, undefined);

    const pdf = await PDFDocument.create();
    pdf.addPage(); // A page without selectable text requires OCR.
    const original = Buffer.from(await pdf.save());
    const boundary = "folio-test-boundary";
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="scan.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
      original, Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const created = await app.inject({ method: "POST", url: "/api/pdf/convert", headers: { ...headers, "content-type": `multipart/form-data; boundary=${boundary}` }, payload });
    assert.equal(created.statusCode, 201);
    const jobId = created.json().data.jobId;
    let job;
    for (let attempt = 0; attempt < 50; attempt++) {
      const response = await app.inject({ url: "/api/jobs", headers });
      job = response.json().data.find(item => item.id === jobId);
      if (job?.status === "error") break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(job.status, "error");
    assert.match(job.error, /Poppler.*PDF con texto seleccionable/);
    assert.deepEqual(await readFile(join(data, "jobs", jobId, "input.pdf")), original);
  } finally {
    await app?.close();
    await rm(data, { recursive: true, force: true });
  }
});
