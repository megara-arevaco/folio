# Local Queue And Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Endure container restarts and page reloads with a local multi-user translation pipeline that preserves uploads, resumes jobs safely, reports truthful progress, and exposes reliable pause, resume, and download controls.

**Architecture:** Keep everything local on disk under `tmp/jobs`, but stop treating the API process as both registry and worker. Introduce a persistent queue and worker coordination layer backed by files or SQLite so the API can recover job state, the worker can continue or retry batch execution, and the frontend can render authoritative job state without depending on transient in-memory flags.

**Tech Stack:** Fastify, React, TypeScript, Node.js `fs/promises`, local disk persistence under `tmp/jobs`, optional SQLite for queue locking and worker leases.

---

### Task 1: Audit the current job lifecycle and persistence boundaries

**Files:**
- Modify: `docs/superpowers/plans/2026-07-01-local-queue-and-recovery.md`
- Inspect: `apps/api/src/services/jobs.ts`
- Inspect: `apps/api/src/services/epub.ts`
- Inspect: `apps/api/src/routes/jobs.ts`
- Inspect: `apps/web/src/components/EpubTranslationStatus/useEpubTranslation.ts`
- Inspect: `apps/web/src/components/TranslationsPage.tsx`

- [ ] **Step 1: Trace the current lifecycle on paper**

```text
upload -> createJob() -> persistJobUpload() -> startJobProcessing()
      -> processEpub() batch checkpoints -> output file write
      -> done | paused | error
      -> resumePendingJobs() on API boot
```

- [ ] **Step 2: Record the current state boundaries**

```text
Authoritative today:
- job.json: status, progress, filenames, paths, checkpointBatchIndex
- translated-items.json: translated fragments checkpoint
- localStorage: only "active job" for one browser session

Non-authoritative today:
- activeRuns Set
- in-memory jobs Map
- browser component state
```

- [ ] **Step 3: List concrete failure modes to eliminate**

```text
1. API restart loses in-memory execution state until bootstrap reload runs.
2. Multiple users share one flat history with no ownership model.
3. A crashed batch can leave a stale progress message that looks active.
4. Pause/resume depends on a single process-local worker execution model.
5. There is no queue lease or worker claim, so horizontal scaling would double-process jobs.
```

### Task 2: Introduce a durable queue record and worker lease model

**Files:**
- Create: `apps/api/src/services/queue.ts`
- Modify: `apps/api/src/types.ts`
- Modify: `apps/api/src/services/jobs.ts`
- Test: `apps/api/src/services/jobs.persistence.test.ts`

- [ ] **Step 1: Extend the persisted job model with queue metadata**

```ts
export type JobStatus =
  | "pending"
  | "queued"
  | "processing"
  | "paused"
  | "done"
  | "error";

export type Job = {
  id: string;
  status: JobStatus;
  queuePosition: number | null;
  workerId: string | null;
  leaseExpiresAt: Date | null;
  retryCount: number;
  lastHeartbeatAt: Date | null;
  checkpointBatchIndex: number;
  // existing file and progress fields stay unchanged
};
```

- [ ] **Step 2: Define a minimal queue service interface**

```ts
export type QueueClaim = {
  jobId: string;
  workerId: string;
  leaseExpiresAt: Date;
};

export interface JobQueueStore {
  enqueue(jobId: string): Promise<void>;
  claimNext(workerId: string): Promise<QueueClaim | null>;
  heartbeat(jobId: string, workerId: string): Promise<void>;
  release(jobId: string, workerId: string): Promise<void>;
  requeueExpiredLeases(now: Date): Promise<string[]>;
}
```

- [ ] **Step 3: Keep the first implementation conservative**

```text
Phase 1 implementation:
- Use one local SQLite file or one queue metadata JSON file under tmp/jobs.
- Single host only.
- Atomic writes only.
- No distributed coordination.
```

- [ ] **Step 4: Add persistence tests for lease recovery**

```ts
test("requeues claimed jobs whose worker lease expired", async () => {
  // seed queued + claimed job records
  // expire lease
  // assert job returns to queued/pending state
});
```

### Task 3: Split API and worker responsibilities without introducing external services

**Files:**
- Create: `apps/api/src/services/worker.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/routes/translate.ts`
- Modify: `apps/api/src/services/jobs.ts`
- Test: `apps/api/src/services/jobs.persistence.test.ts`

