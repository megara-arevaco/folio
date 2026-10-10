import type { FastifyInstance, FastifyReply } from "fastify";
import {
  getOpenRouterSettingsStatus,
  removeSavedOpenRouterApiKey,
  saveOpenRouterApiKey,
} from "../services/openRouterSettings";

const MAX_API_KEY_LENGTH = 512;

function settingsResponse(reply: FastifyReply, data: ReturnType<typeof getOpenRouterSettingsStatus>) {
  return reply.header("Cache-Control", "no-store").send({ ok: true, data });
}

export async function settingsRoutes(fastify: FastifyInstance) {
  fastify.get("/api/settings/openrouter", async (_request, reply) =>
    settingsResponse(reply, getOpenRouterSettingsStatus()));

  fastify.put("/api/settings/openrouter", async (request, reply) => {
    const body = request.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return reply.status(400).send({ ok: false, error: "La clave de OpenRouter no es válida" });
    }
    const input = (body as { apiKey?: unknown }).apiKey;
    if (typeof input !== "string") {
      return reply.status(400).send({ ok: false, error: "La clave de OpenRouter no es válida" });
    }
    const apiKey = input.trim();
    if (!apiKey || apiKey.length > MAX_API_KEY_LENGTH || /[\u0000-\u001f\u007f]/.test(apiKey)) {
      return reply.status(400).send({ ok: false, error: "La clave de OpenRouter no es válida" });
    }

    return settingsResponse(reply, saveOpenRouterApiKey(apiKey));
  });

  fastify.delete("/api/settings/openrouter", async (_request, reply) =>
    settingsResponse(reply, removeSavedOpenRouterApiKey()));
}
