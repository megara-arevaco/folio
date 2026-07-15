import test from "node:test";
import assert from "node:assert/strict";
import { getProgressValue } from "./EpubTranslationStatus";

test("getProgressValue caps in-flight work below 100 until done", () => {
  assert.equal(
    getProgressValue("processing", {
      current: 228,
      total: 228,
      message: "Generando EPUB",
    }),
    99,
  );

  assert.equal(
    getProgressValue("done", {
      current: 228,
      total: 228,
      message: "Listo",
    }),
    100,
  );
});
