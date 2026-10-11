import { test } from "node:test";
import assert from "node:assert/strict";
import { executableAvailable, requirePdfRenderer, requireKindleConverter, requireGio } from "../../apps/api/src/services/runtimeDependencies.ts";

test("missing optional tools give actionable errors without invoking a provider", async () => {
  assert.equal(await executableAvailable(process.execPath), true);
  const missing = "folio-nonexistent-tool-for-test";
  assert.equal(await executableAvailable(missing), false);
  const names = ["PDF_RENDER_COMMAND", "EBOOK_CONVERT_COMMAND", "GIO_COMMAND"];
  const previous = names.map(name => process.env[name]);
  try {
    for (const name of names) process.env[name] = missing;
    await assert.rejects(requirePdfRenderer(), /PDF con texto seleccionable/);
    await assert.rejects(requireKindleConverter(), /descarga el EPUB/);
    await assert.rejects(requireGio(), /transferirlo manualmente/);
  } finally {
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
  }
});
