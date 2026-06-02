# GitHub Check Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a GitHub **Check Run** per review job (like Cursor BugBot) — `success` when no mad-reviewer comments remain open, `neutral` when any remain — without touching the existing inline-comment flow.

**Architecture:** The worker owns a check-run lifecycle: it creates an `in_progress` check on claim and finalizes it on success/terminal-failure. A fail-soft `CheckReporter` (in `src/github/checks.ts`) encapsulates the GitHub Checks API calls, client acquisition, and logging, so the worker stays simple and existing tests are unaffected. Conclusion is derived from the existing `RunSummary` (`created + kept === 0 ? success : neutral`). Idempotency comes from `checks.listForRef` (reuse-or-create) — no DB migration.

**Tech Stack:** Node ≥ 22, TypeScript (ESM, `.js` import extensions), Probot/Octokit, better-sqlite3, zod, vitest, VitePress.

**Spec:** `docs/superpowers/specs/2026-05-29-github-check-run-design.md`

**Branch:** `feat/github-check-run` (already created off `main`; the spec commit `07aff03` is here).

---

## File map

| File | Responsibility | Action |
|---|---|---|
| `src/config.ts` | Parse `MAD_REVIEWER_CHECKS` + `MAD_REVIEWER_CHECK_NAME` | Modify |
| `src/queue/queue.ts` | `fail()` returns `boolean` (job is now terminal/dead) | Modify |
| `src/github/comments.ts` | Extend `GitHubClient` with `rest.checks.*` | Modify |
| `src/github/checks.ts` | Pure formatters + `startCheckRun`/`finishCheckRun` + `createCheckReporter` (fail-soft) | Create |
| `src/worker.ts` | Drive the check lifecycle around the job | Modify |
| `src/index.ts` | Build the reporter, return `RunSummary` from `runOne`, inject into worker | Modify |
| `tests/config.test.ts` | Cover the two new env vars | Modify |
| `tests/queue.test.ts` | Cover `fail()` return value | Modify |
| `tests/worker.test.ts` | Cover the lifecycle | Modify |
| `tests/checks.test.ts` | Cover formatters, start/finish, reporter fail-soft | Create |
| Docs (9 files) | App permission + config + architecture + new page | Modify/Create |

---

## Task 1: Config flags

**Files:**
- Modify: `src/config.ts`
- Test: `tests/config.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/config.test.ts` (before the final `throws when a required var is missing` test):

```ts
  it("enables checks by default", () => {
    expect(loadConfig(base).checksEnabled).toBe(true);
  });

  it("disables checks when MAD_REVIEWER_CHECKS=false", () => {
    expect(loadConfig({ ...base, MAD_REVIEWER_CHECKS: "false" }).checksEnabled).toBe(false);
  });

  it("treats any non-false MAD_REVIEWER_CHECKS as enabled", () => {
    expect(loadConfig({ ...base, MAD_REVIEWER_CHECKS: "true" }).checksEnabled).toBe(true);
  });

  it("defaults the check name to mad-reviewer", () => {
    expect(loadConfig(base).checkName).toBe("mad-reviewer");
  });

  it("reads a custom MAD_REVIEWER_CHECK_NAME when set", () => {
    expect(loadConfig({ ...base, MAD_REVIEWER_CHECK_NAME: "ai-review" }).checkName).toBe("ai-review");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL — `checksEnabled`/`checkName` are not on the config object.

- [ ] **Step 3: Implement the config changes**

In `src/config.ts`, add two fields to `EnvSchema` (after the `MAD_REVIEWER_DEBUG` line):

```ts
  MAD_REVIEWER_CHECKS: z.string().default("true"),
  MAD_REVIEWER_CHECK_NAME: z.string().default("mad-reviewer"),
```

Add to the `Config` interface (after `debug: boolean;`):

```ts
  checksEnabled: boolean;
  checkName: string;
```

Add to the `loadConfig` return object (after `debug: e.MAD_REVIEWER_DEBUG === "true",`):

```ts
    checksEnabled: e.MAD_REVIEWER_CHECKS !== "false",
    checkName: e.MAD_REVIEWER_CHECK_NAME,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/config.test.ts`
Expected: PASS (all config tests).

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: add MAD_REVIEWER_CHECKS and MAD_REVIEWER_CHECK_NAME config"
```

---

## Task 2: `Queue.fail()` returns whether the job is terminal

