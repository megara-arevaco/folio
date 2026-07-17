import type { FastifyInstance } from "fastify";
import { searchBookCatalogs } from "../services/bookSearch";
import { addReadingBook, deleteReadingBook, listReadingBooks, updateReadingBook } from "../services/readingLog";

export async function readingLogRoutes(fastify: FastifyInstance) {
  fastify.get("/api/books/search", async (request, reply) => {
    const { q } = request.query as { q?: string };
    if (!q?.trim()) return reply.send({ ok: true, data: [] });
    try {
      return reply.send({ ok: true, data: await searchBookCatalogs(q.trim()) });
    } catch (error) {
      request.log.warn({ error }, "No se ha podido consultar ningún catálogo de libros");
      return reply.status(502).send({ ok: false, error: "Los catálogos de libros no están disponibles" });
    }
  });
  fastify.get("/api/reading-log", async (_request, reply) => reply.send({ ok: true, data: await listReadingBooks() }));
  fastify.post("/api/reading-log", async (request, reply) => reply.status(201).send({ ok: true, data: await addReadingBook(request.body as never) }));
  fastify.patch("/api/reading-log/:id", async (request, reply) => {
    const book = await updateReadingBook((request.params as { id: string }).id, request.body as never);
    return book ? reply.send({ ok: true, data: book }) : reply.status(404).send({ ok: false, error: "Libro no encontrado" });
  });
  fastify.delete("/api/reading-log/:id", async (request, reply) => (await deleteReadingBook((request.params as { id: string }).id) ? reply.status(204).send() : reply.status(404).send()));
}
