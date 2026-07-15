import test from "node:test";
import assert from "node:assert/strict";
import { kindleOutputFileName, prepareKindleUpload } from "./kindle";

test("kindleOutputFileName preserves the book name and changes the extension", () => {
  assert.equal(kindleOutputFileName("Mi libro traducido.epub"), "Mi libro traducido.azw3");
});

test("prepareKindleUpload leaves Kindle-compatible files unchanged", async () => {
  const data = Buffer.from("azw3");
  const prepared = await prepareKindleUpload(data, "book.azw3");
  assert.equal(prepared.data, data);
  assert.equal(prepared.fileName, "book.azw3");
  assert.equal(prepared.converted, false);
});
