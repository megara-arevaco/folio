import { readFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { ResourceLocks, writeFileAtomically } from "./shared/files";
import { integerSetting } from "./shared/limits";

export type AiBudgetContext = { kind: "job" | "sample"; id: string };
type Usage = { requests: number; inputTokenBound: number; outputTokens: number };
type BudgetLedger = {
  version: 1;
  total: Usage;
  samples: Usage;
  jobs: Record<string, Usage>;
  sampleOperations: Record<string, Usage>;
};
export type AiBudgetCaps = {
  deployment: Usage;
  job: Usage;
  samples: Usage;
  sample: Usage;
  maxOutputTokensPerRequest: number;
};

const locks = new ResourceLocks();
const emptyUsage = (): Usage => ({ requests: 0, inputTokenBound: 0, outputTokens: 0 });
const emptyMap = (): Record<string, Usage> => Object.create(null) as Record<string, Usage>;
const emptyLedger = (): BudgetLedger => ({ version: 1, total: emptyUsage(), samples: emptyUsage(), jobs: emptyMap(), sampleOperations: emptyMap() });
const isSafeLedgerKey = (key: string): boolean => /^[a-zA-Z0-9_-]{1,240}$/.test(key) && !["__proto__", "prototype", "constructor"].includes(key);

function ledgerPath(): string {
  return join(resolve(process.env.FOLIO_DATA_DIR ?? join(process.cwd(), "tmp")), "ai-budget.json");
}

export function getAiBudgetCaps(): AiBudgetCaps {
  return {
    deployment: {
      requests: integerSetting("AI_BUDGET_MAX_REQUESTS", 50_000, 1, 1_000_000_000),
      inputTokenBound: integerSetting("AI_BUDGET_MAX_INPUT_TOKEN_BOUND", 50_000_000, 1, 1_000_000_000_000),
      outputTokens: integerSetting("AI_BUDGET_MAX_OUTPUT_TOKENS", 20_000_000, 1, 1_000_000_000_000),
    },
    job: {
      requests: integerSetting("AI_BUDGET_MAX_JOB_REQUESTS", 1_000, 1, 1_000_000_000),
      inputTokenBound: integerSetting("AI_BUDGET_MAX_JOB_INPUT_TOKEN_BOUND", 2_000_000, 1, 1_000_000_000_000),
      outputTokens: integerSetting("AI_BUDGET_MAX_JOB_OUTPUT_TOKENS", 1_000_000, 1, 1_000_000_000_000),
    },
    samples: {
      requests: integerSetting("AI_BUDGET_MAX_SAMPLE_TOTAL_REQUESTS", 1_000, 1, 1_000_000_000),
      inputTokenBound: integerSetting("AI_BUDGET_MAX_SAMPLE_TOTAL_INPUT_TOKEN_BOUND", 10_000_000, 1, 1_000_000_000_000),
      outputTokens: integerSetting("AI_BUDGET_MAX_SAMPLE_TOTAL_OUTPUT_TOKENS", 5_000_000, 1, 1_000_000_000_000),
    },
    sample: {
      requests: integerSetting("AI_BUDGET_MAX_SAMPLE_REQUESTS", 20, 1, 1_000_000_000),
      inputTokenBound: integerSetting("AI_BUDGET_MAX_SAMPLE_INPUT_TOKEN_BOUND", 1_000_000, 1, 1_000_000_000_000),
      outputTokens: integerSetting("AI_BUDGET_MAX_SAMPLE_OUTPUT_TOKENS", 300_000, 1, 1_000_000_000_000),
    },
    maxOutputTokensPerRequest: integerSetting("LLM_MAX_OUTPUT_TOKENS", 4096, 1, 128_000),
  };
}

function isUsage(value: unknown): value is Usage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const usage = value as Record<string, unknown>;
  return ["requests", "inputTokenBound", "outputTokens"].every((key) => Number.isSafeInteger(usage[key]) && Number(usage[key]) >= 0);
}

