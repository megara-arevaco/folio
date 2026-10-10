import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import * as cheerio from "cheerio";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { openValidatedZip } from "./shared/zip";
import { checkPdfPageCount, integerSetting, maxDocumentBytes } from "./shared/limits";
import { extractParagraphsFromTextItems } from "./pdf";
import { processPdfWithOpenRouter } from "./pdfOpenRouter";
import { pdfHtmlText, sanitizePdfHtml, type ExtractedPdfPage } from "./pdfBook";
import { getOpenRouterSettingsStatus } from "./openRouterSettings";
import { getAiBudgetSnapshot, type AiBudgetContext } from "./aiBudget";
import { randomUUID } from "node:crypto";
import { translateBatch } from "./llm";
import type { TextItem } from "../types";

const SAMPLE_PAGE_LIMIT = 3;
const EPUB_SAMPLE_CHAR_LIMIT = 2000;

export type ProcessingPreflight = {
  translation: {
    provider: "OpenRouter" | "custom";
    mode: "mock" | "live";
    model: string | null;
    keyConfigured: boolean;
    batchTokenEstimate: number;
    hardTotalTokenLimit: null;
  };
  pdf: {
    provider: "local" | "OpenRouter";
    mode: "local" | "live";
    model: string | null;
    maxPages: number;
    maxOutputTokensPerRequest: number | null;
    hardTotalSpendLimit: null;
  };
  costEstimate: null;
  costNote: string;
  aiBudget: Awaited<ReturnType<typeof getAiBudgetSnapshot>>;
};

export async function getProcessingPreflight(): Promise<ProcessingPreflight> {
  const customBase = process.env.LLM_API_BASE_URL && !/openrouter\.ai/i.test(process.env.LLM_API_BASE_URL);
  const pdfProvider = process.env.PDF_CONVERSION_PROVIDER || "openrouter";
  const pdfLive = pdfProvider === "openrouter";
  const status = getOpenRouterSettingsStatus();
  const aiBudget = await getAiBudgetSnapshot();
  return {
    translation: {
      provider: customBase ? "custom" : "OpenRouter",
      mode: process.env.LLM_MOCK === "true" ? "mock" : "live",
      model: process.env.LLM_MODEL?.trim() || null,
      keyConfigured: status.configured,
      batchTokenEstimate: 600,
      hardTotalTokenLimit: null,
    },
    pdf: {
      provider: pdfLive ? "OpenRouter" : "local",
      mode: pdfLive ? "live" : "local",
      model: pdfLive ? process.env.PDF_OPENROUTER_MODEL?.trim() || "google/gemini-3.8-flash" : null,
      maxPages: integerSetting("PDF_MAX_PAGES", 2000, 1, 10000),
      maxOutputTokensPerRequest: pdfLive ? integerSetting("PDF_MAX_OUTPUT_TOKENS", 24000, 1000, 128000) : null,
      hardTotalSpendLimit: null,
    },
    costEstimate: null,
    costNote: "No se puede calcular un coste fiable sin precios vigentes del proveedor, tokenizador del modelo y número de reintentos. Una vista previa remota también puede generar consumo. Los límites Folio no sustituyen cuotas del proveedor ni controlan consumos hechos fuera de Folio.",
    aiBudget,
  };
}

function epubSampleItems(buffer: Buffer): { items: TextItem[]; chapter: string; textCharacters: number; chapterCount: number } {
  const zip = openValidatedZip(buffer);
  const chapters = zip.getEntries().filter((entry) => {
    if (entry.isDirectory || !/\.(?:xhtml|html|htm)$/i.test(entry.entryName)) return false;
    return !/(?:^|\/)(?:nav|toc|cover|titlepage)(?:\.[^/]*)?$/i.test(entry.entryName);
  });
  let chapterCount = chapters.length;
  let selectedChapter = "";
  let items: TextItem[] = [];
  let textCharacters = 0;
  for (const entry of chapters) {
    const $ = cheerio.load(entry.getData().toString("utf8"), { xmlMode: /\.xhtml$/i.test(entry.entryName) });
    const extracted = $("body").length ? $("body").text() : $.root().text();
    textCharacters += extracted.length;
    let nodes: TextItem[] = [];
    $("body").contents().each((index, node) => {
      const text = $(node).text().replace(/\s+/g, " ").trim();
      if (text) nodes.push({ id: `sample-${index}`, text });
    });
    if (!nodes.length) {
      const text = extracted.replace(/\s+/g, " ").trim();
      if (text) nodes = [{ id: "sample-0", text }];
    }
    if (!items.length && nodes.length) {
      selectedChapter = entry.entryName;
      items = [];
      let remaining = EPUB_SAMPLE_CHAR_LIMIT;
      for (const item of nodes) {
        if (remaining <= 0) break;
        const text = item.text.slice(0, remaining);
        items.push({ ...item, text });
        remaining -= text.length;
      }
    }
  }
  chapterCount = chapters.length;
  return { items, chapter: selectedChapter, textCharacters, chapterCount };
}

