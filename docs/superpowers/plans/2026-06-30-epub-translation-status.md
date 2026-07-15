# EPUB Translation Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a frontend flow that uploads an EPUB through a service, tracks translation progress through a hook, and renders a UI that shows a loading state until a download icon is available.

**Architecture:** Keep networking out of the visual component. A small service handles `POST /api/translate`, a hook owns the file/job state machine and polling, and a presentational component renders idle/loading/ready/error states. `App.tsx` just wires the hook to the component.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind CSS, DaisyUI.

---

### Task 1: Add a translation API service

**Files:**
- Create: `apps/web/src/services/translation.ts`

- [ ] **Step 1: Define the request/response types**

```ts
export type TranslateResponse = {
  ok: true;
  data: {
    jobId: string;
  };
};
```

- [ ] **Step 2: Implement the upload call**

```ts
export async function requestEpubTranslation(file: File): Promise<TranslateResponse["data"]> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("/api/translate", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error("No se ha podido iniciar la traduccion");
  }

  const payload = (await response.json()) as TranslateResponse;
  return payload.data;
}
```

### Task 2: Add a hook for the translation workflow

**Files:**
- Create: `apps/web/src/hooks/useEpubTranslation.ts`

- [ ] **Step 1: Model the UI states**

```ts
export type EpubTranslationState =
  | { status: "idle"; file: null; downloadUrl: null; error: null }
  | { status: "uploading"; file: File; downloadUrl: null; error: null }
  | { status: "translating"; file: File; downloadUrl: null; error: null }
  | { status: "ready"; file: File; downloadUrl: string; error: null }
  | { status: "error"; file: File | null; downloadUrl: null; error: string };
```

- [ ] **Step 2: Wire file selection to the service**

```ts
export function useEpubTranslation() {
  // track file, status, downloadUrl, and error
  // expose selectFile, startTranslation, reset, and component props
}
```

- [ ] **Step 3: Poll the job until a download URL is ready**

```ts
async function waitForJob(jobId: string): Promise<string> {
  // poll /api/jobs/:jobId until the API reports a download URL
}
```

### Task 3: Add a presentational status component

**Files:**
- Create: `apps/web/src/components/EpubTranslationStatus/EpubTranslationStatus.tsx`
- Create: `apps/web/src/components/EpubTranslationStatus/index.ts`

- [ ] **Step 1: Render idle/loading/ready/error states**

```tsx
type Props = {
  status: "idle" | "uploading" | "translating" | "ready" | "error";
  downloadUrl?: string | null;
  error?: string | null;
};
```

- [ ] **Step 2: Show a loading indicator while translating**

```tsx
{status === "translating" && (
  <span className="loading loading-spinner loading-lg text-primary" />
)}
```

- [ ] **Step 3: Show a download action when ready**

```tsx
{status === "ready" && downloadUrl && (
  <a className="btn btn-primary" href={downloadUrl}>
    Descargar EPUB
  </a>
)}
```

### Task 4: Connect the flow in `App.tsx`

**Files:**
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Replace the placeholder content with the translation flow**

```tsx
const { state, selectFile, startTranslation } = useEpubTranslation();
```

- [ ] **Step 2: Pass the hook state into the UI component**

```tsx
<FilePicker onFileSelected={selectFile} disabled={state.status !== "idle"} />
<button onClick={startTranslation}>Traducir EPUB</button>
<EpubTranslationStatus status={state.status} downloadUrl={state.downloadUrl} error={state.error} />
```

- [ ] **Step 3: Keep the layout compact and readable**

```tsx
<main className="min-h-screen bg-base-200">
  <section className="mx-auto flex min-h-screen w-full max-w-2xl items-center px-6 py-10">
    {/* content */}
  </section>
</main>
```

### Task 5: Verify the build

**Files:**
- None

- [ ] **Step 1: Typecheck the web app**

```bash
pnpm typecheck
```

- [ ] **Step 2: Build the web app**

```bash
pnpm build
```

