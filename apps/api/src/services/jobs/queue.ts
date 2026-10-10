import type { Job, JobKind } from "../../types";

type QueueDependencies = {
  jobs: Map<string, Job>;
  persistJob: (job: Job) => Promise<void>;
  schedulePersist: (job: Job) => void;
  processJob: (id: string) => Promise<void>;
  onError: (error: unknown) => void;
};

export function createJobQueue({ jobs, persistJob, schedulePersist, processJob, onError }: QueueDependencies) {
  const getJob = (id: string) => jobs.get(id);
  const activeRuns = new Set<string>();
  const jobQueues: Record<JobKind, string[]> = { "epub-translation": [], "pdf-conversion": [] };
  const queuedJobIds = new Set<string>();
  const workerRunning: Record<JobKind, boolean> = { "epub-translation": false, "pdf-conversion": false };
  const tasks = new Set<Promise<void>>();
  const runningTasks = new Map<JobKind, Promise<void>>();
  let stopping = false;
  function drain(kind: JobKind): Promise<void> {
    if (stopping) return Promise.resolve();
    const existing = runningTasks.get(kind);
    if (existing) return existing;
    const task = drainJobQueue(kind).catch(onError);
    runningTasks.set(kind, task);
    tasks.add(task);
    void task.finally(() => {
      tasks.delete(task);
      runningTasks.delete(kind);
      const paused = [...jobs.values()].some((job) => job.kind === kind && job.status === "paused");
      if (!stopping && jobQueues[kind].length && !paused) void drain(kind);
    }).catch(onError);
    return task;
  }
  function insertPausedJobIntoQueue(job: Job): void {
    const queue = jobQueues[job.kind];
    if (!queuedJobIds.has(job.id)) {
      queue.unshift(job.id);
      queuedJobIds.add(job.id);
    }
    queue.forEach((jobId, index) => {
      const queuedJob = jobs.get(jobId);
      if (queuedJob) {
        queuedJob.queueOrder = index;
        schedulePersist(queuedJob);
      }
    });
    refreshQueueProgress(job.kind);
  }

  async function reorderQueuedJob(
    id: string,
    position: number,
  ): Promise<Job | "missing" | "not-queued"> {
    const job = jobs.get(id);
    if (!job) return "missing";
    if ((job.status !== "pending" && job.status !== "paused") || !queuedJobIds.has(id)) {
      return "not-queued";
    }

    const queue = jobQueues[job.kind];
    const currentPosition = queue.indexOf(id);
    if (currentPosition < 0) return "not-queued";

    queue.splice(currentPosition, 1);
    const nextPosition = Math.max(0, Math.min(Math.trunc(position), queue.length));
    queue.splice(nextPosition, 0, id);

    const queuedJobs = queue
      .map((jobId, index) => {
        const queuedJob = jobs.get(jobId);
        if (queuedJob) queuedJob.queueOrder = index;
        return queuedJob;
      })
      .filter((queuedJob): queuedJob is Job => Boolean(queuedJob));
    refreshQueueProgress(job.kind);
    await Promise.all(queuedJobs.map((queuedJob) => persistJob(queuedJob)));
    return job;
  }

  async function startQueuedJob(id: string): Promise<Job | "missing" | "not-queued"> {
    const job = jobs.get(id);
    if (!job) return "missing";
    if (job.status !== "pending" || !queuedJobIds.has(id)) return "not-queued";

    const queue = jobQueues[job.kind];
    const currentPosition = queue.indexOf(id);
    if (currentPosition < 0) return "not-queued";

    queue.splice(currentPosition, 1);
    queue.unshift(id);
    const queuedJobs = queue
      .map((jobId, index) => {
        const queuedJob = jobs.get(jobId);
        if (queuedJob) queuedJob.queueOrder = index;
        return queuedJob;
      })
      .filter((queuedJob): queuedJob is Job => Boolean(queuedJob));
    refreshQueueProgress(job.kind);
    await Promise.all(queuedJobs.map((queuedJob) => persistJob(queuedJob)));
    void drain(job.kind);
    return job;
  }

  function refreshQueueProgress(kind: JobKind): void {
    for (const jobId of jobQueues[kind]) {
      const job = getJob(jobId);
      if (!job || job.status !== "pending") continue;
      job.progress = {
        ...job.progress,
        message:
          job.kind === "epub-translation" &&
          job.progress.total > 0 &&
          job.checkpointBatchIndex >= job.progress.total
            ? "Preparado para generar EPUB"
            : "En cola",
      };
      job.lastProgressAt = new Date();
      schedulePersist(job);
    }
  }

  async function drainJobQueue(kind: JobKind): Promise<void> {
    if (workerRunning[kind] || stopping) return;
    workerRunning[kind] = true;

    try {
      while (jobQueues[kind].length > 0 && !stopping) {
        if (getJob(jobQueues[kind][0]!)?.status === "paused") break;
        const jobId = jobQueues[kind].shift()!;
        queuedJobIds.delete(jobId);
        refreshQueueProgress(kind);

        const job = getJob(jobId);
        if (!job || job.kind !== kind || job.status !== "pending") continue;
        await processJob(jobId);
        if (getJob(jobId)?.status === "paused") break;
      }
    } finally {
      workerRunning[kind] = false;

    }
  }

  async function startJobProcessing(jobId: string): Promise<void> {
    const job = getJob(jobId);
    if (stopping || !job || job.status !== "pending" || activeRuns.has(jobId) || queuedJobIds.has(jobId)) {
      return;
    }

    if (job.queueOrder === null) {
      const orders = jobQueues[job.kind]
        .map((queuedJobId) => getJob(queuedJobId)?.queueOrder)
        .filter((order): order is number => order !== null && order !== undefined);
      job.queueOrder = orders.length > 0 ? Math.max(...orders) + 1 : 0;
    }
    jobQueues[job.kind].push(jobId);
    jobQueues[job.kind].sort(
      (leftId, rightId) => (getJob(leftId)?.queueOrder ?? 0) - (getJob(rightId)?.queueOrder ?? 0),
    );
    queuedJobIds.add(jobId);
    refreshQueueProgress(job.kind);
    await persistJob(job);
    void drain(job.kind);
  }

  return {
    has: (id: string) => queuedJobIds.has(id),
    isActive: (id: string) => activeRuns.has(id),
    enterRun: (id: string) => activeRuns.add(id),
    leaveRun: (id: string) => activeRuns.delete(id),
    insertPausedJobIntoQueue, reorderQueuedJob, startQueuedJob, startJobProcessing,
    drain,
    remove(job: Job) {
      const queue = jobQueues[job.kind];
      const index = queue.indexOf(job.id);
      if (index >= 0) queue.splice(index, 1);
      queuedJobIds.delete(job.id);
      refreshQueueProgress(job.kind);
    },
    restore() {
      if (activeRuns.size || Object.values(workerRunning).some(Boolean)) throw new Error("No se puede restaurar una cola activa");
      stopping = false;
      queuedJobIds.clear();
      for (const kind of Object.keys(jobQueues) as JobKind[]) {
        const restored = [...jobs.values()]
          .filter((job) => job.kind === kind && (job.status === "paused" || job.status === "pending"))
          .sort((left, right) => (left.queueOrder ?? 0) - (right.queueOrder ?? 0));
        jobQueues[kind] = restored.map((job) => job.id);
        restored.forEach((job, index) => { job.queueOrder = index; queuedJobIds.add(job.id); });
        refreshQueueProgress(kind);
      }
    },
    async stop() {
      stopping = true;
      await Promise.all([...tasks]);
    },
  };
}
