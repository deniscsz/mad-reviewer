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
  try {
    await deps.runOne(job);
    deps.queue.complete(job);
  } catch (err) {
    deps.log({ level: "error", repo: `${job.owner}/${job.repo}`, pr: job.pr, error: String(err) });
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
