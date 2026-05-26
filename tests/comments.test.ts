import { describe, it, expect, vi } from "vitest";
import {
  listActiveBotComments,
  resolveWithReply,
  postInlineFinding,
  type GitHubClient,
} from "../src/github/comments.js";
import { embedFingerprint } from "../src/fingerprint.js";

function clientWithThreads(threads: unknown): GitHubClient {
  return {
    graphql: vi.fn(async () => ({
      repository: { pullRequest: { reviewThreads: { nodes: threads, pageInfo: { hasNextPage: false, endCursor: null } } } },
    })),
    rest: {
      pulls: {
        createReviewComment: vi.fn(async () => ({})),
        createReplyForReviewComment: vi.fn(async () => ({})),
      },
      issues: { createComment: vi.fn(async () => ({})) },
    },
  } as unknown as GitHubClient;
}

describe("listActiveBotComments", () => {
  it("returns only non-resolved threads that contain a fingerprinted comment", async () => {
    const fpBody = embedFingerprint("bug", "aaaa000000000000");
    const client = clientWithThreads([
      { id: "T1", isResolved: false, comments: { nodes: [{ databaseId: 11, body: fpBody }] } },
      { id: "T2", isResolved: true, comments: { nodes: [{ databaseId: 22, body: embedFingerprint("x", "bbbb000000000000") }] } },
      { id: "T3", isResolved: false, comments: { nodes: [{ databaseId: 33, body: "human comment" }] } },
    ]);
    const result = await listActiveBotComments(client, "o", "r", 1);
    expect(result).toEqual([{ fp: "aaaa000000000000", commentId: 11, threadId: "T1" }]);
  });

  it("walks multiple pages and includes threads from every page", async () => {
    const page1 = {
      repository: { pullRequest: { reviewThreads: {
        nodes: [{ id: "T1", isResolved: false, comments: { nodes: [{ databaseId: 11, body: embedFingerprint("a", "aaaa000000000000") }] } }],
        pageInfo: { hasNextPage: true, endCursor: "C1" },
      } } },
    };
    const page2 = {
      repository: { pullRequest: { reviewThreads: {
        nodes: [{ id: "T2", isResolved: false, comments: { nodes: [{ databaseId: 22, body: embedFingerprint("b", "bbbb000000000000") }] } }],
        pageInfo: { hasNextPage: false, endCursor: null },
      } } },
    };
    const graphql = vi.fn()
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2);
    const client = {
      graphql,
      rest: {
        pulls: { createReviewComment: vi.fn(), createReplyForReviewComment: vi.fn() },
        issues: { createComment: vi.fn() },
      },
    } as unknown as GitHubClient;

    const result = await listActiveBotComments(client, "o", "r", 1);
    expect(result).toEqual([
      { fp: "aaaa000000000000", commentId: 11, threadId: "T1" },
      { fp: "bbbb000000000000", commentId: 22, threadId: "T2" },
    ]);
    expect(graphql).toHaveBeenCalledTimes(2);
    expect(graphql.mock.calls[1][1]).toMatchObject({ cursor: "C1" });
  });
});

describe("resolveWithReply", () => {
  it("posts a reply then resolves the thread", async () => {
    const client = clientWithThreads([]);
    await resolveWithReply(client, "o", "r", 1, { commentId: 11, threadId: "T1", commitSha: "abc1234" });
    expect(client.rest.pulls.createReplyForReviewComment).toHaveBeenCalledWith(
      expect.objectContaining({ owner: "o", repo: "r", pull_number: 1, comment_id: 11 }),
    );
    expect(client.graphql).toHaveBeenCalledWith(
      expect.stringContaining("resolveReviewThread"),
      { threadId: "T1" },
    );
    const replyOrder = (client.rest.pulls.createReplyForReviewComment as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    const resolveOrder = (client.graphql as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    expect(replyOrder).toBeLessThan(resolveOrder);
  });
});

describe("postInlineFinding", () => {
  it("creates a review comment with the fingerprint embedded", async () => {
    const client = clientWithThreads([]);
    const finding = { file: "src/a.ts", line: 7, category: "c", dedupeKey: "k", severity: "bug", title: "t", body: "b" } as const;
    await postInlineFinding(client, "o", "r", 1, "abc1234", finding, "ffff000000000000");
    expect(client.rest.pulls.createReviewComment).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "o", repo: "r", pull_number: 1, commit_id: "abc1234",
        path: "src/a.ts", line: 7, side: "RIGHT",
        body: expect.stringContaining("mad-reviewer:fp=ffff000000000000"),
      }),
    );
  });

  it("falls back to a file-level review comment on a 422 invalid anchor", async () => {
    const client = clientWithThreads([]);
    const err = Object.assign(new Error("Unprocessable"), { status: 422 });
    (client.rest.pulls.createReviewComment as ReturnType<typeof vi.fn>).mockRejectedValueOnce(err);
    const finding = { file: "src/a.ts", line: 7, category: "c", dedupeKey: "k", severity: "bug", title: "t", body: "b" } as const;
    await postInlineFinding(client, "o", "r", 1, "abc1234", finding, "ffff000000000000");
    expect(client.rest.pulls.createReviewComment).toHaveBeenCalledTimes(2);
    expect(client.rest.pulls.createReviewComment).toHaveBeenLastCalledWith(
      expect.objectContaining({
        owner: "o", repo: "r", pull_number: 1, commit_id: "abc1234",
        path: "src/a.ts", subject_type: "file",
        body: expect.stringContaining("mad-reviewer:fp=ffff000000000000"),
      }),
    );
  });

  it("propagates a non-422 error instead of falling back", async () => {
    const client = clientWithThreads([]);
    const err = Object.assign(new Error("rate limited"), { status: 429 });
    (client.rest.pulls.createReviewComment as ReturnType<typeof vi.fn>).mockRejectedValueOnce(err);
    const finding = { file: "src/a.ts", line: 7, category: "c", dedupeKey: "k", severity: "bug", title: "t", body: "b" } as const;
    await expect(
      postInlineFinding(client, "o", "r", 1, "abc1234", finding, "ffff000000000000"),
    ).rejects.toThrow("rate limited");
    expect(client.rest.pulls.createReviewComment).toHaveBeenCalledTimes(1);
  });
});
