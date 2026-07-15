import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type ReadingStatus = "to-read" | "reading" | "read" | "abandoned";
export type ReadingBook = {
  id: string; openLibraryKey: string | null; title: string; authors: string[];
  coverUrl: string | null; firstPublishYear: number | null; isbn: string | null;
  categories: string[];
  status: ReadingStatus; startedAt: string | null; finishedAt: string | null;
  rating: number | null; notes: string; createdAt: string;
};

type ReadingBookRow = Omit<ReadingBook, "authors" | "categories"> & { authors: string; categories: string };
const databasePath = () => resolve(process.env.READING_DB_PATH ?? resolve(process.cwd(), "tmp", "reading-log.sqlite"));
const legacyJsonPath = () => resolve(process.env.READING_LOG_PATH ?? resolve(process.cwd(), "tmp", "reading-log.json"));

function rowToBook(row: ReadingBookRow): ReadingBook {
  return { ...row, authors: JSON.parse(row.authors) as string[], categories: JSON.parse(row.categories || "[]") as string[] };
}

function insertBook(database: DatabaseSync, book: ReadingBook): void {
  database.prepare(`INSERT OR REPLACE INTO reading_books
    (id, open_library_key, title, authors, cover_url, first_publish_year, isbn, categories, status, started_at, finished_at, rating, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(book.id, book.openLibraryKey, book.title, JSON.stringify(book.authors), book.coverUrl,
      book.firstPublishYear, book.isbn, JSON.stringify(book.categories ?? []), book.status, book.startedAt, book.finishedAt,
      book.rating, book.notes, book.createdAt);
}

function openDatabase(): DatabaseSync {
  const path = databasePath();
  mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  database.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS reading_books (
      id TEXT PRIMARY KEY,
      open_library_key TEXT,
      title TEXT NOT NULL,
      authors TEXT NOT NULL DEFAULT '[]',
      cover_url TEXT,
      first_publish_year INTEGER,
      isbn TEXT,
      categories TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL CHECK (status IN ('to-read', 'reading', 'read', 'abandoned')),
      started_at TEXT,
      finished_at TEXT,
      rating INTEGER CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS reading_books_status_idx ON reading_books(status);
    CREATE INDEX IF NOT EXISTS reading_books_title_idx ON reading_books(title);
    CREATE TABLE IF NOT EXISTS app_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  const columns = database.prepare("PRAGMA table_info(reading_books)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "categories")) {
    database.exec("ALTER TABLE reading_books ADD COLUMN categories TEXT NOT NULL DEFAULT '[]'");
  }

  const migrationName = "reading_log_json_import_v1";
  const migrationApplied = database.prepare("SELECT 1 FROM app_migrations WHERE name = ?").get(migrationName);
  if (!migrationApplied) {
    const count = database.prepare("SELECT COUNT(*) AS count FROM reading_books").get() as { count: number };
    if (count.count === 0 && existsSync(legacyJsonPath())) {
      try {
        const books = JSON.parse(readFileSync(legacyJsonPath(), "utf-8")) as ReadingBook[];
        database.exec("BEGIN");
        try {
          for (const book of books) insertBook(database, book);
          database.exec("COMMIT");
        } catch {
          database.exec("ROLLBACK");
        }
      } catch { /* Ignore malformed legacy JSON and start with an empty database. */ }
    }
    database.prepare("INSERT INTO app_migrations (name, applied_at) VALUES (?, ?)").run(migrationName, new Date().toISOString());
  }
  return database;
}

export async function listReadingBooks(): Promise<ReadingBook[]> {
  const database = openDatabase();
  try {
    const rows = database.prepare(`SELECT id, open_library_key AS openLibraryKey, title, authors,
      cover_url AS coverUrl, first_publish_year AS firstPublishYear, isbn, categories, status,
      started_at AS startedAt, finished_at AS finishedAt, rating, notes, created_at AS createdAt
      FROM reading_books ORDER BY created_at DESC`).all() as ReadingBookRow[];
    return rows.map(rowToBook);
  } finally { database.close(); }
}

export async function addReadingBook(input: Omit<ReadingBook, "id" | "createdAt" | "status" | "startedAt" | "finishedAt" | "rating" | "notes">) {
  const book: ReadingBook = { ...input, id: randomUUID(), status: "to-read", startedAt: null, finishedAt: null, rating: null, notes: "", createdAt: new Date().toISOString() };
  const database = openDatabase(); try { insertBook(database, book); } finally { database.close(); }
  return book;
}

export async function updateReadingBook(id: string, changes: Partial<Pick<ReadingBook, "status" | "rating" | "notes" | "finishedAt" | "categories">>) {
  const database = openDatabase();
  try {
    const row = database.prepare(`SELECT id, open_library_key AS openLibraryKey, title, authors,
      cover_url AS coverUrl, first_publish_year AS firstPublishYear, isbn, categories, status,
      started_at AS startedAt, finished_at AS finishedAt, rating, notes, created_at AS createdAt
      FROM reading_books WHERE id = ?`).get(id) as ReadingBookRow | undefined;
    if (!row) return null;
    const book = rowToBook(row);
    if (changes.status) {
      book.status = changes.status;
      if (changes.status === "reading" && !book.startedAt) book.startedAt = new Date().toISOString();
      if (changes.status === "read" && !book.finishedAt) book.finishedAt = new Date().toISOString();
    }
    if (changes.rating !== undefined) book.rating = changes.rating;
    if (changes.notes !== undefined) book.notes = changes.notes;
    if (changes.finishedAt !== undefined) book.finishedAt = changes.finishedAt;
    if (changes.categories !== undefined) book.categories = changes.categories;
    insertBook(database, book); return book;
  } finally { database.close(); }
}

export async function deleteReadingBook(id: string) {
  const database = openDatabase();
  try { return database.prepare("DELETE FROM reading_books WHERE id = ?").run(id).changes > 0; }
  finally { database.close(); }
}
