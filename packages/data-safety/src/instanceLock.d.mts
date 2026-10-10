export type FolioLockRole = "api" | "folio-data:backup" | "folio-data:restore" | "folio-data:recover";

export function acquireInstanceLock(
  dataDir: string,
  role: FolioLockRole,
  allowStaleRecovery?: boolean,
): Promise<() => Promise<void>>;

export function assertNoRestoreJournal(dataDir: string): Promise<void>;
