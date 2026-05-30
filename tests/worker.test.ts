import { describe, it, expect, vi } from "vitest";
import { tick, type WorkerDeps } from "../src/worker.js";
import type { QueueJob } from "../src/queue/queue.js";

const qjob: QueueJob = { owner: "o", repo: "r", pr: 1, headSha: "h", baseSha: "b", installationId: 1 };
const summary = { created: 0, kept: 0, resolved: 0 };

function makeQueue(next: QueueJob | null, dead = false) {
  return {
    claimNext: vi.fn(() => next),
    complete: vi.fn(),
    fail: vi.fn(() => dead),
  };
}

function makeChecks(startId: number | null = 123) {
  return {
    start: vi.fn(async () => startId),
    finishSuccess: vi.fn(async () => {}),
    finishFailure: vi.fn(async () => {}),
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
    const runOne = vi.fn(async () => summary);
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

  it("starts a check on claim and finishes success", async () => {
    const queue = makeQueue(qjob);
    const checks = makeChecks();
    const runOne = vi.fn(async () => ({ created: 1, kept: 2, resolved: 0 }));
    const deps: WorkerDeps = { queue: queue as any, runOne, maxRetries: 3, log: vi.fn(), checks };
    await tick(deps);
    expect(checks.start).toHaveBeenCalledWith(qjob);
    expect(checks.finishSuccess).toHaveBeenCalledWith(123, qjob, { created: 1, kept: 2, resolved: 0 });
    expect(checks.finishFailure).not.toHaveBeenCalled();
  });

  it("does not finish a check that failed to start (null id)", async () => {
    const queue = makeQueue(qjob);
    const checks = makeChecks(null);
    const runOne = vi.fn(async () => summary);
    const deps: WorkerDeps = { queue: queue as any, runOne, maxRetries: 3, log: vi.fn(), checks };
    await tick(deps);
    expect(checks.finishSuccess).not.toHaveBeenCalled();
    expect(queue.complete).toHaveBeenCalledWith(qjob); // job still completes
  });

  it("finishes failure only when the failed job is terminal (dead)", async () => {
    const runOne = vi.fn(async () => { throw new Error("boom"); });

    const retrying = makeChecks();
    await tick({ queue: makeQueue(qjob, false) as any, runOne, maxRetries: 3, log: vi.fn(), checks: retrying });
    expect(retrying.finishFailure).not.toHaveBeenCalled();

    const dead = makeChecks();
    await tick({ queue: makeQueue(qjob, true) as any, runOne, maxRetries: 3, log: vi.fn(), checks: dead });
    expect(dead.finishFailure).toHaveBeenCalledWith(123, qjob, expect.any(Error));
  });
});