export async function previewEpubTranslation(buffer: Buffer) {
  const { items, chapter, textCharacters, chapterCount } = epubSampleItems(buffer);
  if (!items.length) throw new Error("No se ha encontrado texto de capítulo para previsualizar");
  const budgetContext: AiBudgetContext = { kind: "sample", id: randomUUID() };
  const translated = await translateBatch(items, [], "", false, budgetContext);
  const translatedById = new Map(translated.map((item) => [item.id, item.text]));
  return {
    chapter,
    chapterCount,
    textCharacters,
    sample: items.map((item) => ({ source: item.text, result: translatedById.get(item.id) ?? "" })),
    sampleCharacters: items.reduce((sum, item) => sum + item.text.length, 0),
    mock: process.env.LLM_MOCK === "true",
    originalsModified: false as const,
  };
}

async function previewLocalPdf(buffer: Buffer) {
  const loadingTask = getDocument({ data: new Uint8Array(buffer), useWorkerFetch: false, isOffscreenCanvasSupported: false, disableFontFace: true });
  try {
    const document = await loadingTask.promise;
    checkPdfPageCount(document.numPages);
    const pages = [];
    for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, SAMPLE_PAGE_LIMIT); pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const paragraphs = extractParagraphsFromTextItems(content.items as Array<{ str?: string; transform?: number[]; hasEOL?: boolean }>);
      const text = paragraphs.join("\n\n").trim();
      pages.push({ page: pageNumber, text, needsOcr: text.replace(/[^\p{L}\p{N}]/gu, "").length < 40 });
      page.cleanup();
    }
    const outline = await document.getOutline().catch(() => null);
    const sampleText = pages.map((page) => page.text).join("\n").toLocaleLowerCase();
    const tocInSample = /(?:table of contents|contents|índice|indice|contenido|sommaire|inhaltsverzeichnis)/i.test(sampleText);
    const warnings = [
      ...(!outline?.length ? ["no-bookmarks" as const] : []),
      ...(!tocInSample ? ["no-index-in-sample" as const] : []),
      ...(pages.some((page) => page.needsOcr) ? ["ocr-needed" as const] : []),
    ];
    return { provider: "local" as const, pageCount: document.numPages, pages, structure: { bookmarkCount: outline?.length ?? 0, tocInSample, warnings }, originalsModified: false as const };
  } finally {
    await loadingTask.destroy();
  }
}

export async function previewPdf(buffer: Buffer, fileName: string) {
  if (buffer.byteLength > maxDocumentBytes()) throw new Error("El documento supera el tamaño permitido");
  const provider = process.env.PDF_CONVERSION_PROVIDER || "openrouter";
  if (provider === "local") return previewLocalPdf(buffer);
  if (provider !== "openrouter") throw new Error("PDF_CONVERSION_PROVIDER debe ser openrouter o local");

  const pdf = await PDFDocument.load(buffer, { updateMetadata: false });
  const pageCount = pdf.getPageCount();
  checkPdfPageCount(pageCount);
  const directory = await mkdtemp(join(tmpdir(), "folio-pdf-preview-"));
  const inputPath = join(directory, "sample.pdf");
  try {
    await writeFile(inputPath, buffer, { flag: "wx", mode: 0o600 });
    let extractedPages: ExtractedPdfPage[] = [];
    await processPdfWithOpenRouter(inputPath, {
      inputFileName: fileName,
      cacheDir: join(directory, "cache"),
      budgetContext: { kind: "sample", id: randomUUID() },
      pageLimit: SAMPLE_PAGE_LIMIT,
      onPreviewPages: (pages) => { extractedPages = pages; },
    });
    const pages = extractedPages.map((page) => ({
      page: page.page,
      text: pdfHtmlText(sanitizePdfHtml(page)),
      needsOcr: false,
    }));
    const warnings = pages.some((page) => page.needsOcr) ? ["ocr-needed"] : [];
    return { provider: "openrouter" as const, pageCount, pages, structure: { bookmarkCount: 0, tocInSample: pages.some((page) => /(?:table of contents|contents|índice|indice|contenido)/i.test(page.text)), warnings }, originalsModified: false as const };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
