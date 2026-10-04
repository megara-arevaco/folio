import type { TextItem } from "../types";
export type { TextItem } from "../types";
import { integerSetting } from "./shared/limits";
import { readBoundedBody, readBoundedJson } from "./shared/network";
import type { GlossaryEntry } from "../types";



const LLM_MOCK = process.env.LLM_MOCK === "true";
const LLM_API_BASE_URL = process.env.LLM_API_BASE_URL ?? "";
const LLM_API_KEY = process.env.LLM_API_KEY ?? "";
const LLM_MODEL = process.env.LLM_MODEL ?? "";
const LLM_TIMEOUT_MS = integerSetting("LLM_TIMEOUT_MS", 120000, 1000, 900000);
const OPENROUTER_SITE_URL = process.env.OPENROUTER_SITE_URL ?? "";
const OPENROUTER_APP_NAME = process.env.OPENROUTER_APP_NAME ?? "";

const SYSTEM_PROMPT =
  "Eres un traductor profesional literario. Traduce del ingles al espanol de Espana con naturalidad, conservando el significado, tono, dialogos y estilo. No resumas. No expliques. No anadas comentarios. Devuelve exclusivamente JSON valido.";
const STRICT_JSON_SYSTEM_PROMPT = `${SYSTEM_PROMPT} Tu respuesta se procesa automaticamente: no incluyas markdown, texto antes o despues del JSON, ni claves distintas de las solicitadas.`;

function formatGlossary(glossary: GlossaryEntry[]): string {
  if (glossary.length === 0) return "(sin glosario)";
  return JSON.stringify(glossary);
}

function buildUserPrompt(items: TextItem[], glossary: GlossaryEntry[], context = ""): string {
  return `Traduce al espanol el campo "text" de cada item. Conserva exactamente el mismo "id". No cambies el orden. Devuelve solo un objeto JSON valido con esta forma exacta: {"items":[{"id":"...", "text":"..."}]}.

Glosario obligatorio (si aparece un termino, respeta su traduccion):
${formatGlossary(glossary)}

Contexto cercano, solo como referencia y no para traducirlo:
${context || "(sin contexto adicional)"}

Items:
${JSON.stringify(items)}`;
}

export function cleanTranslationText(text: string): string {
  return text
    .normalize("NFC")
    .replace(/^\s*(?:(?:\[(?:ES|es|Spanish|Español)\])|(?:traducción|translation)\s*:)\s*/i, "")
    .replace(/^\s*(?:traducción|translation)\s*:\s*/i, "")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .trim();
}

function cleanTranslationItems(items: TextItem[]): TextItem[] {
  return items.map((item) => ({ ...item, text: cleanTranslationText(item.text) }));
}

function validateResponse(items: TextItem[], response: TextItem[]): void {
  if (!Array.isArray(response)) {
    throw new Error("La respuesta del LLM no es un array JSON valido");
  }

  const sentIds = new Set(items.map((i) => i.id));
  const receivedIds = new Set(response.map((i) => i.id));

  if (response.length !== items.length || sentIds.size !== receivedIds.size || receivedIds.size !== response.length) {
    throw new Error(
      `Discrepancia de IDs: enviados ${sentIds.size}, recibidos ${receivedIds.size}`
    );
  }

  for (const id of sentIds) {
    if (!receivedIds.has(id)) {
      throw new Error(`Falta el ID "${id}" en la respuesta del LLM`);
    }
  }

  for (const item of response) {
    if (!sentIds.has(item.id)) {
      throw new Error(`ID desconocido "${item.id}" en la respuesta del LLM`);
    }
    if (typeof item.text !== "string" || item.text.length === 0) {
      throw new Error(`Texto vacio o invalido para el ID "${item.id}"`);
    }
  }
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Authorization": `Bearer ${LLM_API_KEY}`,
    "Content-Type": "application/json",
  };

  if (OPENROUTER_SITE_URL) {
    headers["HTTP-Referer"] = OPENROUTER_SITE_URL;
  }

  if (OPENROUTER_APP_NAME) {
    headers["X-OpenRouter-Title"] = OPENROUTER_APP_NAME;
  }

  return headers;
}

function extractJsonCandidates(content: string): string[] {
  const candidates: string[] = [];

  for (let start = 0; start < content.length; start++) {
    const opening = content[start];
    if (opening !== "{" && opening !== "[") continue;

    const stack = [opening === "{" ? "}" : "]"];
    let inString = false;
    let escaped = false;

    for (let index = start + 1; index < content.length; index++) {
      const character = content[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (character === "\\") {
          escaped = true;
        } else if (character === '"') {
          inString = false;
        }
        continue;
      }

      if (character === '"') {
        inString = true;
      } else if (character === "{") {
        stack.push("}");
      } else if (character === "[") {
        stack.push("]");
      } else if (character === stack[stack.length - 1]) {
        stack.pop();
        if (stack.length === 0) {
          candidates.push(content.slice(start, index + 1));
          break;
        }
      } else if (character === "}" || character === "]") {
        break;
      }
    }
  }

  return candidates;
}

export function parseJsonContent(rawContent: string): unknown {
  const trimmed = rawContent.trim();

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1]?.trim();
  const candidates = [trimmed, ...(fenced ? [fenced] : []), ...extractJsonCandidates(trimmed)];

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Prueba el siguiente objeto o array JSON encontrado en la respuesta.
    }
  }

  throw new Error("El LLM no devolvio JSON valido");
}

