import type { Queue, QueueJob } from "./queue/queue.js";

export interface WorkerDeps {
  queue: Pick<Queue, "claimNext" | "complete" | "fail">;
  runOne: (job: QueueJob) => Promise<void>;
  maxRetries: number;
  log: (event: Record<string, unknown>) => void;
}

export async function tick(deps: WorkerDeps): Promise<boolean> {
  const job = deps.queue.claimNext();
  if (!job) return false;
  const repo = `${job.owner}/${job.repo}`;
  const startedAt = Date.now();
  deps.log({ event: "job_start", repo, pr: job.pr, headSha: job.headSha });
  try {
    await deps.runOne(job);
    deps.queue.complete(job);
    deps.log({ event: "job_done", repo, pr: job.pr, headSha: job.headSha, durationMs: Date.now() - startedAt });
  } catch (err) {
    const e = err as Error;
    deps.log({ level: "error", event: "job_failed", repo, pr: job.pr, headSha: job.headSha, durationMs: Date.now() - startedAt, error: String(err), stack: e?.stack });
    deps.queue.fail(job, deps.maxRetries);
  }
  return true;
}

export function startWorker(deps: WorkerDeps, pollMs: number): () => void {
  let stopped = false;
  const loop = async () => {
    while (!stopped) {
      const ran = await tick(deps);
      if (!ran) await new Promise((r) => setTimeout(r, pollMs));
    }
  };
  void loop();
  return () => {
    stopped = true;
  };
}