- [ ] **Step 1: Change the upload route to enqueue instead of directly executing**

```ts
const job = createJob(file.filename);
await persistJobUpload(job, file);
await enqueueJob(job.id);

reply.send({
  ok: true,
  data: { jobId: job.id },
});
```

- [ ] **Step 2: Add a worker loop with heartbeat and graceful pause checks**

```ts
export async function startWorkerLoop(workerId: string): Promise<void> {
  while (true) {
    const claim = await claimNextJob(workerId);
    if (!claim) {
      await delay(1000);
      continue;
    }

    await runClaimedJob(claim);
  }
}
```

- [ ] **Step 3: Send periodic heartbeat while translating**

```ts
const heartbeatTimer = setInterval(() => {
  void heartbeat(job.id, workerId);
}, 5000);
```

- [ ] **Step 4: Verify restart recovery**

```ts
test("worker resumes an interrupted job after server restart bootstrap", async () => {
  // write queued/processing record to disk
  // boot loader
  // assert worker picks it back up from checkpointBatchIndex
});
```

### Task 4: Make progress and failure states truthful for the frontend

**Files:**
- Modify: `apps/api/src/services/jobs.ts`
- Modify: `apps/api/src/types.ts`
- Modify: `apps/web/src/services/translation.ts`
- Modify: `apps/web/src/components/TranslationsPage.tsx`
- Modify: `apps/web/src/components/EpubTranslationStatus/useEpubTranslation.ts`
- Test: `apps/api/src/services/jobs.test.ts`

- [ ] **Step 1: Persist a dedicated user-facing status message**

```ts
export type JobProgress = {
  current: number;
  total: number;
  message: string;
  detail?: string;
};
```

- [ ] **Step 2: Overwrite stale progress text on terminal failure**

```ts
export function setJobError(id: string, error: string): void {
  const job = jobs.get(id);
  if (!job) return;

  job.status = "error";
  job.error = error;
  job.progress = {
    ...job.progress,
    message: "Error en la traduccion",
    detail: error,
  };
  schedulePersist(job);
}
```

- [ ] **Step 3: Render terminal state messages truthfully in the history page**

```tsx
const message =
  job.status === "error"
    ? job.error ?? "Error en la traduccion"
    : job.progress.message;
```

- [ ] **Step 4: Add a regression test for failed jobs**

```ts
test("setJobError replaces the progress message with an explicit failure state", () => {
  // create job
  // set progress to translating
  // call setJobError()
  // assert status === error and progress.message === "Error en la traduccion"
});
```

### Task 5: Add local multi-user ownership boundaries

**Files:**
- Modify: `apps/api/src/types.ts`
- Modify: `apps/api/src/routes/translate.ts`
- Modify: `apps/api/src/routes/jobs.ts`
- Modify: `apps/web/src/services/translation.ts`
- Modify: `apps/web/src/components/TranslationsPage.tsx`
- Test: `apps/api/src/routes/jobs.test.ts`

- [ ] **Step 1: Add a local actor identifier**

```ts
export type Job = {
  id: string;
  ownerId: string;
  // existing fields
};
```

- [ ] **Step 2: Accept a frontend-supplied local actor token**

```ts
const ownerId = request.headers["x-owner-id"];
if (typeof ownerId !== "string" || ownerId.length === 0) {
  reply.code(400).send({ ok: false, error: "Falta x-owner-id" });
  return;
}
```

- [ ] **Step 3: Filter the default history by owner**

```ts
const jobs = listJobsByOwner(ownerId);
```

- [ ] **Step 4: Keep an optional admin view for all jobs**

```text
Only expose cross-user history deliberately, never as the default list endpoint.
```

### Task 6: Verification

**Files:**
- None

- [ ] **Step 1: Run targeted API tests**

```bash
node --import tsx --test apps/api/src/services/jobs.test.ts apps/api/src/services/jobs.persistence.test.ts
```

- [ ] **Step 2: Run the full typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 3: Run the full build**

```bash
pnpm build
```

- [ ] **Step 4: Manual restart test**

```bash
docker compose up --build
# upload one large epub
# stop api container during processing
# start again
# verify /translations shows queued or processing and job resumes from checkpoint
```
