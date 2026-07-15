export type BookCandidate = { openLibraryKey: string | null; title: string; authors: string[]; coverUrl: string | null; firstPublishYear: number | null; isbn: string | null; categories: string[] };
export type ReadingBook = BookCandidate & { id: string; status: "to-read" | "reading" | "read" | "abandoned"; rating: number | null; notes: string; startedAt: string | null; finishedAt: string | null };
const API = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";
async function data<T>(response: Response): Promise<T> { if (!response.ok) throw new Error("No se ha podido completar la operación"); return ((await response.json()) as { data: T }).data; }
export const searchBooks = (q: string) => fetch(`${API}/api/books/search?q=${encodeURIComponent(q)}`).then(data<BookCandidate[]>);
export const fetchReadingLog = () => fetch(`${API}/api/reading-log`).then(data<ReadingBook[]>);
export const addReadingBook = (book: BookCandidate) => fetch(`${API}/api/reading-log`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(book) }).then(data<ReadingBook>);
export const updateReadingBook = (id: string, changes: Partial<Pick<ReadingBook, "status" | "rating" | "notes" | "finishedAt" | "categories">>) => fetch(`${API}/api/reading-log/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes) }).then(data<ReadingBook>);
export async function deleteReadingBook(id: string) { const response = await fetch(`${API}/api/reading-log/${id}`, { method: "DELETE" }); if (!response.ok) throw new Error("No se ha podido borrar el libro"); }
