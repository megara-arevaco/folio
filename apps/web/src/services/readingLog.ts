import type { BookCandidate, ReadingBook, ReadingBookChanges } from "../../../../packages/contracts/src";
export type { BookCandidate, ReadingBook } from "../../../../packages/contracts/src";
import { API_BASE_URL, readApiData, readErrorMessage } from "./http";

export async function searchBooks(query: string): Promise<BookCandidate[]> {
  return readApiData(await fetch(`${API_BASE_URL}/api/books/search?q=${encodeURIComponent(query)}`));
}

export async function fetchReadingLog(): Promise<ReadingBook[]> {
  return readApiData(await fetch(`${API_BASE_URL}/api/reading-log`));
}

export async function addReadingBook(book: BookCandidate): Promise<ReadingBook> {
  return readApiData(await fetch(`${API_BASE_URL}/api/reading-log`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(book),
  }));
}

export async function updateReadingBook(id: string, changes: ReadingBookChanges): Promise<ReadingBook> {
  return readApiData(await fetch(`${API_BASE_URL}/api/reading-log/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changes),
  }));
}

export async function deleteReadingBook(id: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/reading-log/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) throw new Error(await readErrorMessage(response, "No se ha podido borrar el libro"));
}
