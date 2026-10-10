import { writeFileAtomically } from "./shared/files";
import { readDocument, checkPdfPageCount, integerSetting } from "./shared/limits";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";
import AdmZip from "adm-zip";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createWorker, type Worker } from "tesseract.js";
import type { JobProgress } from "../types";
import { PauseRequestedError } from "./epub";
import { processPdfWithOpenRouter } from "./pdfOpenRouter";

export type PdfSectionBlock =
  | { type: "paragraph"; text: string }
  | {
      type: "image";
      alt: string;
      mediaType: string;
      fileName: string;
      data: Buffer;
    };

export type PdfDocumentSection = {
  id: string;
  title?: string;
  blocks: PdfSectionBlock[];
};

export type PdfDocumentStructure = {
  title: string;
  author?: string;
  language?: string;
  sections: PdfDocumentSection[];
};

export type ProcessPdfOptions = {
  onProgress?: (progress: JobProgress) => void;
  shouldPause?: () => boolean;
  inputFileName?: string;
  cacheDir?: string;
  onCheckpoint?: (completedPages: number, totalPages: number) => void | Promise<void>;
};

type PdfTextItem = {
  str?: string;
  transform?: number[];
  hasEOL?: boolean;
};

const execFileAsync = promisify(execFile);

export function getPdfProgress(
  completedPages: number,
  totalPages: number,
  message: string,
): JobProgress {
  return {
    current: Math.max(0, Math.min(completedPages, totalPages)),
    total: Math.max(1, totalPages),
    message,
  };
}

export function getPdfImageObjectContainer(objectId: string): "common" | "page" {
  return objectId.startsWith("g_") ? "common" : "page";
}

export function stripRepeatedPageHeaders(pages: string[][]): string[][] {
  if (pages.length < 2) {
    return pages;
  }

  const candidateHeaderCount = Math.min(
    3,
    ...pages.map((page) => page.length),
  );

  const repeatedHeaders = new Set<string>();

  for (let index = 0; index < candidateHeaderCount; index += 1) {
    const firstLine = pages[0]?.[index]?.trim();
    if (!firstLine) {
      continue;
    }

    const appearsOnEveryPage = pages.every((page) => page[index]?.trim() === firstLine);
    if (appearsOnEveryPage) {
      repeatedHeaders.add(firstLine);
    }
  }

  if (repeatedHeaders.size === 0) {
    return pages;
  }

  return pages.map((page) => {
    const nextPage = [...page];
    while (nextPage.length > 0 && repeatedHeaders.has(nextPage[0]!.trim())) {
      nextPage.shift();
    }
    return nextPage;
  });
}

export function stripRepeatedPageFooters(pages: string[][]): string[][] {
  if (pages.length < 2) return pages;

  const repeated = new Set<string>();
  const candidateCount = Math.min(2, ...pages.map((page) => page.length));
  for (let offset = 1; offset <= candidateCount; offset += 1) {
    const footer = pages[0]?.[pages[0].length - offset]?.trim();
    if (footer && (pages.every((page) => page[page.length - offset]?.trim() === footer) ||
      pages.every((page) => /^\d+$/.test(page[page.length - offset]?.trim() ?? "")))) {
      repeated.add(footer);
    }
  }

  return pages.map((page) => {
    const nextPage = [...page];
    while (nextPage.length > 0 && (repeated.has(nextPage[nextPage.length - 1]!.trim()) || /^\d+$/.test(nextPage[nextPage.length - 1]!.trim()))) nextPage.pop();
    return nextPage;
  });
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizeSectionId(value: string, fallbackIndex: number): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || `section-${fallbackIndex + 1}`;
}

export function collectParagraphsFromTextLines(lines: string[]): string[] {
  const paragraphs: string[] = [];
  let current = "";

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line.length === 0) {
      if (current.length > 0) {
        paragraphs.push(current.trim());
        current = "";
      }
      continue;
    }

    if (current.length === 0) {
      current = line;
      continue;
    }

    current += `${current.endsWith("-") ? "" : " "}${line}`;
  }

  if (current.length > 0) {
    paragraphs.push(current.trim());
  }

  return paragraphs;
}

