import AdmZip from "adm-zip";
import * as cheerio from "cheerio";
import { GlossaryEntry, JobProgress } from "../types";
import { generateGlossary, reviewTranslationBatch, translateWithRetry } from "./llm";

type AnyNode = {
  type: string;
  tagName?: string;
  childNodes?: AnyNode[];
  data?: string;
};

export type TextItem = {
  id: string;
  text: string;
};

const SKIP_TAGS = new Set(["script", "style", "svg", "code", "pre"]);
const MAX_CHARS_PER_BATCH = 2500;
const MAX_ESTIMATED_TOKENS_PER_BATCH = 600;
const CHARS_PER_TOKEN_ESTIMATE = 4;
const FRAGMENT_ID_SEPARATOR = "__part";

type FileData = {
  items: TextItem[];
  cheerioRoot: cheerio.CheerioAPI;
  isXml: boolean;
};

export type TranslationMemory = Record<string, string>;

export function validateTranslation(expected: TextItem[], translated: TextItem[]): void {
  const expectedIds = new Set(expected.map((item) => item.id));
  const translatedIds = new Set(translated.map((item) => item.id));
  if (expected.length !== translated.length || expectedIds.size !== translatedIds.size) {
    throw new Error("La traduccion no contiene exactamente todos los fragmentos del EPUB");
  }
  for (const id of expectedIds) {
    if (!translatedIds.has(id)) throw new Error(`Falta el fragmento traducido \"${id}\"`);
  }
  for (const item of translated) {
    if (typeof item.text !== "string" || item.text.trim().length === 0) {
      throw new Error(`El fragmento \"${item.id}\" tiene una traduccion vacia`);
    }
  }
}

export type ProcessEpubOptions = {
  onProgress?: (progress: JobProgress) => void;
  translatedItemsCheckpoint?: TextItem[];
  startBatchIndex?: number;
  shouldPause?: () => boolean;
  onCheckpoint?: (translatedItems: TextItem[], nextBatchIndex: number, totalBatches: number) => void | Promise<void>;
  glossary?: GlossaryEntry[];
  onGlossary?: (glossary: GlossaryEntry[]) => void;
  translationMemory?: TranslationMemory;
  onMemoryUpdate?: (memory: TranslationMemory) => void;
  onChapterCheckpoint?: (entryName: string) => void;
  enableReview?: boolean;
};

export class PauseRequestedError extends Error {
  constructor() {
    super("Traduccion pausada");
    this.name = "PauseRequestedError";
  }
}

function isProcessableEntry(entryName: string): boolean {
  const name = entryName.toLowerCase();
  return (
    name.endsWith(".html") ||
    name.endsWith(".xhtml") ||
    name.endsWith(".htm") ||
    name.endsWith(".ncx")
  );
}

function isXmlEntry(entryName: string): boolean {
  return entryName.toLowerCase().endsWith(".ncx");
}

export function collectTextNodes(
  $: cheerio.CheerioAPI,
  fileIndex: number
): TextItem[] {
  const items: TextItem[] = [];
  let nodeIndex = 0;

  function walk(node: AnyNode) {
    if (node.type === "text") {
      const text = (node.data ?? "").trim();
      if (text.length > 0) {
        items.push({ id: `${fileIndex}_${nodeIndex}`, text });
        nodeIndex++;
      }
      return;
    }

    if (node.type === "tag" || node.type === "script" || node.type === "style") {
      const tagName = node.tagName || node.type;
      if (SKIP_TAGS.has(tagName)) return;
      if (node.childNodes) {
        for (const child of node.childNodes) {
          walk(child);
        }
      }
    }
  }

  const root = $.root().get(0) as AnyNode | null;
  if (root?.childNodes) {
    for (const child of root.childNodes) {
      walk(child);
    }
  }

  return items;
}

export function replaceTextNodes(
  _: cheerio.CheerioAPI,
  fileIndex: number,
  translatedMap: Map<string, string>
) {
  let nodeIndex = 0;

  function walk(node: AnyNode) {
    if (node.type === "text") {
      const original = (node.data ?? "").trim();
      if (original.length > 0) {
        const key = `${fileIndex}_${nodeIndex}`;
        const translated = translatedMap.get(key);
        if (translated !== undefined && node.data !== undefined) {
          node.data = node.data.replace(original, translated);
        }
        nodeIndex++;
      }
      return;
    }

    if (node.type === "tag" || node.type === "script" || node.type === "style") {
      const tagName = node.tagName || node.type;
      if (SKIP_TAGS.has(tagName)) return;
      if (node.childNodes) {
        for (const child of node.childNodes) {
          walk(child);
        }
      }
    }
  }

  const root = _.root().get(0) as AnyNode | null;
  if (root?.childNodes) {
    for (const child of root.childNodes) {
      walk(child);
    }
  }
}

