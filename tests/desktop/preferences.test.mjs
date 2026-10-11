import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPreferences, writeLanguage } from "../../apps/desktop/preferences.mjs";

test("desktop language persists independently of the browser origin and rejects invalid values", async () => {
  const profile = await mkdtemp(join(tmpdir(), "folio-preferences-"));
  try {
    assert.equal(readPreferences(profile).language, "es");
    writeLanguage(profile, "en");
    assert.equal(readPreferences(profile).language, "en");
    assert.throws(() => writeLanguage(profile, "../../unexpected"), /Idioma no admitido/);
    assert.equal(readPreferences(profile).language, "en");
    const path = join(profile, "desktop-preferences.json");
    await writeFile(path, "corrupt-json");
    assert.throws(() => readPreferences(profile), /Se conserva/);
    assert.equal(await readFile(path, "utf8"), "corrupt-json");
  } finally { await rm(profile, { recursive: true, force: true }); }
});