function renderSection(section: PdfDocumentSection): string {
  const title = section.title?.trim();
  const content = section.blocks
    .map((block) => {
      if (block.type === "paragraph") {
        return `<p>${escapeXml(block.text)}</p>`;
      }

      return `<figure><img src="../images/${escapeXml(block.fileName)}" alt="${escapeXml(block.alt)}" /></figure>`;
    })
    .join("\n    ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="es">
  <head>
    <title>${escapeXml(title ?? section.id)}</title>
    <meta charset="utf-8" />
  </head>
  <body>
    ${title ? `<h1>${escapeXml(title)}</h1>` : ""}
    ${content}
  </body>
</html>`;
}

function renderNavigation(sections: PdfDocumentSection[]): string {
  const items = sections
    .map(
      (section) =>
        `<li><a href="sections/${escapeXml(section.id)}.xhtml">${escapeXml(section.title ?? section.id)}</a></li>`,
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="es">
  <head>
    <title>Indice</title>
    <meta charset="utf-8" />
  </head>
  <body>
    <nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops">
      <h1>Indice</h1>
      <ol>${items}</ol>
    </nav>
  </body>
</html>`;
}

function renderPackage(document: PdfDocumentStructure, sections: PdfDocumentSection[]): string {
  const manifestItems = [
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    ...sections.map(
      (section) =>
        `<item id="${escapeXml(section.id)}" href="sections/${escapeXml(section.id)}.xhtml" media-type="application/xhtml+xml"/>`,
    ),
    ...sections.flatMap((section) =>
      section.blocks.flatMap((block, index) =>
        block.type === "image"
          ? [
              `<item id="${escapeXml(section.id)}-image-${index}" href="images/${escapeXml(block.fileName)}" media-type="${escapeXml(block.mediaType)}"/>`,
            ]
          : [],
      ),
    ),
  ].join("\n    ");

  const spineItems = sections
    .map((section) => `<itemref idref="${escapeXml(section.id)}" />`)
    .join("\n    ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:${randomUUID()}</dc:identifier>
    <dc:title>${escapeXml(document.title)}</dc:title>
    <dc:language>${escapeXml(document.language ?? "es")}</dc:language>
    <dc:creator>${escapeXml(document.author ?? "Desconocido")}</dc:creator>
  </metadata>
  <manifest>
    ${manifestItems}
  </manifest>
  <spine>
    ${spineItems}
  </spine>
</package>`;
}

export function buildPdfEpub(document: PdfDocumentStructure): Buffer {
  const zip = new AdmZip();
  const sections = document.sections.map((section, index) => ({
    ...section,
    id: normalizeSectionId(section.id || section.title || `section-${index + 1}`, index),
  }));

  zip.addFile("mimetype", Buffer.from("application/epub+zip", "utf-8"));
  zip.addFile(
    "META-INF/container.xml",
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
      "utf-8",
    ),
  );
  zip.addFile("OEBPS/nav.xhtml", Buffer.from(renderNavigation(sections), "utf-8"));
  zip.addFile("OEBPS/content.opf", Buffer.from(renderPackage(document, sections), "utf-8"));

  for (const section of sections) {
    zip.addFile(
      `OEBPS/sections/${section.id}.xhtml`,
      Buffer.from(renderSection(section), "utf-8"),
    );

    for (const block of section.blocks) {
      if (block.type === "image") {
        zip.addFile(`OEBPS/images/${block.fileName}`, block.data);
      }
    }
  }

  return zip.toBuffer();
}

function isChapterHeading(value: string): boolean {
  const text = value.trim();
  if (text.length < 3 || text.length > 120 || /[.!?;:]$/.test(text)) return false;
  if (/^(?:introducci[oó]n|pr[oó]logo|ep[ií]logo|conclusi[oó]n|ap[eé]ndice)$/i.test(text)) return true;
  if (/^(?:cap[ií]tulo|chapter|parte|part|libro|book)\s+(?:[\divxlcdm]+|[a-záéíóúñ].*)$/i.test(text)) return true;
  return /^(?:[ivxlcdm]+[.)]\s+)[A-ZÁÉÍÓÚÜÑ0-9][A-ZÁÉÍÓÚÜÑ0-9 \-—]{2,}$/u.test(text);
}

function isNumberedHeading(value: string): boolean {
  return /^(?:\d{1,3}|[ivxlcdm]+)[.)]$/i.test(value.trim());
}

function isUppercaseHeading(value: string): boolean {
  const text = value.trim();
  const letters = text.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, "");
  return letters.length >= 4 && text.length <= 120 && text === text.toLocaleUpperCase("es-ES") && !/[.!?;:]$/.test(text);
}

type PositionedLine = {
  text: string;
  y: number;
  height: number;
};

export function extractParagraphsFromTextItems(items: PdfTextItem[]): string[] {
  const ordered = [...items]
    .filter((item) => item.str?.trim())
    .sort((left, right) => {
      const leftY = left.transform?.[5] ?? 0;
      const rightY = right.transform?.[5] ?? 0;
      if (Math.abs(leftY - rightY) > 2) return rightY - leftY;
      return (left.transform?.[4] ?? 0) - (right.transform?.[4] ?? 0);
    });
  const lines: PositionedLine[] = [];
  let current: PositionedLine | null = null;

  for (const item of ordered) {
    const text = item.str!.trim();
    const y = item.transform?.[5] ?? 0;
    const height = Math.max(1, Math.abs(item.transform?.[3] ?? 10));
    if (!current || Math.abs(current.y - y) > 2.5) {
      if (current?.text) lines.push(current);
      current = { text, y, height };
      continue;
    }
    current.text += `${current.text.endsWith("-") ? "" : " "}${text}`;
    current.height = Math.max(current.height, height);
  }
  if (current?.text) lines.push(current);

  const paragraphs: string[] = [];
  let paragraph = "";
  let previous: PositionedLine | null = null;
  for (const line of lines) {
    const gap = previous ? previous.y - line.y : 0;
    const beginsParagraph = previous !== null && gap > Math.max(previous.height * 1.45, 11);
    if (beginsParagraph && paragraph) {
      paragraphs.push(paragraph.trim());
      paragraph = "";
    }
    paragraph += `${paragraph.length === 0 || paragraph.endsWith("-") ? "" : " "}${line.text}`;
    previous = line;
  }
  if (paragraph) paragraphs.push(paragraph.trim());
  return paragraphs;
}

export function buildSectionsFromPages(
  pages: string[][],
): PdfDocumentSection[] {
  const fallback = () => pages.map((paragraphs, pageIndex) => ({
    id: `page-${pageIndex + 1}`,
    title: `Página ${pageIndex + 1}`,
    blocks: paragraphs.length > 0
      ? paragraphs.map((text) => ({ type: "paragraph", text } satisfies PdfSectionBlock))
      : [{ type: "paragraph", text: "No se pudo extraer contenido util de esta página." } satisfies PdfSectionBlock],
  }));
  const sections: PdfDocumentSection[] = [];
  let current: PdfDocumentSection = { id: "front-matter", title: "Preliminares", blocks: [] };
  let foundHeading = false;

  const paragraphs = pages.flat();
  for (let index = 0; index < paragraphs.length; index += 1) {
    const text = paragraphs[index]!.trim();
    let heading: string | null = null;
    let consumed = 0;

    if (isNumberedHeading(text)) {
      const titleLines: string[] = [];
      for (let offset = 1; offset <= 3; offset += 1) {
        const candidate = paragraphs[index + offset]?.trim();
        if (!candidate || !isUppercaseHeading(candidate)) break;
        titleLines.push(candidate);
      }
      if (titleLines.length > 0) {
        heading = `${text} ${titleLines.join(" ")}`;
        consumed = titleLines.length;
      }
    } else if (isChapterHeading(text) || (foundHeading && isUppercaseHeading(text))) {
      heading = text;
    }

    if (heading) {
      foundHeading = true;
      if (current.blocks.length > 0) sections.push(current);
      current = { id: `chapter-${sections.length + 1}`, title: heading, blocks: [] };
      index += consumed;
    } else {
      current.blocks.push({ type: "paragraph", text });
    }
  }
  if (current.blocks.length > 0) sections.push(current);

  return foundHeading && sections.length > 0 ? sections : fallback();
}

async function ocrPage(
  pdfPath: string,
  pageNumber: number,
  worker: Worker,
): Promise<string[]> {
  const tempDir = await mkdtemp(join(process.cwd(), "tmp-pdf-ocr-"));
  const outputBase = join(tempDir, `page-${pageNumber}`);
  try {
    const command = process.env.PDF_RENDER_COMMAND ?? "pdftoppm";
    await execFileAsync(command, ["-png", "-scale-to", "2400", "-f", String(pageNumber), "-l", String(pageNumber), "-singlefile", pdfPath, outputBase], { timeout: integerSetting("PDF_OCR_TIMEOUT_MS", 120000, 1000, 900000), maxBuffer: 1024 * 1024 });
    const image = await readFile(`${outputBase}.png`);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        reject(new Error("El OCR ha superado el tiempo permitido"));
        void worker.terminate().catch(() => undefined);
      }, integerSetting("PDF_OCR_TIMEOUT_MS", 120000, 1000, 900000));
    });
    const result = await Promise.race([worker.recognize(image), deadline]).finally(() => clearTimeout(timeout));
    return result.data.text.split(/\r?\n/).map((line) => line.trim());
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function getAvailableOcrLanguages(requested: string, dataPath: string): Promise<{
  languages: string;
  langPath?: string;
}> {
  const codes = requested.split("+").map((code) => code.trim()).filter(Boolean);
  const available: string[] = [];

  for (const code of codes) {
    let hasData = false;
    for (const fileName of [`${code}.traineddata`, `${code}.traineddata.gz`]) {
      try {
        await access(join(dataPath, fileName));
        hasData = true;
        break;
      } catch {
        continue;
      }
    }
    if (hasData) available.push(code);
  }

  if (available.length > 0) {
    return { languages: available.join("+"), langPath: dataPath };
  }

  // Let Tesseract.js use its default language-data source when no local file exists.
  return { languages: requested };
}

export async function processPdfToEpub(
  pdfPath: string,
  options: ProcessPdfOptions = {},
): Promise<Buffer> {
  const provider = process.env.PDF_CONVERSION_PROVIDER || "openrouter";
  if (provider === "openrouter") return processPdfWithOpenRouter(pdfPath, options);
  if (provider === "local") return processLocalPdfToEpub(pdfPath, options);
  throw new Error("PDF_CONVERSION_PROVIDER debe ser openrouter o local");
}

async function processLocalPdfToEpub(
  pdfPath: string,
  options: ProcessPdfOptions = {},
): Promise<Buffer> {
  const { onProgress, shouldPause } = options;
  const enableOcr = process.env.PDF_OCR !== "false";
  const ocrLanguage = process.env.PDF_OCR_LANG ?? "eng";
  const buffer = await readDocument(pdfPath);
  const fingerprint = createHash("sha256").update(buffer).update(JSON.stringify({ version: 1, enableOcr, ocrLanguage,
    renderer: process.env.PDF_RENDER_COMMAND ?? "pdftoppm", tessdata: process.env.TESSDATA_PREFIX ?? process.cwd() })).digest("hex");
  const cacheDir = join(options.cacheDir ?? join(dirname(pdfPath), "pdf-local-cache"), fingerprint);
  await mkdir(cacheDir, { recursive: true });
  const pdfData = new Uint8Array(buffer);
  const loadingTask = getDocument({
    data: pdfData,
    useWorkerFetch: false,
    isOffscreenCanvasSupported: false,
    disableFontFace: true,
  });
  let ocrWorker: Worker | null = null;
  let selectedOcrLanguage: { languages: string; langPath?: string } | null = null;

  try {
    const pdfDocument = await loadingTask.promise;
    checkPdfPageCount(pdfDocument.numPages);
    const pageParagraphs: string[][] = [];

    onProgress?.(getPdfProgress(0, pdfDocument.numPages, "Leyendo PDF"));

    for (let pageIndex = 0; pageIndex < pdfDocument.numPages; pageIndex += 1) {
      if (shouldPause?.()) {
        throw new PauseRequestedError();
      }

      const checkpointPath = join(cacheDir, `page-${pageIndex + 1}.json`);
      let cached: string[] | null = null;
      try {
        const value: unknown = JSON.parse(await readFile(checkpointPath, "utf8"));
        if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new Error("Checkpoint PDF local inválido; se conserva para revisión");
        cached = value;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (cached) {
        pageParagraphs.push(cached);
        onProgress?.(getPdfProgress(pageIndex + 1, pdfDocument.numPages, `Página ${pageIndex + 1} recuperada`));
        await options.onCheckpoint?.(pageIndex + 1, pdfDocument.numPages);
        continue;
      }
      const page = await pdfDocument.getPage(pageIndex + 1);
      const textContent = await page.getTextContent();
      let paragraphs = extractParagraphsFromTextItems(textContent.items as PdfTextItem[]);
      const usefulTextLength = paragraphs.join(" ").replace(/\W/g, "").length;
      if (usefulTextLength < 40 && enableOcr) {
        selectedOcrLanguage ??= await getAvailableOcrLanguages(
          ocrLanguage,
          resolve(process.env.TESSDATA_PREFIX ?? process.cwd()),
        );
        const workerOptions = {
          ...(selectedOcrLanguage.langPath ? {
            langPath: selectedOcrLanguage.langPath,
            // Read bundled .traineddata directly without writing to the app directory.
            cachePath: selectedOcrLanguage.langPath,
            cacheMethod: "readOnly" as const,
          } : {}),
          logger: ({ status, progress }: { status: string; progress: number }) => {
            onProgress?.(getPdfProgress(pageIndex, pdfDocument.numPages, `OCR pagina ${pageIndex + 1}: ${status} ${Math.round(progress * 100)}%`));
          },
        };
        ocrWorker ??= await createWorker(selectedOcrLanguage.languages, undefined, workerOptions);
        paragraphs = collectParagraphsFromTextLines(await ocrPage(pdfPath, pageIndex + 1, ocrWorker));
      }

      onProgress?.(
        getPdfProgress(
          pageIndex + 1,
          pdfDocument.numPages,
          `Analizando pagina ${pageIndex + 1} de ${pdfDocument.numPages}`,
        ),
      );

      await writeFileAtomically(checkpointPath, JSON.stringify(paragraphs));
      pageParagraphs.push(paragraphs);
      await options.onCheckpoint?.(pageIndex + 1, pdfDocument.numPages);
    }

    if (shouldPause?.()) throw new PauseRequestedError();
    const cleanedPages = stripRepeatedPageFooters(stripRepeatedPageHeaders(pageParagraphs));
    if (cleanedPages.every((page) => page.length === 0)) {
      throw new Error("No se pudo extraer texto del PDF");
    }
    const sections = buildSectionsFromPages(cleanedPages);

    if (sections.length === 0) {
      throw new Error("No se pudo extraer texto del PDF. Parece un documento escaneado y el OCR aun no esta disponible.");
    }

    onProgress?.(getPdfProgress(pdfDocument.numPages, pdfDocument.numPages, "Generando EPUB"));

    const metadata = await pdfDocument.getMetadata().catch(() => null);
    const info = metadata?.info as { Title?: string; Author?: string; Lang?: string } | undefined;
    const title = info?.Title?.trim() || (options.inputFileName || pdfPath.split("/").pop())?.replace(/\.pdf$/i, "") || "Documento convertido";

    return buildPdfEpub({
      title,
      author: info?.Author?.trim(),
      language: info?.Lang?.trim(),
      sections,
    });
  } finally {
    if (typeof ocrWorker !== "undefined" && ocrWorker) await ocrWorker.terminate().catch(() => undefined);
    await loadingTask.destroy();
  }
}
