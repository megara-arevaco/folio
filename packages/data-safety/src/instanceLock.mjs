import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const LOCK_ROLES = new Set(["api", "folio-data:backup", "folio-data:restore", "folio-data:recover", "folio-lock-guard"]);
const TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateLockRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Number.isSafeInteger(value.pid) || value.pid <= 0 ||
    !LOCK_ROLES.has(value.role) || typeof value.token !== "string" || !TOKEN_PATTERN.test(value.token) ||
    typeof value.startedAt !== "string" || !Number.isFinite(Date.parse(value.startedAt))) {
    throw new Error("El bloqueo de Folio está dañado o usa un formato no compatible; no se modifica ningún dato");
  }
  return value;
}

async function readLockRecord(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("El bloqueo de Folio no es un archivo regular; no se modifica ningún dato");
  try { return validateLockRecord(JSON.parse(await readFile(path, "utf8"))); }
  catch (error) {
    if (error?.code === "ENOENT") throw error;
    if (error instanceof SyntaxError) throw new Error("El bloqueo de Folio está dañado; no se modifica ningún dato");
    throw error;
  }
}

async function pidIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("El bloqueo de Folio contiene un PID inválido; no se modifica ningún dato");
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if (error?.code === "EPERM") return true;
    if (error?.code === "ESRCH") return false;
    throw new Error("No se pudo validar el PID del bloqueo de Folio; no se modifica ningún dato");
  }
}

async function createExclusiveRecord(path, record) {
  const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try {
    await handle.writeFile(JSON.stringify(record));
    await handle.sync();
  } finally { await handle.close(); }
}

async function acquireGuard(dataDir) {
  const path = join(dataDir, ".folio-instance.guard");
  const record = { pid: process.pid, role: "folio-lock-guard", token: randomUUID(), startedAt: new Date().toISOString() };
  try { await createExclusiveRecord(path, record); }
  catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error("El bloqueo de coordinación de Folio ya existe. No se recupera automáticamente; confirma que no hay procesos Folio y revisa .folio-instance.guard antes de continuar");
    }
    throw error;
  }
  return async () => {
    try {
      const current = await readLockRecord(path);
      if (current.pid === record.pid && current.role === record.role && current.token === record.token) await rm(path, { force: true });
    } catch (error) { if (error?.code !== "ENOENT") throw error; }
  };
}

async function withGuard(dataDir, action) {
  const releaseGuard = await acquireGuard(dataDir);
  try { return await action(); }
  finally { await releaseGuard(); }
}

/**
 * Acquire the common API/CLI lock. Only the explicit `recover` command may remove a valid
 * stale instance lock, and it does so while holding the exclusive coordination guard.
 */
export async function acquireInstanceLock(inputDir, role, allowStaleRecovery = false) {
  if (!LOCK_ROLES.has(role) || role === "folio-lock-guard" || allowStaleRecovery && role !== "folio-data:recover") {
    throw new Error("Rol de bloqueo de Folio no permitido");
  }
  const dataDir = resolve(inputDir);
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const path = join(dataDir, ".folio-instance.lock");
  const record = { pid: process.pid, role, token: randomUUID(), startedAt: new Date().toISOString() };
  await withGuard(dataDir, async () => {
    try {
      const current = await readLockRecord(path);
      if (await pidIsAlive(current.pid)) {
        throw new Error(`Folio está activo (${current.role}, PID ${current.pid}); no se puede iniciar ${role}`);
      }
      if (!allowStaleRecovery) {
        throw new Error(`El bloqueo de Folio parece abandonado (${current.role}, PID ${current.pid}). No se elimina automáticamente; ejecuta node scripts/folio-data.mjs recover --data-dir "${dataDir}" para recuperarlo explícitamente.`);
      }
      // All Folio lock creators/removers use this same guard, preventing unlink of a replacement lock.
      await rm(path);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await createExclusiveRecord(path, record);
  });

  return async () => withGuard(dataDir, async () => {
    try {
      const current = await readLockRecord(path);
      if (current.pid === record.pid && current.role === record.role && current.token === record.token) await rm(path);
    } catch (error) { if (error?.code !== "ENOENT") throw error; }
  });
}

export async function assertNoRestoreJournal(dataDir) {
  const root = resolve(dataDir);
  const journal = join(root, ".folio-restore-journal.json");
  try {
    await lstat(journal);
    throw new Error(`Hay una restauración pendiente (${journal}). La API no iniciará ni escribirá; ejecuta node scripts/folio-data.mjs recover --data-dir "${root}" con Folio detenido.`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
