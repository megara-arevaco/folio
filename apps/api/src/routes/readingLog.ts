import { parseBookCandidate, parseReadingBookChanges } from "../../../../packages/contracts/src/readingLog";
import type { FastifyInstance } from "fastify";
import { searchBookCatalogs } from "../services/bookSearch";
import { addReadingBook, deleteReadingBook, listReadingBooks, updateReadingBook } from "../services/readingLog";

export async function readingLogRoutes(fastify: FastifyInstance) {
  fastify.get("/api/books/search", async (request, reply) => {
    const { q } = request.query as { q?: string };
    if (q !== undefined && (typeof q !== "string" || q.length > 500)) return reply.status(400).send({ ok: false, error: "Consulta inválida" });
    if (!q?.trim()) return reply.send({ ok: true, data: [] });
    try {
      return reply.send({ ok: true, data: await searchBookCatalogs(q.trim()) });
    } catch (error) {
      request.log.warn({ error }, "No se ha podido consultar ningún catálogo de libros");
      return reply.status(502).send({ ok: false, error: "Los catálogos de libros no están disponibles" });
    }
  });
  fastify.get("/api/reading-log", async (_request, reply) => reply.send({ ok: true, data: await listReadingBooks() }));
  fastify.post("/api/reading-log", async (request, reply) => {
    const candidate = parseBookCandidate(request.body);
    if (!candidate) return reply.status(400).send({ ok: false, error: "Libro inválido" });
    return reply.status(201).send({ ok: true, data: await addReadingBook(candidate) });
  });
  fastify.patch("/api/reading-log/:id", async (request, reply) => {
    const changes = parseReadingBookChanges(request.body);
    if (!changes) return reply.status(400).send({ ok: false, error: "Cambios de lectura inválidos" });
    const book = await updateReadingBook((request.params as { id: string }).id, changes);
    return book ? reply.send({ ok: true, data: book }) : reply.status(404).send({ ok: false, error: "Libro no encontrado" });
  });
  fastify.delete("/api/reading-log/:id", async (request, reply) => (await deleteReadingBook((request.params as { id: string }).id) ? reply.status(204).send() : reply.status(404).send()));
}
