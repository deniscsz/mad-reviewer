import { describe, it, expect, vi } from "vitest";
import { runReview, type RunnerDeps } from "../src/runner.js";
import type { Job } from "../src/types.js";
import { computeFingerprint } from "../src/fingerprint.js";

const job: Job = { owner: "o", repo: "r", pr: 1, headSha: "head1", baseSha: "base1", installationId: 5 };

function makeDeps(over: Partial<RunnerDeps> = {}): RunnerDeps {
  const finding = { file: "src/a.ts", line: 3, category: "null-safety", dedupeKey: "k", severity: "bug" as const, title: "t", body: "b" };
  return {
    getClient: vi.fn(async () => ({}) as any),
    getInstallationToken: vi.fn(async () => "tok"),
    clonePrHead: vi.fn(async () => ({ dir: "/tmp/x", cleanup: vi.fn(async () => {}) })),
    computeDiff: vi.fn(async () => ({ diff: "d", changedFiles: ["src/a.ts"] })),
    loadSkills: vi.fn(async () => ({ skills: [] })),
    loadSoul: vi.fn(async () => undefined),
    adapter: { name: "fake", review: vi.fn(async () => [finding]) },
    listActiveBotComments: vi.fn(async () => []),
    postInlineFinding: vi.fn(async () => {}),
    resolveWithReply: vi.fn(async () => {}),
    config: { defaultsDir: "/d", autoApplyDir: "/a", soulPath: "/s" },
    log: vi.fn(),
    ...over,
  };
}

describe("runReview", () => {
  it("posts an inline comment for a new finding and cleans up", async () => {
    const cleanup = vi.fn(async () => {});
    const deps = makeDeps({ clonePrHead: vi.fn(async () => ({ dir: "/tmp/x", cleanup })) });
    const summary = await runReview(job, deps);
    expect(deps.postInlineFinding).toHaveBeenCalledTimes(1);
    expect(deps.postInlineFinding).toHaveBeenCalledWith(
      expect.anything(), "o", "r", 1, "head1", expect.anything(), expect.anything(),
    );
    expect(deps.resolveWithReply).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalled();
    expect(summary).toMatchObject({ created: 1, resolved: 0, kept: 0 });
  });

  it("keeps a finding that already has an active comment (no post, no resolve)", async () => {
    const fp = computeFingerprint({ file: "src/a.ts", category: "null-safety", dedupeKey: "k" });
    const deps = makeDeps({
      listActiveBotComments: vi.fn(async () => [{ fp, commentId: 7, threadId: "T7" }]),
    });
    const summary = await runReview(job, deps);
    expect(deps.postInlineFinding).not.toHaveBeenCalled();
    expect(deps.resolveWithReply).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ created: 0, kept: 1, resolved: 0 });
  });

  it("resolves an active comment whose finding disappeared", async () => {
    const fp = computeFingerprint({ file: "src/old.ts", category: "c", dedupeKey: "gone" });
    const deps = makeDeps({
      adapter: { name: "fake", review: vi.fn(async () => []) },
      listActiveBotComments: vi.fn(async () => [{ fp, commentId: 9, threadId: "T9" }]),
    });
    const summary = await runReview(job, deps);
    expect(deps.resolveWithReply).toHaveBeenCalledWith(
      expect.anything(), "o", "r", 1,
      expect.objectContaining({ commentId: 9, threadId: "T9", commitSha: "head1" }),
    );
    expect(summary).toMatchObject({ created: 0, resolved: 1 });
  });

  it("passes the loaded soul through to the adapter", async () => {
    const review = vi.fn(async () => []);
    const deps = makeDeps({
      loadSoul: vi.fn(async () => "SOUL!"),
      adapter: { name: "fake", review },
    });
    await runReview(job, deps);
    expect(review).toHaveBeenCalledWith(expect.objectContaining({ soul: "SOUL!" }));
  });

  it("cleans up the workspace even if the adapter throws", async () => {
    const cleanup = vi.fn(async () => {});
    const deps = makeDeps({
      clonePrHead: vi.fn(async () => ({ dir: "/tmp/x", cleanup })),
      adapter: { name: "fake", review: vi.fn(async () => { throw new Error("boom"); }) },
    });
    await expect(runReview(job, deps)).rejects.toThrow("boom");
    expect(cleanup).toHaveBeenCalled();
    expect(deps.postInlineFinding).not.toHaveBeenCalled();
    expect(deps.log).not.toHaveBeenCalled();
  });
});
