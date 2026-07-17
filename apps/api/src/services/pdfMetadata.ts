import * as cheerio from "cheerio";
import {
  decodePDFRawStream,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFSignature,
  PDFStream,
  PDFString,
} from "pdf-lib";
import type { EpubMetadata } from "./epubMetadata";

const RDF_NAMESPACE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const DC_NAMESPACE = "http://purl.org/dc/elements/1.1/";

function localName(name: string): string {
  return name.split(":").pop()?.toLowerCase() ?? "";
}

function elementsByLocalName($: cheerio.CheerioAPI, name: string): cheerio.Cheerio<any> {
  return $("*").filter((_, element) => localName((element as { name?: string }).name ?? "") === name);
}

function dcElementsByLocalName($: cheerio.CheerioAPI, name: string): cheerio.Cheerio<any> {
  return $("*").filter((_, element) => {
    const elementName = ((element as { name?: string }).name ?? "").toLowerCase();
    return elementName === `dc:${name}`;
  });
}

function readXmp(pdf: PDFDocument): cheerio.CheerioAPI | null {
  try {
    const metadata = pdf.catalog.get(PDFName.of("Metadata"));
    if (!metadata) return null;
    const stream = pdf.context.lookupMaybe(metadata, PDFStream);
    if (!(stream instanceof PDFRawStream)) return null;
    const xml = new TextDecoder().decode(decodePDFRawStream(stream).decode());
    return cheerio.load(xml, { xmlMode: true });
  } catch {
    return null;
  }
}

function readXmpValues($: cheerio.CheerioAPI | null, name: string): string[] {
  if (!$) return [];
  const field = dcElementsByLocalName($, name).first();
  if (!field.length) return [];
  const items = field.find("*").filter((_, element) => localName(element.name) === "li");
  if (!items.length) {
    const value = field.text().trim();
    return value ? [value] : [];
  }
  return items.toArray().map((item) => $(item).text().trim()).filter(Boolean);
}

function setXmpField(
  $: cheerio.CheerioAPI,
  description: cheerio.Cheerio<any>,
  name: string,
  values: string[],
  container: "Alt" | "Bag" | "Seq",
): void {
  dcElementsByLocalName($, name).remove();
  const normalized = values.map((value) => value.trim()).filter(Boolean);
  if (!normalized.length) return;
  description.append(`<dc:${name}><rdf:${container}></rdf:${container}></dc:${name}>`);
  const field = dcElementsByLocalName($, name).last();
  const list = field.children().first();
  normalized.forEach((value, index) => {
    list.append(`<rdf:li${container === "Alt" && index === 0 ? " xml:lang=\"x-default\"" : ""}></rdf:li>`);
    list.children().last().text(value);
  });
}

function synchronizeXmp(pdf: PDFDocument, metadata: EpubMetadata): void {
  const $ = readXmp(pdf) ?? cheerio.load(
    `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="${RDF_NAMESPACE}"></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`,
    { xmlMode: true },
  );
  let rdf = elementsByLocalName($, "rdf").first();
  if (!rdf.length) {
    $("x\\:xmpmeta, xmpmeta").first().append(`<rdf:RDF xmlns:rdf="${RDF_NAMESPACE}"></rdf:RDF>`);
    rdf = elementsByLocalName($, "rdf").first();
  }
  let description = elementsByLocalName($, "description").first();
  if (!description.length) {
    rdf.append(`<rdf:Description rdf:about="" xmlns:dc="${DC_NAMESPACE}"></rdf:Description>`);
    description = elementsByLocalName($, "description").first();
  }
  if (!description.attr("xmlns:dc")) description.attr("xmlns:dc", DC_NAMESPACE);
  if (!rdf.attr("xmlns:rdf")) rdf.attr("xmlns:rdf", RDF_NAMESPACE);

  setXmpField($, description, "title", [metadata.title], "Alt");
  setXmpField($, description, "creator", metadata.authors, "Seq");
  setXmpField($, description, "language", [metadata.language], "Bag");
  setXmpField($, description, "publisher", [metadata.publisher], "Bag");
  setXmpField($, description, "description", [metadata.description], "Alt");

  const stream = pdf.context.flateStream(Buffer.from($.xml(), "utf-8"), {
    Type: "Metadata",
    Subtype: "XML",
  });
  pdf.catalog.set(PDFName.of("Metadata"), pdf.context.register(stream));
}

function readCatalogLanguage(pdf: PDFDocument): string {
  const language = pdf.catalog.lookupMaybe(
    PDFName.of("Lang"),
    PDFString,
    PDFHexString,
  );
  return language?.decodeText().trim() ?? "";
}

export async function readPdfMetadata(pdf: Buffer | Uint8Array): Promise<EpubMetadata> {
  const document = await PDFDocument.load(pdf, { updateMetadata: false });
  const xmp = readXmp(document);
  const xmpTitle = readXmpValues(xmp, "title")[0];
  const xmpAuthors = readXmpValues(xmp, "creator");
  const xmpLanguage = readXmpValues(xmp, "language")[0];
  const xmpPublisher = readXmpValues(xmp, "publisher")[0];
  const xmpDescription = readXmpValues(xmp, "description")[0];
  const author = document.getAuthor()?.trim() ?? "";

  return {
    title: xmpTitle ?? document.getTitle()?.trim() ?? "",
    authors: xmpAuthors.length ? xmpAuthors : author ? [author] : [],
    language: xmpLanguage ?? readCatalogLanguage(document),
    publisher: xmpPublisher ?? "",
    description: xmpDescription ?? document.getSubject()?.trim() ?? "",
  };
}

export async function updatePdfMetadataBuffer(
  pdf: Buffer | Uint8Array,
  metadata: EpubMetadata,
): Promise<Buffer> {
  const document = await PDFDocument.load(pdf, { updateMetadata: false });
  if (document.getForm().getFields().some((field) => field instanceof PDFSignature)) {
    throw new Error("El PDF contiene una firma digital");
  }
  document.setTitle(metadata.title, { showInWindowTitleBar: true });
  document.setAuthor(metadata.authors.join("; "));
  document.setLanguage(metadata.language);
  document.setSubject(metadata.description);
  document.setModificationDate(new Date());
  synchronizeXmp(document, metadata);
  return Buffer.from(await document.save());
}
