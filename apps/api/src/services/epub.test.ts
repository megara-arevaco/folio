import test from "node:test";
import assert from "node:assert/strict";
import {
  collectTextNodes,
  replaceTextNodes,
  recombineTranslatedItems,
  splitLongTextItems,
  validateTranslation,
  type TextItem,
} from "./epub";
import * as cheerio from "cheerio";

test("validateTranslation rejects missing or empty translated fragments", () => {
  assert.throws(() => validateTranslation(
    [{ id: "a", text: "Hello" }],
    [],
  ), /exactamente todos/);
  assert.throws(() => validateTranslation(
    [{ id: "a", text: "Hello" }],
    [{ id: "a", text: "" }],
  ), /traduccion vacia/);
});

test("splitLongTextItems fragments oversized items and recombines them by original id", () => {
  const originalText =
    "This is a very long paragraph. ".repeat(140) +
    "Another sentence keeps the fragment above the conservative batching threshold.";

  const items: TextItem[] = [{ id: "0_0", text: originalText }];

  const fragments = splitLongTextItems(items);

  assert.ok(fragments.length > 1);
  assert.ok(fragments.every((item) => item.id.startsWith("0_0__part")));

  const recombined = recombineTranslatedItems(fragments);

  assert.deepEqual(recombined, items);
});

test("replaceTextNodes keeps ids aligned when html contains whitespace text nodes", () => {
  const html = `
    <html>
      <body>
        <p>First paragraph.</p>
        <p>Second paragraph.</p>
      </body>
    </html>
  `;

  const $ = cheerio.load(html);
  const items = collectTextNodes($, 0);
  const translatedMap = new Map<string, string>([
    [items[0]!.id, "Primer parrafo."],
    [items[1]!.id, "Segundo parrafo."],
  ]);

  replaceTextNodes($, 0, translatedMap);

  const rendered = $.html();
  assert.match(rendered, /Primer parrafo\./);
  assert.match(rendered, /Segundo parrafo\./);
  assert.doesNotMatch(rendered, /First paragraph\./);
  assert.doesNotMatch(rendered, /Second paragraph\./);
});

test("replaceTextNodes translates navigation titles in ncx xml", () => {
  const ncx = `
    <ncx xmlns="http://www.daisy.org/z3986/2005/ncx/">
      <navMap>
        <navPoint id="navPoint-1">
          <navLabel>
            <text>Chapter One</text>
          </navLabel>
        </navPoint>
        <navPoint id="navPoint-2">
          <navLabel>
            <text>Chapter Two</text>
          </navLabel>
        </navPoint>
      </navMap>
    </ncx>
  `;

  const $ = cheerio.load(ncx, { xmlMode: true });
  const items = collectTextNodes($, 0);
  const translatedMap = new Map<string, string>([
    [items[0]!.id, "Capitulo Uno"],
    [items[1]!.id, "Capitulo Dos"],
  ]);

  replaceTextNodes($, 0, translatedMap);

  const rendered = $.xml();
  assert.match(rendered, /Capitulo Uno/);
  assert.match(rendered, /Capitulo Dos/);
  assert.doesNotMatch(rendered, /Chapter One/);
  assert.doesNotMatch(rendered, /Chapter Two/);
});