export async function processEpub(
  epubPath: string,
  options: ProcessEpubOptions = {},
): Promise<Buffer> {
  const {
    onProgress,
    translatedItemsCheckpoint = [],
    startBatchIndex = 0,
    shouldPause,
    onCheckpoint,
    glossary = [],
    onGlossary,
    translationMemory = {},
    onMemoryUpdate,
    onChapterCheckpoint,
    enableReview = false,
  } = options;
  const zip = new AdmZip(epubPath);
  const entries = zip.getEntries();

  const htmlEntries = entries.filter(
    (e) => !e.isDirectory && isProcessableEntry(e.entryName),
  );

  if (htmlEntries.length === 0) {
    throw new Error("No se encontraron archivos HTML/XHTML dentro del EPUB");
  }

  const fileMaps = new Map<string, FileData>();
  const batches: TextItem[][] = [];
  const batchChapters: string[] = [];

  onProgress?.({
    current: 0,
    total: 0,
    message: "Leyendo EPUB",
  });

  for (let i = 0; i < htmlEntries.length; i++) {
    const entry = htmlEntries[i];
    const content = entry.getData().toString("utf-8");
    const isXml = isXmlEntry(entry.entryName);
    const $ = cheerio.load(content, { xmlMode: isXml });

    const items = splitLongTextItems(collectTextNodes($, i));
    const entryBatches = splitIntoBatches(items);
    batches.push(...entryBatches);
    batchChapters.push(...entryBatches.map(() => entry.entryName));
    fileMaps.set(entry.entryName, { items, cheerioRoot: $, isXml });
  }

  const translatedItems: TextItem[] = [...translatedItemsCheckpoint];
  let activeGlossary = glossary;
  if (activeGlossary.length === 0) {
    onProgress?.({ current: 0, total: batches.length, message: "Creando glosario" });
    activeGlossary = await generateGlossary(
      htmlEntries.flatMap((entry, index) => fileMaps.get(entry.entryName)?.items.slice(0, 40).map((item) => ({
        ...item,
        id: `${index}_${item.id}`,
      })) ?? []),
    );
    onGlossary?.(activeGlossary);
  }

  const memory = { ...translationMemory };
  for (let batchIndex = startBatchIndex; batchIndex < batches.length; batchIndex++) {
    if (shouldPause?.()) {
      throw new PauseRequestedError();
    }

    onProgress?.({
      current: batchIndex + 1,
      total: batches.length,
      message: `Traduciendo fragmento ${batchIndex + 1} de ${batches.length}`,
    });

    const batch = batches[batchIndex];
    const missing = batch.filter((item) => !memory[item.text]);
    const context = [
      batches[batchIndex - 1]?.map((item) => item.text).join(" ").slice(-700),
      batches[batchIndex + 1]?.map((item) => item.text).join(" ").slice(0, 700),
    ].filter(Boolean).join("\n---\n");
    const fresh = missing.length > 0
      ? await translateWithRetry(missing, activeGlossary, context)
      : [];
    const freshById = new Map(fresh.map((item) => [item.id, item.text]));
    for (const original of missing) {
      const translated = freshById.get(original.id);
      if (translated) memory[original.text] = translated;
    }
    const result = batch.map((item) => ({
      id: item.id,
      text: memory[item.text] ?? freshById.get(item.id) ?? item.text,
    }));
    onMemoryUpdate?.(memory);
    translatedItems.push(...result);
    await onCheckpoint?.(translatedItems, batchIndex + 1, batches.length);

    if (batchChapters[batchIndex + 1] !== batchChapters[batchIndex]) {
      onChapterCheckpoint?.(batchChapters[batchIndex]!);
    }
  }

  if (enableReview && translatedItems.length > 0) {
    onProgress?.({ current: batches.length, total: batches.length, message: "Revisando traduccion" });
    let offset = 0;
    for (const batch of batches) {
      const current = translatedItems.slice(offset, offset + batch.length);
      const reviewed = await reviewTranslationBatch(current, activeGlossary);
      translatedItems.splice(offset, current.length, ...reviewed);
      offset += batch.length;
    }
  }

  validateTranslation(batches.flat(), translatedItems);

  onProgress?.({
    current: batches.length,
    total: batches.length,
    message: "Generando EPUB",
  });

  const recombinedItems = recombineTranslatedItems(translatedItems);
  const translatedMap = new Map<string, string>();
  for (const item of recombinedItems) {
    translatedMap.set(item.id, item.text);
  }

  for (let i = 0; i < htmlEntries.length; i++) {
    const entry = htmlEntries[i];
    const data = fileMaps.get(entry.entryName);
    if (!data) continue;

    replaceTextNodes(data.cheerioRoot, i, translatedMap);

    const newHtml = data.isXml ? data.cheerioRoot.xml() : data.cheerioRoot.html();
    zip.updateFile(entry.entryName, Buffer.from(newHtml, "utf-8"));
  }

  return zip.toBuffer();
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE));
}

