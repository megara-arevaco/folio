import test from "node:test";
import assert from "node:assert/strict";
import AdmZip from "adm-zip";
import {
  buildPdfEpub,
  collectParagraphsFromTextLines,
  getPdfProgress,
  getPdfImageObjectContainer,
  buildSectionsFromPages,
  extractParagraphsFromTextItems,
  stripRepeatedPageHeaders,
  stripRepeatedPageFooters,
  type PdfDocumentStructure,
} from "./pdf";

test("collectParagraphsFromTextLines merges adjacent lines into paragraphs and preserves headings", () => {
  const paragraphs = collectParagraphsFromTextLines([
    "Chapter 1",
    "",
    "This is the first line of a paragraph",
    "that continues on the next line.",
    "",
    "A second paragraph starts here.",
  ]);

  assert.deepEqual(paragraphs, [
    "Chapter 1",
    "This is the first line of a paragraph that continues on the next line.",
    "A second paragraph starts here.",
  ]);
});

test("buildPdfEpub creates a valid epub package with navigation and images", () => {
  const document: PdfDocumentStructure = {
    title: "Sample PDF",
    author: "Unknown",
    sections: [
      {
        id: "section-1",
        title: "Opening",
        blocks: [
          { type: "paragraph", text: "First paragraph from the PDF." },
          {
            type: "image",
            alt: "Cover image",
            mediaType: "image/png",
            fileName: "cover.png",
            data: Buffer.from("fake-image"),
          },
          { type: "paragraph", text: "Second paragraph after the image." },
        ],
      },
    ],
  };

  const buffer = buildPdfEpub(document);
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries().map((entry) => entry.entryName);

  assert.ok(entries.includes("mimetype"));
  assert.ok(entries.includes("META-INF/container.xml"));
  assert.ok(entries.includes("OEBPS/content.opf"));
  assert.ok(entries.includes("OEBPS/nav.xhtml"));
  assert.ok(entries.includes("OEBPS/sections/section-1.xhtml"));
  assert.ok(entries.includes("OEBPS/images/cover.png"));

  const mimetype = zip.readAsText("mimetype");
  assert.equal(mimetype, "application/epub+zip");

  const section = zip.readAsText("OEBPS/sections/section-1.xhtml");
  assert.match(section, /First paragraph from the PDF\./);
  assert.match(section, /img src="\.\.\/images\/cover\.png"/);
  assert.match(section, /Second paragraph after the image\./);

  const nav = zip.readAsText("OEBPS/nav.xhtml");
  assert.match(nav, /Opening/);

  const opf = zip.readAsText("OEBPS/content.opf");
  assert.match(opf, /Sample PDF/);
  assert.match(opf, /images\/cover\.png/);
});

test("getPdfProgress reports completed pages instead of the in-flight page", () => {
  assert.deepEqual(getPdfProgress(0, 228, "Analizando pagina 1 de 228"), {
    current: 0,
    total: 228,
    message: "Analizando pagina 1 de 228",
  });

  assert.deepEqual(getPdfProgress(227, 228, "Analizando pagina 228 de 228"), {
    current: 227,
    total: 228,
    message: "Analizando pagina 228 de 228",
  });
});

test("getPdfImageObjectContainer routes shared image ids to common objects", () => {
  assert.equal(getPdfImageObjectContainer("img_p227_1"), "page");
  assert.equal(getPdfImageObjectContainer("g_d0_img_p227_1"), "common");
});

test("stripRepeatedPageHeaders removes running headers repeated on every page", () => {
  const pages = [
    ["Introduction", "Nos Book of Resurrection", "First actual paragraph."],
    ["Introduction", "Nos Book of Resurrection", "Second actual paragraph."],
    ["Introduction", "Nos Book of Resurrection", "Third actual paragraph."],
  ];

  assert.deepEqual(stripRepeatedPageHeaders(pages), [
    ["First actual paragraph."],
    ["Second actual paragraph."],
    ["Third actual paragraph."],
  ]);
});

test("stripRepeatedPageFooters removes running page numbers", () => {
  assert.deepEqual(stripRepeatedPageFooters([
    ["First paragraph", "1"],
    ["Second paragraph", "2"],
    ["Third paragraph", "3"],
  ]), [
    ["First paragraph"],
    ["Second paragraph"],
    ["Third paragraph"],
  ]);
});

test("buildSectionsFromPages creates chapters only from explicit headings", () => {
  const sections = buildSectionsFromPages([
    ["Chapter One", "First paragraph"],
    ["Second paragraph."],
    ["Chapter Two", "Another paragraph"],
  ]);

  assert.equal(sections.length, 2);
  assert.equal(sections[0]?.title, "Chapter One");
  assert.equal(sections[0]?.blocks.length, 2);
  assert.equal(sections[1]?.title, "Chapter Two");
});

test("buildSectionsFromPages recognises Spanish introduction headings", () => {
  const sections = buildSectionsFromPages([
    ["Portada"],
    ["INTRODUCCION", "Texto introductorio."],
  ]);

  assert.equal(sections.length, 2);
  assert.equal(sections[0]?.title, "Preliminares");
  assert.equal(sections[1]?.title, "INTRODUCCION");
});

test("buildSectionsFromPages joins a numbered heading with uppercase title lines", () => {
  const sections = buildSectionsFromPages([
    ["1.", "EL PRINCIPIO", "Texto del capítulo."],
    ["2.", "LA REALEZA", "Texto siguiente."],
  ]);

  assert.equal(sections.length, 2);
  assert.equal(sections[0]?.title, "1. EL PRINCIPIO");
  assert.equal(sections[1]?.title, "2. LA REALEZA");
});

test("extractParagraphsFromTextItems creates paragraphs from vertical gaps", () => {
  const paragraphs = extractParagraphsFromTextItems([
    { str: "First", transform: [1, 0, 0, 10, 10, 700] },
    { str: "line.", transform: [1, 0, 0, 10, 45, 700] },
    { str: "Second", transform: [1, 0, 0, 10, 10, 686] },
    { str: "line.", transform: [1, 0, 0, 10, 55, 686] },
    { str: "New paragraph.", transform: [1, 0, 0, 10, 10, 650] },
  ]);

  assert.deepEqual(paragraphs, ["First line. Second line.", "New paragraph."]);
});

test("buildPdfEpub can render text-only sections without embedding images", () => {
  const document: PdfDocumentStructure = {
    title: "Text Only",
    sections: [
      {
        id: "section-1",
        title: "Opening",
        blocks: [{ type: "paragraph", text: "Only text should remain." }],
      },
    ],
  };

  const buffer = buildPdfEpub(document);
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries().map((entry) => entry.entryName);

  assert.ok(!entries.some((entry) => entry.startsWith("OEBPS/images/")));
  const section = zip.readAsText("OEBPS/sections/section-1.xhtml");
  assert.doesNotMatch(section, /<img /);
});