**Files:**
- Modify: `src/queue/queue.ts:99-112`
- Test: `tests/queue.test.ts`

The worker needs to know when a failed job has exhausted retries (is `dead`) so it finalizes the check as `failure` only then.

- [ ] **Step 1: Write the failing test**

Add to `tests/queue.test.ts` (inside `describe("Queue", …)`):

```ts
  it("fail() returns false while retrying and true once dead", () => {
    const q = new Queue(dbPath, 0);
    q.enqueue(job, 0);
    let claimed = q.claimNext(0)!;
    expect(q.fail(claimed, 2, 0)).toBe(false); // attempt 1 → pending
    claimed = q.claimNext(0)!;
    expect(q.fail(claimed, 2, 0)).toBe(true);  // attempt 2 → failed (dead)
    q.close();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/queue.test.ts`
Expected: FAIL — `fail()` returns `undefined`, not a boolean.

- [ ] **Step 3: Implement the return value**

In `src/queue/queue.ts`, change the `fail` signature and add a return. Replace:

```ts
  fail(job: QueueJob, maxRetries: number, now: number = Date.now()): void {
```

with:

```ts
  fail(job: QueueJob, maxRetries: number, now: number = Date.now()): boolean {
```

Then, at the end of the method (after the `this.log({ … })` call, before the closing `}`), add:

```ts
    return status === "failed";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/queue.test.ts`
Expected: PASS (all queue tests).

- [ ] **Step 5: Commit**

```bash
git add src/queue/queue.ts tests/queue.test.ts
git commit -m "feat: Queue.fail returns whether the job is now dead"
```

---

## Task 3: Checks module — types + pure formatters

**Files:**
- Modify: `src/github/comments.ts:5-13` (extend `GitHubClient`)
- Create: `src/github/checks.ts`
- Test: `tests/checks.test.ts` (create)

- [ ] **Step 1: Write the failing tests**

Create `tests/checks.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { conclusionFor, formatOutput, errorOutput } from "../src/github/checks.js";

const empty = { created: 0, kept: 0, resolved: 0 };

describe("conclusionFor", () => {
  it("is success when no comments remain open", () => {
    expect(conclusionFor(empty)).toBe("success");
    expect(conclusionFor({ created: 0, kept: 0, resolved: 5 })).toBe("success");
  });
  it("is neutral when any comment is open (new or kept)", () => {
    expect(conclusionFor({ created: 1, kept: 0, resolved: 0 })).toBe("neutral");
    expect(conclusionFor({ created: 0, kept: 2, resolved: 0 })).toBe("neutral");
  });
});

describe("formatOutput", () => {
  it("reports no open problems when nothing remains", () => {
    const out = formatOutput(empty, { adapter: "claude" });
    expect(out.title).toBe("Nenhum problema em aberto");
    expect(out.summary).toContain("claude");
    expect(out.summary).toContain("🎉");
  });
  it("reports the open count and prior-review carryover", () => {
    const out = formatOutput({ created: 1, kept: 2, resolved: 1 }, { adapter: "cursor", model: "sonnet-4" });
    expect(out.title).toBe("3 problema(s) em aberto");
    expect(out.summary).toContain("sonnet-4");
    expect(out.summary).toContain("de revisões anteriores");
  });
});

describe("errorOutput", () => {
  it("renders the error message", () => {
    const out = errorOutput(new Error("kaboom"));
    expect(out.title).toBe("Revisão falhou");
    expect(out.summary).toContain("kaboom");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/checks.test.ts`
Expected: FAIL — `../src/github/checks.js` does not exist.

- [ ] **Step 3: Extend `GitHubClient`**

In `src/github/comments.ts`, replace the `rest` block inside the `GitHubClient` interface:

```ts
  rest: {
    pulls: {
      createReviewComment: (params: Record<string, unknown>) => Promise<unknown>;
      createReplyForReviewComment: (params: Record<string, unknown>) => Promise<unknown>;
    };
  };
```

with:

```ts
  rest: {
    pulls: {
      createReviewComment: (params: Record<string, unknown>) => Promise<unknown>;
      createReplyForReviewComment: (params: Record<string, unknown>) => Promise<unknown>;
    };
    checks: {
      create: (params: Record<string, unknown>) => Promise<{ data: { id: number } }>;
      update: (params: Record<string, unknown>) => Promise<unknown>;
      listForRef: (params: Record<string, unknown>) => Promise<{ data: { check_runs: Array<{ id: number; name: string }> } }>;
    };
  };
```

