export type BookCandidate = {
  openLibraryKey: string | null;
  title: string;
  authors: string[];
  coverUrl: string | null;
  firstPublishYear: number | null;
  isbn: string | null;
  categories: string[];
};

export type ReadingStatus = "to-read" | "reading" | "read" | "abandoned";

export type ReadingBook = BookCandidate & {
  id: string;
  status: ReadingStatus;
  startedAt: string | null;
  finishedAt: string | null;
  rating: number | null;
  notes: string;
  createdAt: string;
};

export type ReadingBookChanges = Partial<Pick<ReadingBook, "status" | "rating" | "notes" | "finishedAt" | "categories">>;

const statuses: ReadingStatus[] = ["to-read", "reading", "read", "abandoned"];
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, maximum: number): value is string => typeof value === "string" && value.length <= maximum && !value.includes("\0");
const stringList = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 100 && value.every((item) => text(item, 500));
export function isReadingDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return false;
  const timestamp = Date.parse(value);
  // Reject impossible calendar dates, including dates JS normalizes into another month.
  const day = value.slice(0, 10);
  const calendar = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(timestamp) && Number.isFinite(calendar.getTime()) && calendar.toISOString().slice(0, 10) === day;
}

export function parseBookCandidate(value: unknown): BookCandidate | null {
  if (!isObject(value) || !text(value.title, 500) || !value.title.trim() ||
    !stringList(value.authors) || !stringList(value.categories) ||
    !(value.openLibraryKey === null || text(value.openLibraryKey, 500)) ||
    !(value.isbn === null || text(value.isbn, 30)) ||
    !(value.firstPublishYear === null || typeof value.firstPublishYear === "number" && Number.isInteger(value.firstPublishYear) && value.firstPublishYear >= 0 && value.firstPublishYear <= 9999) ||
    !(value.coverUrl === null || text(value.coverUrl, 4096))) return null;
  if (value.coverUrl !== null) {
    try { if (new URL(value.coverUrl).protocol !== "https:") return null; } catch { return null; }
  }
  return {
    title: value.title.trim(), authors: value.authors.map((item) => item.trim()).filter(Boolean),
    categories: [...new Set(value.categories.map((item) => item.trim()).filter(Boolean))],
    openLibraryKey: value.openLibraryKey, isbn: value.isbn,
    firstPublishYear: value.firstPublishYear, coverUrl: value.coverUrl,
  };
}

export function parseReadingBookChanges(value: unknown): ReadingBookChanges | null {
  if (!isObject(value) || Object.keys(value).some((key) => !["status", "rating", "notes", "finishedAt", "categories"].includes(key))) return null;
  const result: ReadingBookChanges = {};
  if ("status" in value) {
    if (!statuses.includes(value.status as ReadingStatus)) return null;
    result.status = value.status as ReadingStatus;
  }
  if ("rating" in value) {
    if (value.rating !== null && !(typeof value.rating === "number" && Number.isInteger(value.rating) && value.rating >= 1 && value.rating <= 5)) return null;
    result.rating = value.rating as number | null;
  }
  if ("notes" in value) {
    if (!text(value.notes, 20000)) return null;
    result.notes = value.notes;
  }
  if ("finishedAt" in value) {
    if (value.finishedAt !== null && !isReadingDate(value.finishedAt)) return null;
    result.finishedAt = value.finishedAt as string | null;
  }
  if ("categories" in value) {
    if (!stringList(value.categories)) return null;
    result.categories = [...new Set(value.categories.map((item) => item.trim()).filter(Boolean))];
  }
  return result;
}