function validateLedger(value: unknown): BudgetLedger {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("El registro persistente de límites IA está dañado; se bloquean nuevas llamadas para no superar el límite");
  const ledger = value as Record<string, unknown>;
  if (ledger.version !== 1 || !isUsage(ledger.total) || !isUsage(ledger.samples) || !ledger.jobs || typeof ledger.jobs !== "object" || Array.isArray(ledger.jobs) ||
    !ledger.sampleOperations || typeof ledger.sampleOperations !== "object" || Array.isArray(ledger.sampleOperations) ||
    !Object.entries(ledger.jobs).every(([key, usage]) => isSafeLedgerKey(key) && isUsage(usage)) ||
    !Object.entries(ledger.sampleOperations).every(([key, usage]) => isSafeLedgerKey(key) && isUsage(usage))) {
    throw new Error("El registro persistente de límites IA no tiene un formato válido; se bloquean nuevas llamadas");
  }
  ledger.jobs = Object.assign(emptyMap(), ledger.jobs);
  ledger.sampleOperations = Object.assign(emptyMap(), ledger.sampleOperations);
  return ledger as BudgetLedger;
}

async function readLedger(): Promise<BudgetLedger> {
  try { return validateLedger(JSON.parse(await readFile(ledgerPath(), "utf8"))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyLedger();
    throw error;
  }
}

function exceeds(current: Usage, addition: Usage, limit: Usage): boolean {
  return current.requests + addition.requests > limit.requests ||
    current.inputTokenBound + addition.inputTokenBound > limit.inputTokenBound ||
    current.outputTokens + addition.outputTokens > limit.outputTokens;
}

function addUsage(current: Usage, addition: Usage): Usage {
  return {
    requests: current.requests + addition.requests,
    inputTokenBound: current.inputTokenBound + addition.inputTokenBound,
    outputTokens: current.outputTokens + addition.outputTokens,
  };
}

export class AiBudgetExceededError extends Error {
  constructor(scope: "deployment" | "job" | "sample") {
    super(`Límite de llamadas IA agotado (${scope}). No se ha enviado esta petición. Aumenta el límite configurado en el servidor o espera a un nuevo trabajo; el checkpoint se conserva.`);
    this.name = "AiBudgetExceededError";
  }
}

/** Reserve a conservative request bound before any provider HTTP request. Reservations are never refunded. */
export async function reserveAiBudget(context: AiBudgetContext, serializedRequest: string, outputTokens: number): Promise<void> {
  if (!isSafeLedgerKey(context.id) || !["job", "sample"].includes(context.kind) || !Number.isSafeInteger(outputTokens) || outputTokens < 1) {
    throw new Error("Contexto de reserva de límite IA inválido");
  }
  const inputTokenBound = Buffer.byteLength(serializedRequest, "utf8") + 256;
  if (!Number.isSafeInteger(inputTokenBound)) throw new Error("La petición supera el tamaño reservable");
  const addition: Usage = { requests: 1, inputTokenBound, outputTokens };
  const caps = getAiBudgetCaps();
  await locks.run(ledgerPath(), async () => {
    const ledger = await readLedger();
    if (exceeds(ledger.total, addition, caps.deployment)) throw new AiBudgetExceededError("deployment");
    if (context.kind === "job") {
      const current = ledger.jobs[context.id] ?? emptyUsage();
      if (exceeds(current, addition, caps.job)) throw new AiBudgetExceededError("job");
      ledger.jobs[context.id] = addUsage(current, addition);
    } else {
      const current = ledger.sampleOperations[context.id] ?? emptyUsage();
      if (exceeds(ledger.samples, addition, caps.samples) || exceeds(current, addition, caps.sample)) throw new AiBudgetExceededError("sample");
      ledger.sampleOperations[context.id] = addUsage(current, addition);
      ledger.samples = addUsage(ledger.samples, addition);
    }
    ledger.total = addUsage(ledger.total, addition);
    const path = ledgerPath();
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFileAtomically(path, `${JSON.stringify(ledger, null, 2)}\n`);
  });
}

export async function getAiBudgetSnapshot(): Promise<{ caps: AiBudgetCaps; usage: { deployment: Usage; samples: Usage } }> {
  const caps = getAiBudgetCaps();
  const ledger = await readLedger();
  return { caps, usage: { deployment: ledger.total, samples: ledger.samples } };
}
