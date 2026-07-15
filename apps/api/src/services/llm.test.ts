import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanTranslationText,
  normalizeTranslationResponse,
  parseJsonContent,
  type TextItem,
} from "./llm";

test("cleanTranslationText removes model artefacts without changing punctuation", () => {
  assert.equal(cleanTranslationText("  [ES] Traducción:  Hola   mundo.  "), "Hola mundo.");
  assert.equal(cleanTranslationText("¡Hola!\n  Mundo."), "¡Hola!\nMundo.");
});

test("normalizeTranslationResponse accepts object-wrapped items for json_object mode", () => {
  const expected: TextItem[] = [
    { id: "t1", text: "Hola" },
    { id: "t2", text: "Mundo" },
  ];

  const normalized = normalizeTranslationResponse({
    items: expected,
  });

  assert.deepEqual(normalized, expected);
});

test("normalizeTranslationResponse keeps plain array responses working", () => {
  const expected: TextItem[] = [{ id: "t1", text: "Hola" }];

  const normalized = normalizeTranslationResponse(expected);

  assert.deepEqual(normalized, expected);
});

test("parseJsonContent recovers JSON wrapped in model commentary", () => {
  const parsed = parseJsonContent('Aquí tienes la traducción:\n{"items":[{"id":"t1","text":"Hola"}]}\nListo.');

  assert.deepEqual(parsed, { items: [{ id: "t1", text: "Hola" }] });
});

test("parseJsonContent ignores braces inside JSON strings", () => {
  const parsed = parseJsonContent('Respuesta: {"items":[{"id":"t1","text":"Usa {llaves} aquí"}]}');

  assert.deepEqual(parsed, { items: [{ id: "t1", text: "Usa {llaves} aquí" }] });
});
