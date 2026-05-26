import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Queue, type QueueJob } from "../src/queue/queue.js";

let dir: string;
let dbPath: string;

const job: QueueJob = {
  owner: "o", repo: "r", pr: 1, headSha: "sha1", baseSha: "base1", installationId: 99,
};

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "queue-test-"));
  dbPath = path.join(dir, "queue.db");
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("Queue", () => {
  it("does not surface a job before its debounce window elapses", () => {
    const q = new Queue(dbPath, 1000);
    q.enqueue(job, 0);
    expect(q.claimNext(500)).toBeNull();      // within debounce
    expect(q.claimNext(1000)).not.toBeNull(); // window elapsed
    q.close();
  });

  it("coalesces a burst of pushes into one pending job", () => {
    const q = new Queue(dbPath, 1000);
    q.enqueue({ ...job, headSha: "shaA" }, 0);
    q.enqueue({ ...job, headSha: "shaB" }, 200); // resets debounce, updates sha
    expect(q.claimNext(1000)).toBeNull();        // 200 + 1000 = 1200 not yet
    const claimed = q.claimNext(1200);
    expect(claimed?.headSha).toBe("shaB");
    q.close();
  });

  it("runs only one job per PR at a time (claim marks it running)", () => {
    const q = new Queue(dbPath, 0);
    q.enqueue(job, 0);
    expect(q.claimNext(0)).not.toBeNull();
    expect(q.claimNext(0)).toBeNull(); // already running, not re-claimable
    q.close();
  });

  it("skips enqueue when headSha equals last_processed_sha", () => {
    const q = new Queue(dbPath, 0);
    q.enqueue(job, 0);
    const claimed = q.claimNext(0)!;
    q.complete(claimed, 0);
    expect(q.enqueue({ ...job, headSha: "sha1" }, 1)).toBe(false); // same sha → skip
    expect(q.enqueue({ ...job, headSha: "sha2" }, 2)).toBe(true);  // new sha → enqueue
    q.close();
  });

  it("survives a restart (reopens the same db file)", () => {
    const q1 = new Queue(dbPath, 0);
    q1.enqueue(job, 0);
    q1.close();
    const q2 = new Queue(dbPath, 0);
    expect(q2.claimNext(0)?.headSha).toBe("sha1");
    q2.close();
  });

  it("reclaims a job left 'running' after a restart", () => {
    const q1 = new Queue(dbPath, 0);
    q1.enqueue(job, 0);
    q1.claimNext(0); // marks it 'running', then the process "dies"
    q1.close();
    const q2 = new Queue(dbPath, 0); // constructor resets stale 'running' -> 'pending'
    expect(q2.claimNext(0)?.headSha).toBe("sha1");
    q2.close();
  });

  it("re-queues on fail until max retries, then marks failed", () => {
    const q = new Queue(dbPath, 0);
    q.enqueue(job, 0);
    let claimed = q.claimNext(0)!;
    q.fail(claimed, 2, 0);                 // attempt 1 → pending again
    claimed = q.claimNext(0)!;
    expect(claimed.headSha).toBe("sha1");
    q.fail(claimed, 2, 0);                 // attempt 2 → failed
    expect(q.claimNext(0)).toBeNull();     // no longer pending
    q.close();
  });
});