export function normalizeTranslationResponse(parsed: unknown): TextItem[] {
  if (Array.isArray(parsed)) {
    return parsed as TextItem[];
  }

  if (parsed && typeof parsed === "object") {
    const objectResponse = parsed as {
      items?: unknown;
      translations?: unknown;
      data?: unknown;
    };

    if (Array.isArray(objectResponse.items)) {
      return objectResponse.items as TextItem[];
    }

    if (Array.isArray(objectResponse.translations)) {
      return objectResponse.translations as TextItem[];
    }

    if (Array.isArray(objectResponse.data)) {
      return objectResponse.data as TextItem[];
    }
  }

  throw new Error("La respuesta del LLM no es un array JSON valido");
}

async function callLLM(
  items: TextItem[],
  glossary: GlossaryEntry[],
  context = "",
  strictJson = false,
): Promise<TextItem[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const response = await fetch(`${LLM_API_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          { role: "system", content: strictJson ? STRICT_JSON_SYSTEM_PROMPT : SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(items, glossary, context) },
        ],
        temperature: 0.3,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await readBoundedBody(response, 1024 * 1024).then((body) => body.toString("utf8")).catch(() => "");
      throw new Error(
        `API LLM respondio con ${response.status}: ${body.slice(0, 200)}`
      );
    }

    const data = (await readBoundedJson(response)) as {
      choices: { message: { content: string } }[];
    };

    const rawContent = data.choices?.[0]?.message?.content;
    if (!rawContent) {
      throw new Error("Respuesta del LLM sin contenido");
    }

    const parsed = parseJsonContent(rawContent);
    const translated = normalizeTranslationResponse(parsed);
    validateResponse(items, translated);

    const cleaned = cleanTranslationItems(translated);
    validateResponse(items, cleaned);
    return cleaned;
  } finally {
    clearTimeout(timeout);
  }
}

function mockTranslate(items: TextItem[]): TextItem[] {
  return items.map((item) => ({
    id: item.id,
    text: `[ES] ${item.text}`,
  }));
}

async function callJsonLLM(system: string, user: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const response = await fetch(`${LLM_API_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`API LLM respondio con ${response.status}`);
    }
    const data = (await readBoundedJson(response)) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("Respuesta del LLM sin contenido");
    return parseJsonContent(content);
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeGlossaryResponse(parsed: unknown): GlossaryEntry[] {
  const raw = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { glossary?: unknown }).glossary)
      ? (parsed as { glossary: unknown[] }).glossary
      : [];

  const seen = new Set<string>();
  return raw
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
    .map((entry) => ({
      source: typeof entry.source === "string" ? entry.source.trim() : "",
      target: typeof entry.target === "string" ? entry.target.trim() : "",
      type: ["name", "place", "term", "title"].includes(String(entry.type))
        ? (entry.type as GlossaryEntry["type"])
        : "term",
    }))
    .filter((entry) => {
      const key = entry.source.toLocaleLowerCase();
      if (!entry.source || !entry.target || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 100);
}

export async function generateGlossary(items: TextItem[]): Promise<GlossaryEntry[]> {
  if (LLM_MOCK || items.length === 0) return [];
  const sample = items.map((item) => item.text).join("\n").slice(0, 16000);
  const parsed = await callJsonLLM(
    "Eres un editor literario. Extrae terminos importantes para mantener consistencia en una traduccion. No traduzcas frases completas.",
    `Extrae nombres propios, lugares, titulos y terminos recurrentes del siguiente texto. Propón su traduccion al espanol. No inventes entradas. Devuelve solo {"glossary":[{"source":"...","target":"...","type":"name|place|term|title"}]}.

Texto:
${sample}`,
  );
  return normalizeGlossaryResponse(parsed);
}

export async function reviewTranslationBatch(
  items: TextItem[],
  glossary: GlossaryEntry[] = [],
): Promise<TextItem[]> {
  if (LLM_MOCK || items.length === 0) return items;
  const parsed = await callJsonLLM(
    "Eres un revisor de traduccion literaria. Corrige solo errores claros de sentido, gramatica o coherencia. No reescribas innecesariamente.",
    `Revisa estos textos ya traducidos al espanol. Devuelve exactamente los mismos IDs y textos corregidos, en un objeto {"items":[...]}. Respeta el glosario. Si un texto esta bien, dejalo igual.\nGlosario:\n${formatGlossary(glossary)}\nItems:\n${JSON.stringify(items)}`,
  );
  const reviewed = normalizeTranslationResponse(parsed);
  validateResponse(items, reviewed);
  const cleaned = cleanTranslationItems(reviewed);
  validateResponse(items, cleaned);
  return cleaned;
}

export async function translateBatch(
  items: TextItem[],
  glossary: GlossaryEntry[] = [],
  context = "",
  strictJson = false,
): Promise<TextItem[]> {
  if (LLM_MOCK) {
    return mockTranslate(items);
  }

  try {
    return await callLLM(items, glossary, context, strictJson);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Error al traducir lote: ${message}`);
  }
}

export async function translateWithRetry(
  items: TextItem[],
  glossary: GlossaryEntry[] = [],
  context = "",
): Promise<TextItem[]> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await translateBatch(items, glossary, context, attempt > 0);
    } catch (error) {
      lastError = error;
    }
  }

  if (items.length > 1) {
    const splitIndex = Math.ceil(items.length / 2);
    const firstHalf = await translateWithRetry(items.slice(0, splitIndex), glossary, context);
    const secondHalf = await translateWithRetry(items.slice(splitIndex), glossary, context);
    return [...firstHalf, ...secondHalf];
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Error al traducir lote tras varios intentos: ${message}`);
}
