import { describe, it, expect } from "vitest";
import { reconcile, type ActiveComment } from "../src/reconciler.js";
import type { Finding } from "../src/types.js";

function finding(over: Partial<Finding> = {}): Finding {
  return {
    file: "src/a.ts",
    line: 10,
    category: "null-safety",
    dedupeKey: "k",
    severity: "bug",
    title: "t",
    body: "b",
    ...over,
  };
}

describe("reconcile", () => {
  it("creates a comment for a new fingerprint", () => {
    const actions = reconcile(
      [{ finding: finding(), fp: "aaaa000000000000" }],
      [],
    );
    expect(actions).toEqual([
      { type: "create", finding: finding(), fp: "aaaa000000000000" },
    ]);
  });

  it("keeps a fingerprint that already has an active comment", () => {
    const active: ActiveComment[] = [
      { fp: "aaaa000000000000", commentId: 1, threadId: "T1" },
    ];
    const actions = reconcile(
      [{ finding: finding(), fp: "aaaa000000000000" }],
      active,
    );
    expect(actions).toEqual([
      { type: "keep", fp: "aaaa000000000000", commentId: 1 },
    ]);
  });

  it("resolves an active comment whose fingerprint is gone", () => {
    const active: ActiveComment[] = [
      { fp: "bbbb000000000000", commentId: 2, threadId: "T2" },
    ];
    const actions = reconcile([], active);
    expect(actions).toEqual([
      { type: "resolve", fp: "bbbb000000000000", threadId: "T2", commentId: 2 },
    ]);
  });

  it("creates (not keeps) when only a resolved comment exists (reappearance)", () => {
    const actions = reconcile(
      [{ finding: finding(), fp: "cccc000000000000" }],
      [],
    );
    expect(actions).toEqual([
      { type: "create", finding: finding(), fp: "cccc000000000000" },
    ]);
  });

  it("dedupes repeated fingerprints within a single run", () => {
    const actions = reconcile(
      [
        { finding: finding(), fp: "dddd000000000000" },
        { finding: finding({ title: "dup" }), fp: "dddd000000000000" },
      ],
      [],
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ type: "create", fp: "dddd000000000000" });
  });

  it("handles mixed create/keep/resolve together", () => {
    const active: ActiveComment[] = [
      { fp: "keep000000000000", commentId: 1, threadId: "T1" },
      { fp: "gone000000000000", commentId: 2, threadId: "T2" },
    ];
    const actions = reconcile(
      [
        { finding: finding(), fp: "keep000000000000" },
        { finding: finding(), fp: "new0000000000000" },
      ],
      active,
    );
    expect(actions).toContainEqual({ type: "keep", fp: "keep000000000000", commentId: 1 });
    expect(actions).toContainEqual({ type: "create", finding: finding(), fp: "new0000000000000" });
    expect(actions).toContainEqual({ type: "resolve", fp: "gone000000000000", threadId: "T2", commentId: 2 });
  });
});
