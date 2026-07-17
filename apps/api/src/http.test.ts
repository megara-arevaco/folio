import test from "node:test";
import assert from "node:assert/strict";
import { attachmentContentDisposition } from "./http";

test("attachmentContentDisposition safely encodes Unicode file names", () => {
  const header = attachmentContentDisposition("Sabiduría práctica — edición.epub");

  assert.equal(
    header,
    "attachment; filename=\"book.epub\"; filename*=UTF-8''Sabidur%C3%ADa%20pr%C3%A1ctica%20%E2%80%94%20edici%C3%B3n.epub",
  );
  assert.match(header, /^[\x20-\x7e]+$/);
});

test("attachmentContentDisposition strips control characters", () => {
  const header = attachmentContentDisposition("book\r\nInjected.epub");

  assert.doesNotMatch(header, /[\r\n]/);
  assert.match(header, /book--Injected\.epub/);
});
