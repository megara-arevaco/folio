import { randomUUID } from "node:crypto";
import type { BookCandidate, ReadingBookChanges } from "../../../../packages/contracts/src";
export type { ReadingStatus, ReadingBook } from "../../../../packages/contracts/src";
import { createReadingBook, applyReadingBookChanges } from "./readingLog/domain";
import { readingRepository } from "./readingLog/repository";

export async function listReadingBooks() { return readingRepository.list(); }
export async function addReadingBook(input: BookCandidate) {
  const book = createReadingBook(input, randomUUID(), new Date().toISOString());
  readingRepository.insert(book);
  return book;
}
export async function updateReadingBook(id: string, changes: ReadingBookChanges) {
  return readingRepository.update(id, (book) => applyReadingBookChanges(book, changes, new Date().toISOString()));
}
export async function deleteReadingBook(id: string) { return readingRepository.delete(id); }
