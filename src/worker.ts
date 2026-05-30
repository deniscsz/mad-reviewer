import type { Queue, QueueJob } from "./queue/queue.js";
import type { RunSummary } from "./runner.js";
import type { CheckReporter } from "./github/checks.js";

export interface WorkerDeps {
  queue: Pick<Queue, "claimNext" | "complete" | "fail">;
  runOne: (job: QueueJob) => Promise<RunSummary | void>;
  maxRetries: number;
  log: (event: Record<string, unknown>) => void;
  checks?: CheckReporter;
}

export async function tick(deps: WorkerDeps): Promise<boolean> {
  const job = deps.queue.claimNext();
  if (!job) return false;
  const repo = `${job.owner}/${job.repo}`;
  const startedAt = Date.now();
  deps.log({ event: "job_start", repo, pr: job.pr, headSha: job.headSha });
  const checkId = deps.checks ? await deps.checks.start(job) : null;
  try {
    const summary = await deps.runOne(job);
    deps.queue.complete(job);
    deps.log({ event: "job_done", repo, pr: job.pr, headSha: job.headSha, durationMs: Date.now() - startedAt });
    if (deps.checks && checkId != null && summary) {
      await deps.checks.finishSuccess(checkId, job, summary);
    }
  } catch (err) {
    const e = err as Error;
    deps.log({ level: "error", event: "job_failed", repo, pr: job.pr, headSha: job.headSha, durationMs: Date.now() - startedAt, error: String(err), stack: e?.stack });
    const dead = deps.queue.fail(job, deps.maxRetries);
    if (deps.checks && checkId != null && dead) {
      await deps.checks.finishFailure(checkId, job, err);
    }
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