- [ ] **Step 4: Create `src/github/checks.ts` with the pure formatters**

```ts
import type { RunSummary } from "../runner.js";

export interface CheckMeta {
  adapter: string;
  model?: string;
}

/** success when no bot comments remain open (created + kept === 0), else neutral. */
export function conclusionFor(summary: RunSummary): "success" | "neutral" {
  return summary.created + summary.kept === 0 ? "success" : "neutral";
}

export function formatOutput(summary: RunSummary, meta: CheckMeta): { title: string; summary: string } {
  const open = summary.created + summary.kept;
  const model = meta.model ? ` (${meta.model})` : "";
  const body = [
    `Revisão concluída com **${meta.adapter}**${model}.`,
    "",
    `🆕 ${summary.created} novo(s) · ♻️ ${summary.kept} mantido(s) · ✅ ${summary.resolved} resolvido(s)`,
    "",
    open === 0
      ? "Nenhum problema em aberto. 🎉"
      : `**${open} problema(s) em aberto** (${summary.kept} de revisões anteriores). Veja os comentários na aba *Files changed*.`,
  ].join("\n");
  return {
    title: open === 0 ? "Nenhum problema em aberto" : `${open} problema(s) em aberto`,
    summary: body,
  };
}

export function errorOutput(error: unknown): { title: string; summary: string } {
  const msg = error instanceof Error ? error.message : String(error);
  return {
    title: "Revisão falhou",
    summary: `A revisão não pôde ser concluída e nada foi postado.\n\n\`\`\`\n${msg}\n\`\`\``,
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/checks.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/github/comments.ts src/github/checks.ts tests/checks.test.ts
git commit -m "feat: check-run formatters + GitHubClient checks types"
```

---

## Task 4: `startCheckRun` / `finishCheckRun` (reuse-or-create)

**Files:**
- Modify: `src/github/checks.ts`
- Test: `tests/checks.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/checks.test.ts`:

```ts
import { vi } from "vitest";
import { startCheckRun, finishCheckRun } from "../src/github/checks.js";

function fakeClient(checksOver: Record<string, unknown> = {}) {
  return {
    graphql: vi.fn(),
    rest: {
      pulls: { createReviewComment: vi.fn(), createReplyForReviewComment: vi.fn() },
      checks: {
        create: vi.fn(async () => ({ data: { id: 999 } })),
        update: vi.fn(async () => ({})),
        listForRef: vi.fn(async () => ({ data: { check_runs: [] } })),
        ...checksOver,
      },
    },
  } as any;
}

describe("startCheckRun", () => {
  it("creates a new in_progress check when none exists for the sha", async () => {
    const client = fakeClient();
    const id = await startCheckRun(client, { owner: "o", repo: "r", headSha: "h", name: "mad-reviewer" });
    expect(id).toBe(999);
    expect(client.rest.checks.create).toHaveBeenCalledWith(
      expect.objectContaining({ owner: "o", repo: "r", name: "mad-reviewer", head_sha: "h", status: "in_progress" }),
    );
  });

  it("reuses an existing check for the sha instead of creating one", async () => {
    const client = fakeClient({
      listForRef: vi.fn(async () => ({ data: { check_runs: [{ id: 42, name: "mad-reviewer" }] } })),
    });
    const id = await startCheckRun(client, { owner: "o", repo: "r", headSha: "h", name: "mad-reviewer" });
    expect(id).toBe(42);
    expect(client.rest.checks.create).not.toHaveBeenCalled();
    expect(client.rest.checks.update).toHaveBeenCalledWith(
      expect.objectContaining({ check_run_id: 42, status: "in_progress" }),
    );
  });
});

