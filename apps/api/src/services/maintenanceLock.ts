import { join, resolve } from "node:path";
import { acquireInstanceLock, assertNoRestoreJournal } from "../../../../packages/data-safety/src/instanceLock.mjs";

function dataRoot(): string {
  return resolve(process.env.FOLIO_DATA_DIR ?? join(process.cwd(), "tmp"));
}

/** API entrypoints may never reclaim a stale lock; use the offline recovery CLI explicitly. */
export function acquireFolioInstanceLock(): Promise<() => Promise<void>> {
  return acquireInstanceLock(dataRoot(), "api");
}

/** Refuse to touch data left between restore and explicit CLI recovery. */
export function assertNoRestoreJournalPending(): Promise<void> {
  return assertNoRestoreJournal(dataRoot());
}
