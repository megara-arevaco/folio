export type EpubMetadata = {
  title: string;
  authors: string[];
  language: string;
  publisher: string;
  description: string;
};

export type EditableDocumentFormat = "epub" | "pdf";
export type EditableDocumentMetadata = EpubMetadata & {
  format: EditableDocumentFormat;
  coverDataUrl: string | null;
};

export function normalizeEpubMetadata(value: unknown, requireLanguage = true): EpubMetadata | null {
  if (!value || typeof value !== "object") return null;
  const metadata = value as Partial<EpubMetadata>;
  if (typeof metadata.title !== "string" || !Array.isArray(metadata.authors) ||
    !metadata.authors.every((author) => typeof author === "string") ||
    typeof metadata.language !== "string" || typeof metadata.publisher !== "string" ||
    typeof metadata.description !== "string") return null;

  const normalized = {
    title: metadata.title.trim(),
    authors: metadata.authors.map((author) => author.trim()).filter(Boolean),
    language: metadata.language.trim(),
    publisher: metadata.publisher.trim(),
    description: metadata.description.trim(),
  };
  return normalized.title && (!requireLanguage || normalized.language) ? normalized : null;
}
