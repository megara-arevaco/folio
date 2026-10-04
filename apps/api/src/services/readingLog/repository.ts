import type { ReadingBook } from "../../../../../packages/contracts/src";
import { parseBookCandidate, parseReadingBookChanges, isReadingDate } from "../../../../../packages/contracts/src/readingLog";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

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
  try {
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
    if (!database.prepare("SELECT 1 FROM app_migrations WHERE name = ?").get(migrationName)) {
      const count = database.prepare("SELECT COUNT(*) AS count FROM reading_books").get() as { count: number };
      let books: ReadingBook[] = [];
      if (count.count === 0 && existsSync(legacyJsonPath())) {
        const parsed: unknown = JSON.parse(readFileSync(legacyJsonPath(), "utf8"));
        if (!Array.isArray(parsed)) throw new Error("El registro JSON de lectura no es una lista");
        const ids = new Set<string>();
        books = parsed.map((value) => {
          const candidate = parseBookCandidate({ ...value, categories: value?.categories ?? [] });
          const changes = parseReadingBookChanges({ status: value?.status, rating: value?.rating,
            notes: value?.notes, finishedAt: value?.finishedAt, categories: value?.categories ?? [] });
          if (!candidate || !changes || typeof value.id !== "string" || !value.id || ids.has(value.id) ||
            !isReadingDate(value.createdAt) || !(value.startedAt === null || isReadingDate(value.startedAt))) {
            throw new Error("Libro inválido en el registro JSON de lectura");
          }
          ids.add(value.id);
          return { ...candidate, ...changes, id: value.id, createdAt: value.createdAt, startedAt: value.startedAt } as ReadingBook;
        });
      }
      database.exec("BEGIN IMMEDIATE");
      try {
        for (const book of books) insertBook(database, book);
        database.prepare("INSERT INTO app_migrations (name, applied_at) VALUES (?, ?)").run(migrationName, new Date().toISOString());
        database.exec("COMMIT");
      } catch (error) { database.exec("ROLLBACK"); throw error; }
    }
    return database;
  } catch (error) {
    database.close();
    throw new Error("No se ha podido abrir o migrar el registro de lectura; el JSON original se conserva");
  }
}

const bookColumns = `id, open_library_key AS openLibraryKey, title, authors,
  cover_url AS coverUrl, first_publish_year AS firstPublishYear, isbn, categories, status,
  started_at AS startedAt, finished_at AS finishedAt, rating, notes, created_at AS createdAt`;

function withDatabase<T>(operation: (database: DatabaseSync) => T): T {
  const database = openDatabase();
  try { return operation(database); } finally { database.close(); }
}

export const readingRepository = {
  list(): ReadingBook[] {
    return withDatabase((database) => (database.prepare(`SELECT ${bookColumns} FROM reading_books ORDER BY created_at DESC`).all() as ReadingBookRow[]).map(rowToBook));
  },
  insert(book: ReadingBook): void { withDatabase((database) => insertBook(database, book)); },
  update(id: string, change: (book: ReadingBook) => ReadingBook): ReadingBook | null {
    return withDatabase((database) => {
      database.exec("BEGIN IMMEDIATE");
      try {
        const row = database.prepare(`SELECT ${bookColumns} FROM reading_books WHERE id = ?`).get(id) as ReadingBookRow | undefined;
        const book = row ? change(rowToBook(row)) : null;
        if (book) insertBook(database, book);
        database.exec("COMMIT");
        return book;
      } catch (error) { database.exec("ROLLBACK"); throw error; }
    });
  },
  delete(id: string): boolean {
    return withDatabase((database) => database.prepare("DELETE FROM reading_books WHERE id = ?").run(id).changes > 0);
  },
};
