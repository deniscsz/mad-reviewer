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
