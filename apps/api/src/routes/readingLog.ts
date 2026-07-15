import type { FastifyInstance } from "fastify";
import { addReadingBook, deleteReadingBook, listReadingBooks, updateReadingBook } from "../services/readingLog";

export async function readingLogRoutes(fastify: FastifyInstance) {
  fastify.get("/api/books/search", async (request, reply) => {
    const { q } = request.query as { q?: string };
    if (!q?.trim()) return reply.send({ ok: true, data: [] });
    const url = new URL("https://openlibrary.org/search.json");
    url.searchParams.set("q", q.trim()); url.searchParams.set("limit", "12");
    url.searchParams.set("fields", "key,title,author_name,first_publish_year,isbn,cover_i,subject");
    const response = await fetch(url, { headers: { "User-Agent": "EPUB-Translator/0.1 (local personal app)" } });
    if (!response.ok) return reply.status(502).send({ ok: false, error: "Open Library no está disponible" });
    const payload = await response.json() as { docs?: Array<Record<string, unknown>> };
    const data = (payload.docs ?? []).map((doc) => ({
      openLibraryKey: typeof doc.key === "string" ? doc.key : null,
      title: typeof doc.title === "string" ? doc.title : "Sin título",
      authors: Array.isArray(doc.author_name) ? doc.author_name.filter((item): item is string => typeof item === "string") : [],
      firstPublishYear: typeof doc.first_publish_year === "number" ? doc.first_publish_year : null,
      isbn: Array.isArray(doc.isbn) && typeof doc.isbn[0] === "string" ? doc.isbn[0] : null,
      coverUrl: typeof doc.cover_i === "number" ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : null,
      categories: Array.isArray(doc.subject) ? doc.subject.filter((item): item is string => typeof item === "string").slice(0, 8) : [],
    }));
    reply.send({ ok: true, data });
  });
  fastify.get("/api/reading-log", async (_request, reply) => reply.send({ ok: true, data: await listReadingBooks() }));
  fastify.post("/api/reading-log", async (request, reply) => reply.status(201).send({ ok: true, data: await addReadingBook(request.body as never) }));
  fastify.patch("/api/reading-log/:id", async (request, reply) => {
    const book = await updateReadingBook((request.params as { id: string }).id, request.body as never);
    return book ? reply.send({ ok: true, data: book }) : reply.status(404).send({ ok: false, error: "Libro no encontrado" });
  });
  fastify.delete("/api/reading-log/:id", async (request, reply) => (await deleteReadingBook((request.params as { id: string }).id) ? reply.status(204).send() : reply.status(404).send()));
}
