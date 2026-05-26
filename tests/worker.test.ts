import { describe, it, expect, vi } from "vitest";
import { tick, type WorkerDeps } from "../src/worker.js";
import type { QueueJob } from "../src/queue/queue.js";

const qjob: QueueJob = { owner: "o", repo: "r", pr: 1, headSha: "h", baseSha: "b", installationId: 1 };

function makeQueue(next: QueueJob | null) {
  return {
    claimNext: vi.fn(() => next),
    complete: vi.fn(),
    fail: vi.fn(),
  };
}

describe("tick", () => {
  it("does nothing when no job is ready", async () => {
    const queue = makeQueue(null);
    const deps: WorkerDeps = { queue: queue as any, runOne: vi.fn(), maxRetries: 3, log: vi.fn() };
    const ran = await tick(deps);
    expect(ran).toBe(false);
    expect(deps.runOne).not.toHaveBeenCalled();
  });

  it("runs a claimed job then completes it", async () => {
    const queue = makeQueue(qjob);
    const runOne = vi.fn(async () => {});
    const deps: WorkerDeps = { queue: queue as any, runOne, maxRetries: 3, log: vi.fn() };
    const ran = await tick(deps);
    expect(ran).toBe(true);
    expect(runOne).toHaveBeenCalledWith(qjob);
    expect(queue.complete).toHaveBeenCalledWith(qjob);
    expect(queue.fail).not.toHaveBeenCalled();
  });

  it("fails the job (does not complete) when runOne throws", async () => {
    const queue = makeQueue(qjob);
    const runOne = vi.fn(async () => { throw new Error("boom"); });
    const deps: WorkerDeps = { queue: queue as any, runOne, maxRetries: 3, log: vi.fn() };
    await tick(deps);
    expect(queue.fail).toHaveBeenCalledWith(qjob, 3);
    expect(queue.complete).not.toHaveBeenCalled();
  });
});
