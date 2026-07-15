# EPUB Job Processing And Download Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist uploaded EPUB files to temporary storage, process translation jobs asynchronously with real progress updates, and expose a download route for completed EPUBs.

**Architecture:** Keep job state in memory but store input and output files on disk under a per-job temporary directory. `POST /api/translate` saves the upload and schedules a background worker. `processEpub` reports progress through a callback, `jobs.ts` serializes public job state including `downloadUrl`, and `GET /api/jobs/:jobId/download` serves the translated file only when available.

**Tech Stack:** Fastify, TypeScript, Node.js `fs/promises`, streams, AdmZip, Cheerio.

---

### Task 1: Extend job metadata and temp file management

**Files:**
- Modify: `apps/api/src/types.ts`
- Modify: `apps/api/src/services/jobs.ts`
- Test: `apps/api/src/services/jobs.test.ts`

- [ ] Add file path fields and a public response shape for jobs.
- [ ] Add helpers to create per-job temp directories and compute input/output paths.
- [ ] Add a serializer that includes `downloadUrl` only for completed jobs.

### Task 2: Save uploads and run the translation asynchronously

**Files:**
- Modify: `apps/api/src/routes/translate.ts`
- Modify: `apps/api/src/services/jobs.ts`

- [ ] Persist the uploaded EPUB into the job temp directory.
- [ ] Return `jobId` immediately after persistence succeeds.
- [ ] Start a detached async worker that updates status, runs `processEpub`, writes the output EPUB, and records failures.

### Task 3: Emit real progress from EPUB processing

**Files:**
- Modify: `apps/api/src/services/epub.ts`

- [ ] Extend `processEpub` to accept a progress callback.
- [ ] Emit clear phase messages for reading, batching, translating fragment X of Y, and generating the final EPUB.
- [ ] Keep the callback optional so pure unit tests stay simple.

### Task 4: Expose job state and download route

**Files:**
- Modify: `apps/api/src/routes/jobs.ts`
- Modify: `apps/api/src/services/jobs.ts`

- [ ] Return the public serialized job state from `GET /api/jobs/:jobId`.
- [ ] Add `GET /api/jobs/:jobId/download` with `404` for missing jobs and `409` when the output is not ready.
- [ ] Serve the translated EPUB with download headers.

### Task 5: Verify

**Files:**
- None

- [ ] Run the job service test with `node --import tsx --test`.
- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm build`.

