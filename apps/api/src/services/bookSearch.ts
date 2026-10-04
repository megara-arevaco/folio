import { readBoundedJson } from "./shared/network";
import type { BookCandidate } from "../../../../packages/contracts/src";
export type { BookCandidate } from "../../../../packages/contracts/src";
type GoogleVolume = {
  id?: string;
  volumeInfo?: {
    title?: string;
    authors?: string[];
    publishedDate?: string;
    industryIdentifiers?: Array<{ type?: string; identifier?: string }>;
    imageLinks?: { thumbnail?: string; smallThumbnail?: string };
    categories?: string[];
  };
};

type GoogleBooksPayload = { items?: GoogleVolume[] };

function cleanText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cleanStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(cleanText).filter((item): item is string => item !== null)
    : [];
}

function searchIdentity(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizedIsbn(value: string | null): string | null {
  if (!value) return null;
  const isbn = value.replace(/[^0-9X]/gi, "").toUpperCase();
  return isbn.length === 10 || isbn.length === 13 ? isbn : null;
}

function bookSignature(book: BookCandidate): string {
  return `${searchIdentity(book.title)}|${searchIdentity(book.authors[0] ?? "")}`;
}

function mergeCandidate(base: BookCandidate, incoming: BookCandidate): BookCandidate {
  return {
    openLibraryKey: base.openLibraryKey ?? incoming.openLibraryKey,
    title: base.title === "Sin título" ? incoming.title : base.title,
    authors: base.authors.length ? base.authors : incoming.authors,
    coverUrl: base.coverUrl ?? incoming.coverUrl,
    firstPublishYear: base.firstPublishYear ?? incoming.firstPublishYear,
    isbn: base.isbn ?? incoming.isbn,
    categories: Array.from(new Set([...base.categories, ...incoming.categories])).slice(0, 8),
  };
}

export function mergeBookCandidates(candidates: BookCandidate[], limit = 18): BookCandidate[] {
  const merged: BookCandidate[] = [];
  const byIsbn = new Map<string, number>();
  const bySignature = new Map<string, number>();

  for (const candidate of candidates) {
    const isbn = normalizedIsbn(candidate.isbn);
    const signature = bookSignature(candidate);
    const existingIndex = (isbn ? byIsbn.get(isbn) : undefined) ?? bySignature.get(signature);

    if (existingIndex !== undefined) {
      merged[existingIndex] = mergeCandidate(merged[existingIndex], candidate);
      const mergedBook = merged[existingIndex];
      const mergedIsbn = normalizedIsbn(mergedBook.isbn);
      if (mergedIsbn) byIsbn.set(mergedIsbn, existingIndex);
      bySignature.set(bookSignature(mergedBook), existingIndex);
      continue;
    }

    const index = merged.length;
    merged.push(candidate);
    if (isbn) byIsbn.set(isbn, index);
    bySignature.set(signature, index);
  }

  return merged.slice(0, limit);
}

export function mapGoogleBooksPayload(payload: GoogleBooksPayload): BookCandidate[] {
  return (payload.items ?? []).map((item) => {
    const info = item.volumeInfo ?? {};
    const identifiers = Array.isArray(info.industryIdentifiers) ? info.industryIdentifiers : [];
    const isbn = identifiers.find((identifier) => identifier.type === "ISBN_13")?.identifier
      ?? identifiers.find((identifier) => identifier.type === "ISBN_10")?.identifier
      ?? null;
    const yearMatch = info.publishedDate?.match(/^(\d{4})/);
    const coverUrl = cleanText(info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail)?.replace(/^http:/, "https:") ?? null;

    return {
      openLibraryKey: null,
      title: cleanText(info.title) ?? "Sin título",
      authors: cleanStringArray(info.authors),
      coverUrl,
      firstPublishYear: yearMatch ? Number.parseInt(yearMatch[1], 10) : null,
      isbn: cleanText(isbn),
      categories: cleanStringArray(info.categories).slice(0, 8),
    };
  });
}

async function searchOpenLibrary(query: string): Promise<BookCandidate[]> {
  const url = new URL("https://openlibrary.org/search.json");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "12");
  url.searchParams.set("fields", "key,title,author_name,first_publish_year,isbn,cover_i,subject");
  const response = await fetch(url, {
    headers: { "User-Agent": "EPUB-Translator/0.1 (local personal app)" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Open Library respondió con ${response.status}`);
  const payload = await readBoundedJson(response, 2 * 1024 * 1024) as { docs?: unknown } | null;
  if (!payload || (payload.docs !== undefined && !Array.isArray(payload.docs))) throw new Error("Respuesta de Open Library inválida");
  return ((payload.docs ?? []) as Array<Record<string, unknown>>).filter((doc) => !!doc && typeof doc === "object").slice(0, 12).map((doc) => ({
    openLibraryKey: cleanText(doc.key),
    title: cleanText(doc.title) ?? "Sin título",
    authors: cleanStringArray(doc.author_name),
    firstPublishYear: typeof doc.first_publish_year === "number" ? doc.first_publish_year : null,
    isbn: cleanStringArray(doc.isbn)[0] ?? null,
    coverUrl: typeof doc.cover_i === "number" ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : null,
    categories: cleanStringArray(doc.subject).slice(0, 8),
  }));
}

async function searchGoogleBooks(query: string): Promise<BookCandidate[]> {
  const compactQuery = query.replace(/[-\s]/g, "");
  const googleQuery = /^(?:\d{9}[\dX]|\d{13})$/i.test(compactQuery) ? `isbn:${compactQuery}` : query;
  const url = new URL("https://www.googleapis.com/books/v1/volumes");
  url.searchParams.set("q", googleQuery);
  url.searchParams.set("maxResults", "12");
  url.searchParams.set("printType", "books");
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY?.trim();
  if (apiKey) url.searchParams.set("key", apiKey);
  const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`Google Books respondió con ${response.status}`);
  const payload = await readBoundedJson(response, 2 * 1024 * 1024) as GoogleBooksPayload | null;
  if (!payload || payload.items !== undefined && !Array.isArray(payload.items)) throw new Error("Respuesta de Google Books inválida");
  return mapGoogleBooksPayload({ ...payload, items: payload.items?.filter((item) => !!item && typeof item === "object").slice(0, 12) });
}

function interleave(first: BookCandidate[], second: BookCandidate[]): BookCandidate[] {
  const candidates: BookCandidate[] = [];
  const length = Math.max(first.length, second.length);
  for (let index = 0; index < length; index += 1) {
    if (first[index]) candidates.push(first[index]);
    if (second[index]) candidates.push(second[index]);
  }
  return candidates;
}

export async function searchBookCatalogs(query: string): Promise<BookCandidate[]> {
  const responses = await Promise.allSettled([searchOpenLibrary(query), searchGoogleBooks(query)]);
  const openLibrary = responses[0].status === "fulfilled" ? responses[0].value : [];
  const googleBooks = responses[1].status === "fulfilled" ? responses[1].value : [];
  if (responses.every((response) => response.status === "rejected")) {
    throw new Error("Los catálogos no están disponibles");
  }
  return mergeBookCandidates(interleave(openLibrary, googleBooks));
}
