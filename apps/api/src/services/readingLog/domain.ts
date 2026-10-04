import type { BookCandidate, ReadingBook, ReadingBookChanges } from "../../../../../packages/contracts/src";

export function createReadingBook(input: BookCandidate, id: string, now: string): ReadingBook {
  return { ...input, authors: [...input.authors], categories: [...input.categories],
    id, status: "to-read", startedAt: null, finishedAt: null, rating: null, notes: "", createdAt: now };
}

export function applyReadingBookChanges(book: ReadingBook, changes: ReadingBookChanges, now: string): ReadingBook {
  const updated = { ...book, ...changes };
  if (changes.status === "reading" && !book.startedAt) updated.startedAt = now;
  if (changes.status === "read" && !book.finishedAt && changes.finishedAt === undefined) updated.finishedAt = now;
  if (changes.categories) updated.categories = [...changes.categories];
  return updated;
}