function isWithinBatchLimits(text: string): boolean {
  return (
    text.length <= MAX_CHARS_PER_BATCH &&
    estimateTokens(text) <= MAX_ESTIMATED_TOKENS_PER_BATCH
  );
}

function splitTextIntoParagraphSegments(text: string): string[] {
  return text.match(/[^\n]+(?:\n+|$)|\n+/g) ?? [text];
}

function splitTextIntoSentenceSegments(text: string): string[] {
  return text.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)\s*/g) ?? [text];
}

function splitTextIntoWordSegments(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [text];
}

function packSegments(segments: string[]): string[] {
  const chunks: string[] = [];
  let currentChunk = "";

  for (const segment of segments) {
    if (currentChunk.length === 0) {
      currentChunk = segment;
      continue;
    }

    const candidate = currentChunk + segment;
    if (isWithinBatchLimits(candidate)) {
      currentChunk = candidate;
      continue;
    }

    chunks.push(currentChunk);
    currentChunk = segment;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

function hardSplitText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + MAX_CHARS_PER_BATCH, text.length);

    while (
      end > start &&
      estimateTokens(text.slice(start, end)) > MAX_ESTIMATED_TOKENS_PER_BATCH
    ) {
      end--;
    }

    if (end === start) {
      end = Math.min(start + CHARS_PER_TOKEN_ESTIMATE, text.length);
    }

    chunks.push(text.slice(start, end));
    start = end;
  }

  return chunks;
}

function splitOversizedText(text: string): string[] {
  let chunks = [text];

  for (const splitText of [
    splitTextIntoParagraphSegments,
    splitTextIntoSentenceSegments,
    splitTextIntoWordSegments,
  ]) {
    chunks = chunks.flatMap((chunk) => {
      if (isWithinBatchLimits(chunk)) {
        return [chunk];
      }

      return packSegments(splitText(chunk));
    });
  }

  return chunks.flatMap((chunk) => {
    if (isWithinBatchLimits(chunk)) {
      return [chunk];
    }

    return hardSplitText(chunk);
  });
}

export function splitLongTextItems(items: TextItem[]): TextItem[] {
  return items.flatMap((item) => {
    if (isWithinBatchLimits(item.text)) {
      return [item];
    }

    return splitOversizedText(item.text).map((fragment, index) => ({
      id: `${item.id}${FRAGMENT_ID_SEPARATOR}${index}`,
      text: fragment,
    }));
  });
}

export function recombineTranslatedItems(items: TextItem[]): TextItem[] {
  const singleItems: TextItem[] = [];
  const fragments = new Map<string, { index: number; text: string }[]>();

  for (const item of items) {
    const separatorIndex = item.id.indexOf(FRAGMENT_ID_SEPARATOR);
    if (separatorIndex === -1) {
      singleItems.push(item);
      continue;
    }

    const baseId = item.id.slice(0, separatorIndex);
    const fragmentIndex = Number(item.id.slice(separatorIndex + FRAGMENT_ID_SEPARATOR.length));

    if (!Number.isInteger(fragmentIndex)) {
      singleItems.push(item);
      continue;
    }

    const group = fragments.get(baseId) ?? [];
    group.push({ index: fragmentIndex, text: item.text });
    fragments.set(baseId, group);
  }

  const recombinedFragments = Array.from(fragments.entries())
    .sort(([leftId], [rightId]) => leftId.localeCompare(rightId, undefined, { numeric: true }))
    .map(([id, parts]) => ({
      id,
      text: parts
        .sort((left, right) => left.index - right.index)
        .map((part) => part.text)
        .join(""),
    }));

  return [...singleItems, ...recombinedFragments].sort((left, right) =>
    left.id.localeCompare(right.id, undefined, { numeric: true }),
  );
}

function splitIntoBatches(items: TextItem[]): TextItem[][] {
  const batches: TextItem[][] = [];
  let currentBatch: TextItem[] = [];
  let currentCharCount = 0;
  let currentTokenEstimate = 0;

  for (const item of items) {
    const itemCharCount = item.text.length;
    const itemTokenEstimate = estimateTokens(item.text);
    const exceedsCharLimit =
      currentCharCount + itemCharCount > MAX_CHARS_PER_BATCH;
    const exceedsTokenLimit =
      currentTokenEstimate + itemTokenEstimate > MAX_ESTIMATED_TOKENS_PER_BATCH;

    if (
      (exceedsCharLimit || exceedsTokenLimit) &&
      currentBatch.length > 0
    ) {
      batches.push(currentBatch);
      currentBatch = [];
      currentCharCount = 0;
      currentTokenEstimate = 0;
    }

    currentBatch.push(item);
    currentCharCount += itemCharCount;
    currentTokenEstimate += itemTokenEstimate;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}