describe("finishCheckRun", () => {
  it("completes the check with conclusion and output", async () => {
    const client = fakeClient();
    await finishCheckRun(client, {
      owner: "o", repo: "r", checkRunId: 7, conclusion: "neutral",
      output: { title: "t", summary: "s" },
    });
    expect(client.rest.checks.update).toHaveBeenCalledWith(
      expect.objectContaining({ check_run_id: 7, status: "completed", conclusion: "neutral" }),
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/checks.test.ts`
Expected: FAIL — `startCheckRun`/`finishCheckRun` are not exported.

- [ ] **Step 3: Implement the API helpers**

Append to `src/github/checks.ts` (add the import at the top, next to the existing `RunSummary` import):

```ts
import type { GitHubClient } from "./comments.js";
```

```ts
export async function startCheckRun(
  client: GitHubClient,
  opts: { owner: string; repo: string; headSha: string; name: string },
): Promise<number> {
  const existing = await client.rest.checks.listForRef({
    owner: opts.owner, repo: opts.repo, ref: opts.headSha, check_name: opts.name,
  });
  const runs = existing.data.check_runs ?? [];
  if (runs.length > 0) {
    await client.rest.checks.update({
      owner: opts.owner, repo: opts.repo, check_run_id: runs[0].id, status: "in_progress",
    });
    return runs[0].id;
  }
  const created = await client.rest.checks.create({
    owner: opts.owner, repo: opts.repo, name: opts.name, head_sha: opts.headSha, status: "in_progress",
  });
  return created.data.id;
}

export async function finishCheckRun(
  client: GitHubClient,
  opts: {
    owner: string; repo: string; checkRunId: number;
    conclusion: "success" | "neutral" | "failure";
    output: { title: string; summary: string };
  },
): Promise<void> {
  await client.rest.checks.update({
    owner: opts.owner, repo: opts.repo, check_run_id: opts.checkRunId,
    status: "completed", conclusion: opts.conclusion, output: opts.output,
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/checks.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/github/checks.ts tests/checks.test.ts
git commit -m "feat: startCheckRun (reuse-or-create) and finishCheckRun"
```

---

## Task 5: `createCheckReporter` (fail-soft + logging)

**Files:**
- Modify: `src/github/checks.ts`
- Test: `tests/checks.test.ts`

This is the fail-soft boundary: it acquires the client, calls the helpers, logs `check_create`/`check_complete`/`check_error`, and **never throws** (start returns `null` on error; finish swallows).

- [ ] **Step 1: Write the failing tests**

Append to `tests/checks.test.ts`:

```ts
import { createCheckReporter } from "../src/github/checks.js";

const qjob = { owner: "o", repo: "r", pr: 1, headSha: "h", baseSha: "b", installationId: 5 };

describe("createCheckReporter", () => {
  it("starts a check and logs check_create", async () => {
    const client = fakeClient();
    const log = vi.fn();
    const reporter = createCheckReporter({ getClient: async () => client, name: "mad-reviewer", meta: { adapter: "claude" }, log });
    const id = await reporter.start(qjob as any);
    expect(id).toBe(999);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: "check_create", checkRunId: 999 }));
  });

  it("returns null and logs check_error when start throws (fail-soft)", async () => {
    const log = vi.fn();
    const reporter = createCheckReporter({
      getClient: async () => { throw new Error("403"); },
      name: "mad-reviewer", meta: { adapter: "claude" }, log,
    });
    const id = await reporter.start(qjob as any);
    expect(id).toBeNull();
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: "check_error", phase: "start" }));
  });

  it("finishes success with the derived conclusion and logs check_complete", async () => {
    const client = fakeClient();
    const log = vi.fn();
    const reporter = createCheckReporter({ getClient: async () => client, name: "mad-reviewer", meta: { adapter: "claude" }, log });
    await reporter.finishSuccess(7, qjob as any, { created: 0, kept: 1, resolved: 0 });
    expect(client.rest.checks.update).toHaveBeenCalledWith(
      expect.objectContaining({ check_run_id: 7, status: "completed", conclusion: "neutral" }),
    );
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: "check_complete", conclusion: "neutral", open: 1 }));
  });

  it("finishes failure with conclusion failure", async () => {
    const client = fakeClient();
    const log = vi.fn();
    const reporter = createCheckReporter({ getClient: async () => client, name: "mad-reviewer", meta: { adapter: "claude" }, log });
    await reporter.finishFailure(7, qjob as any, new Error("boom"));
    expect(client.rest.checks.update).toHaveBeenCalledWith(
      expect.objectContaining({ check_run_id: 7, status: "completed", conclusion: "failure" }),
    );
  });

  it("swallows errors during finish (fail-soft)", async () => {
    const client = fakeClient({ update: vi.fn(async () => { throw new Error("down"); }) });
    const log = vi.fn();
    const reporter = createCheckReporter({ getClient: async () => client, name: "mad-reviewer", meta: { adapter: "claude" }, log });
    await expect(reporter.finishSuccess(7, qjob as any, { created: 0, kept: 0, resolved: 0 })).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: "check_error", phase: "finish" }));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/checks.test.ts`
Expected: FAIL — `createCheckReporter` is not exported.

- [ ] **Step 3: Implement the reporter**

Append to `src/github/checks.ts` (add the `QueueJob` import next to the others at the top):

```ts
import type { QueueJob } from "../queue/queue.js";
```

```ts
export interface CheckReporter {
  start(job: QueueJob): Promise<number | null>;
  finishSuccess(checkRunId: number, job: QueueJob, summary: RunSummary): Promise<void>;
  finishFailure(checkRunId: number, job: QueueJob, error: unknown): Promise<void>;
}

export function createCheckReporter(opts: {
  getClient: (installationId: number) => Promise<GitHubClient>;
  name: string;
  meta: CheckMeta;
  log: (event: Record<string, unknown>) => void;
}): CheckReporter {
  const { getClient, name, meta, log } = opts;
  const repoOf = (j: QueueJob) => `${j.owner}/${j.repo}`;
  return {
    async start(job) {
      try {
        const client = await getClient(job.installationId);
        const id = await startCheckRun(client, { owner: job.owner, repo: job.repo, headSha: job.headSha, name });
        log({ event: "check_create", repo: repoOf(job), pr: job.pr, headSha: job.headSha, checkRunId: id });
        return id;
      } catch (err) {
        log({ level: "error", event: "check_error", phase: "start", repo: repoOf(job), pr: job.pr, error: String(err) });
        return null;
      }
    },
    async finishSuccess(checkRunId, job, summary) {
      try {
        const client = await getClient(job.installationId);
        const conclusion = conclusionFor(summary);
        await finishCheckRun(client, { owner: job.owner, repo: job.repo, checkRunId, conclusion, output: formatOutput(summary, meta) });
        log({ event: "check_complete", repo: repoOf(job), pr: job.pr, checkRunId, conclusion, open: summary.created + summary.kept });
      } catch (err) {
        log({ level: "error", event: "check_error", phase: "finish", repo: repoOf(job), pr: job.pr, error: String(err) });
      }
    },
    async finishFailure(checkRunId, job, error) {
      try {
        const client = await getClient(job.installationId);
        await finishCheckRun(client, { owner: job.owner, repo: job.repo, checkRunId, conclusion: "failure", output: errorOutput(error) });
        log({ event: "check_complete", repo: repoOf(job), pr: job.pr, checkRunId, conclusion: "failure", open: null });
      } catch (err) {
        log({ level: "error", event: "check_error", phase: "finish", repo: repoOf(job), pr: job.pr, error: String(err) });
      }
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/checks.test.ts`
Expected: PASS (all checks tests).

- [ ] **Step 5: Commit**

```bash
git add src/github/checks.ts tests/checks.test.ts
git commit -m "feat: fail-soft CheckReporter with structured logging"
```

---

## Task 6: Worker drives the check lifecycle

**Files:**
- Modify: `src/worker.ts`
- Test: `tests/worker.test.ts`

- [ ] **Step 1: Write the failing tests**

Replace the entire contents of `tests/worker.test.ts` with:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/worker.test.ts`
Expected: FAIL — `WorkerDeps` has no `checks`; lifecycle not implemented.

- [ ] **Step 3: Rewrite `src/worker.ts`**

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/worker.test.ts`
Expected: PASS (all 6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/worker.ts tests/worker.test.ts
git commit -m "feat: worker drives the check-run lifecycle (fail-soft)"
```

---

## Task 7: Wire the reporter in `index.ts`

**Files:**
- Modify: `src/index.ts`

No unit test (composition root) — verified by typecheck + build. The lifecycle logic is covered by Tasks 5–6.

- [ ] **Step 1: Add the import**

In `src/index.ts`, change the runner import (line 7):

```ts
import { runReview } from "./runner.js";
```

to:

```ts
import { runReview, type RunSummary } from "./runner.js";
```

And add, after the `import type { Job } from "./types.js";` line:

```ts
import { createCheckReporter } from "./github/checks.js";
```

- [ ] **Step 2: Build the check reporter**

In `src/index.ts`, after the `const adapter = createAdapter(…)` block (ends line 35), add:

```ts
const checkModel =
  config.adapter === "opencode" ? config.opencodeModel :
  config.adapter === "cursor" ? config.cursorModel :
  undefined;

const checks = config.checksEnabled
  ? createCheckReporter({
      getClient,
      name: config.checkName,
      meta: { adapter: config.adapter, model: checkModel },
      log,
    })
  : undefined;
```

> Note: `getClient` is declared with `async function` below this point, so it is hoisted and safe to reference here.

- [ ] **Step 3: Return the summary from `runOne`**

Replace the `runOne` function (lines 48-70) so it returns the summary:

```ts
async function runOne(qjob: QueueJob): Promise<RunSummary> {
  const job: Job = qjob;
  return runReview(job, {
    getClient,
    getInstallationToken,
    clonePrHead,
    computeDiff,
    loadSkills,
    loadSoul,
    adapter,
    listActiveBotComments,
    postInlineFinding,
    resolveWithReply,
    config: {
      defaultsDir: config.defaultsDir,
      autoApplyDir: config.autoApplyDir,
      soulPath: config.soulPath,
      loadRepoSkills: config.loadRepoSkills,
      debug: config.debug,
    },
    log,
  });
}
```

- [ ] **Step 4: Inject `checks` into the worker**

Replace the `startWorker(…)` call (line 90):

```ts
  const stopWorker = startWorker({ queue, runOne, maxRetries: config.maxRetries, log }, config.workerPollMs);
```

with:

```ts
  const stopWorker = startWorker({ queue, runOne, maxRetries: config.maxRetries, log, checks }, config.workerPollMs);
```

Also add `checks` visibility to the boot log (optional but useful) — replace the `listening` log (line 89):

```ts
  log({ event: "listening", port: config.port, adapter: config.adapter, debug: config.debug });
```

with:

```ts
  log({ event: "listening", port: config.port, adapter: config.adapter, debug: config.debug, checks: config.checksEnabled });
```

- [ ] **Step 5: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: no errors.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS — all tests green.

- [ ] **Step 7: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire the check reporter into the worker"
```

---

## Task 8: Documentation

**Files:** `docs/guide/github-app-setup.md`, `README.md`, `docs/guide/configuration.md`, `docs/guide/getting-started.md`, `docs/guide/deployment.md`, `docs/architecture/overview.md`, `docs/architecture/check-runs.md` (create), `docs/.vitepress/config.ts`, `docs/reference/faq.md`, `.env.example`

The permission change is the most important per the user. Do each edit, then build the docs once.

- [ ] **Step 1: `docs/guide/github-app-setup.md` — permissions + events + verify**

In **§2 Permissions**, add a row to the table (after the `Pull requests` row):

```md
| Checks | **Read & write** | Create/update the per-PR check run |
```

In **§3 Event subscription**, append after the existing paragraph:

```md
> No additional event subscription is needed for the check run — mad-reviewer
> only *creates* checks; it does not react to `check_run`/`check_suite` events.
```

In **## Verify**, after the inline-comments sentence, add:

```md
A check run named **`mad-reviewer`** also appears in the PR's status box —
`success` (green) when no findings remain open, `neutral` (gray) when some do.
```

- [ ] **Step 2: `README.md` — feature, App setup, config table, dev tree**

In **## Features**, add a bullet after the "Self-resolving comments" bullet:

```md
- **GitHub Check Run** — each review also publishes a check on the PR head:
  `success` when no comments remain open, `neutral` when any do (never blocks
  merge by default). Needs the `Checks: write` App permission.
```

In **## GitHub App setup**, item 1, add a permission line after the `Pull requests` line:

```md
   - Checks: **Read & write** (publish the per-PR check run)
```

In the **## Configuration** table, add two rows after the `MAD_REVIEWER_DEBUG` row:

```md
| `MAD_REVIEWER_CHECKS` | | `true` | Publish a Check Run per review. Any value other than `false` keeps it on |
| `MAD_REVIEWER_CHECK_NAME` | | `mad-reviewer` | Name of the check (GitHub groups re-runs by name) |
```

In the **## Development** `src/` tree, update the `github/comments.ts` line and add a `github/checks.ts` line:

```md
  github/comments.ts # list active bot comments, post inline, resolve thread
  github/checks.ts   # publish the per-PR check run (status + summary)
```

- [ ] **Step 3: `docs/guide/configuration.md` — table, notes, logging, example**

In the **## Variables** table, add two rows after the `MAD_REVIEWER_DEBUG` row:

```md
| `MAD_REVIEWER_CHECKS` | | `true` | Publish a Check Run per review on the PR head. `success` when no findings stay open, `neutral` otherwise. Any value other than `false` keeps it on; see [Check Runs](/architecture/check-runs) |
| `MAD_REVIEWER_CHECK_NAME` | | `mad-reviewer` | Display name of the check (GitHub groups re-runs by the same name) |
```

In the **## Notes** list, add a bullet:

```md
- **`MAD_REVIEWER_CHECKS`** publishes a GitHub Check Run per review. Conclusion is
  `success` when no mad-reviewer comments remain open after the run and `neutral`
  when any remain (new or carried over) — it never blocks a merge by default. A
  run that errors/times out is reported `failure`. It needs the App's
  **`Checks: Read & write`** permission; if that is missing the check calls
  fail soft (a `check_error` is logged and the run still posts comments). See
  [Check Runs](/architecture/check-runs).
```

In the **### Always-on events** table, add three rows:

```md
| `check_create` | A check run was created/reused on claim | `repo`, `pr`, `headSha`, `checkRunId` |
| `check_complete` | A check run was finalized | `repo`, `pr`, `checkRunId`, `conclusion`, `open` |
| `check_error` | A check API call failed (fail-soft) | `repo`, `pr`, `phase`, `error` |
```

In the **## Example** `.env`, add after the `MAD_REVIEWER_DEBUG` line:

```bash
# MAD_REVIEWER_CHECKS=true                                  # false → no per-PR check run
# MAD_REVIEWER_CHECK_NAME=mad-reviewer                      # display name of the check
```

- [ ] **Step 4: `docs/guide/getting-started.md` — what happens on a PR**

In **## What happens on a PR**, append to item 3:

```md
3. A worker clones the PR, loads your skills, runs the AI adapter, and posts
   inline comments for any bugs found — and publishes a `mad-reviewer` check run
   summarizing the result.
```

(Replace the existing item 3 text with the above.)

- [ ] **Step 5: `docs/guide/deployment.md` — permission note**

In **## Runtime requirements**, after the persistent-volume bullet
(`A **persistent volume** for the SQLite queue …`), add this note block:

```md
> The GitHub App also needs the **`Checks: Read & write`** permission to publish
> the per-PR check run (existing installs must re-approve). This is not a runtime
> dependency — without it the check is skipped (a `check_error` is logged) and the
> review comments still post. See [GitHub App Setup](/guide/github-app-setup).
```

- [ ] **Step 6: `docs/architecture/overview.md` — flow + module**

In the **## Modules** table, update the `worker.ts` row and add a `github/checks.ts` row:

```md
| `worker.ts` | Drain the queue: claim → run → complete (or fail+retry), and drive the per-PR check-run lifecycle |
| `github/checks.ts` | Publish the per-PR check run (fail-soft): start on claim, finalize with conclusion + summary |
```

In the **## End-to-end flow** ASCII box, change line `│  9. cleanup workspace      │` region by adding a check step note under the Worker → Runner box:

```
│                  │  (worker: in_progress check → finalize: success/neutral) │
```

(Place it just below the `│ Worker → Runner` line so it reads as the worker's wrapper around the run.)

- [ ] **Step 7: Create `docs/architecture/check-runs.md`**

```md
# Check Runs

Alongside inline comments, `mad-reviewer` publishes a **Check Run** (GitHub
Checks API) on the PR's head commit — the status + summary that shows up in the
PR's checks box, the way Cursor BugBot does. It is layered on top of the existing
review flow: the inline comments are unchanged; the check is a status summary.

## Conclusion

The conclusion is derived from the run's reconcile result
(`RunSummary {created, kept, resolved}`):

- **`success`** (green ✓) — no mad-reviewer comments remain open
  (`created + kept === 0`).
- **`neutral`** (gray) — at least one remains open, whether new this run
  (`created`) or carried over from a prior run (`kept`).

`resolved` comments do not count — they were closed this run. No outcome is
`failure` for *finding bugs*, so the check never blocks a merge by default. (A
team can make it a *required* check via branch protection if they want a gate.)

A run that **errors or times out** (could not review) is reported `failure`, with
the error in the summary — an honest "the bot did not run" signal — only once the
job has exhausted its retries.

## Lifecycle

The **worker** owns the lifecycle, because it is the only place that sees both
success and failure:

1. **Claim** → create the check `in_progress` (`started_at` now). The check is
   keyed to the head SHA; `checks.listForRef` is consulted first so a retry or a
   process restart **reuses** the existing check instead of duplicating it.
2. The review runs.
3. **Success** → `completed` with the conclusion above and a markdown summary
   (counts + carryover).
4. **Terminal failure** → `completed` + `failure` + the error. A non-terminal
   failure (will retry) leaves the check `in_progress`.

## Fail-soft & permission

Publishing a check needs the App's **`Checks: Read & write`** permission (see
[GitHub App Setup](/guide/github-app-setup)). Existing installations must
re-approve it. If a check API call fails (e.g. the permission is missing → 403),
mad-reviewer logs a `check_error` and **continues** — the review comments are
still posted; a check failure never fails the job.

Set `MAD_REVIEWER_CHECKS=false` to disable the feature entirely, and
`MAD_REVIEWER_CHECK_NAME` to change the displayed name (GitHub groups re-runs by
name). See [Configuration](/guide/configuration).

## Findings stay in comments

The check carries only the summary; individual findings remain inline review
comments with the existing fingerprint dedup/resolve machinery — no annotations.
This mirrors BugBot (its check reports `annotations_count: 0`).
```

- [ ] **Step 8: `docs/.vitepress/config.ts` — sidebar entry**

After the `{ text: "AI Adapters", link: "/architecture/adapters" },` line, add:

```ts
          { text: "Check Runs", link: "/architecture/check-runs" },
```

- [ ] **Step 9: `docs/reference/faq.md` — add a Q&A**

After the **## What happens if a run fails midway?** section, add (the file uses a
`##` heading per question):

```md
## Does the check run block merging?

No. By default the check is `success` when no mad-reviewer comments remain open
and `neutral` when some do — neither blocks a merge. If you *want* it to gate
merges, make `mad-reviewer` a **required status check** in the branch protection
rules; then a `neutral` result will hold the PR. A run that errors/times out is
`failure`. The feature needs the App's `Checks: Read & write` permission and can
be turned off with `MAD_REVIEWER_CHECKS=false`.
```

- [ ] **Step 10: `.env.example` — add the flags**

After the `MAD_REVIEWER_DEBUG=false` line, add:

```bash
# Publish a GitHub Check Run per review (needs the App's "Checks: write" permission)
# MAD_REVIEWER_CHECKS=true
# MAD_REVIEWER_CHECK_NAME=mad-reviewer
```

- [ ] **Step 11: Build the docs to verify they compile**

Run: `npm run docs:build`
Expected: build succeeds with no dead-link errors (the new `/architecture/check-runs` link resolves).

- [ ] **Step 12: Commit**

```bash
git add docs README.md .env.example
git commit -m "docs: document the GitHub Check Run feature and Checks permission"
```

---

## Task 9: Final verification

- [ ] **Step 1: Full suite + types + build**

Run:
```bash
npm test && npm run typecheck && npm run build && npm run docs:build
```
Expected: all green.

- [ ] **Step 2: Sanity-check the new env wiring**

Run:
```bash
node --input-type=module -e "import('./dist/config.js').then(m=>{const c=m.loadConfig({GITHUB_APP_ID:'1',GITHUB_PRIVATE_KEY:'k',GITHUB_WEBHOOK_SECRET:'s'});console.log({checksEnabled:c.checksEnabled,checkName:c.checkName});})"
```
Expected: `{ checksEnabled: true, checkName: 'mad-reviewer' }`

- [ ] **Step 3: Manual end-to-end (optional, needs a live App with `Checks: write`)**

Follow the spec's verification: set the App permission to `Checks: Read & write`,
re-approve the install, push to a PR, and confirm a `mad-reviewer` check appears
(`in_progress` → `success`/`neutral`) plus the existing inline comments. Watch:
```bash
npm run dev 2>&1 | grep --line-buffered -E 'check_create|check_complete|check_error|job_done'
```

---

## Self-review notes (for the implementer)

- **Existing-test compatibility:** `runOne` becomes `Promise<RunSummary | void>`; the old worker tests are replaced in Task 6 to return a summary. `Queue.fail` gains a return value but existing callers/tests ignore it (Task 2 adds the assertion).
- **No circular imports:** `checks.ts` imports types from `runner.js`, `comments.js`, `queue/queue.js`; none import `checks.ts` except `worker.ts` and `index.ts`.
- **Fail-soft is total:** every check path in `createCheckReporter` is wrapped; the worker also guards on `checkId != null`, so a missing permission or API outage never fails a review.
- **Idempotency:** `startCheckRun` reuses via `listForRef(check_name)` — retries and restarts do not create duplicate checks; no schema migration.
```