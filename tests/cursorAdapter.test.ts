import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CursorAdapter } from "../src/adapters/cursor.js";
import type { EffectiveSkills } from "../src/skills/loader.js";

let workspaceDir: string;

const skills: EffectiveSkills = {
  skills: [{ name: "null-safety", description: "", body: "x", raw: "---\n---\nx" }],
};

const finding = {
  file: "src/a.ts", line: 5, category: "null-safety",
  dedupeKey: "k", severity: "bug", title: "t", body: "b",
};

beforeEach(async () => {
  workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "cursor-adapter-"));
});
afterEach(async () => {
  await fs.rm(workspaceDir, { recursive: true, force: true });
});

describe("CursorAdapter", () => {
  it("passes hardened flags, pipes the prompt on stdin, and parses findings", async () => {
    let capturedArgs: string[] = [];
    let capturedInput = "";
    const fakeRun = async (_f: string, args: string[], opts: { input?: string }) => {
      capturedArgs = args;
      capturedInput = opts.input ?? "";
      return { stdout: JSON.stringify({ result: JSON.stringify([finding]) }), stderr: "", status: 0 };
    };
    const adapter = new CursorAdapter({ timeoutMs: 1000, run: fakeRun });

    const result = await adapter.review({
      workspaceDir, changedFiles: ["src/a.ts"], diff: "DIFF", skills,
    });

    expect(result).toEqual([finding]);
    expect(capturedArgs).toEqual(["-p", "--output-format", "json", "--trust", "--sandbox", "enabled"]);
    // never auto-approve writes/shell on untrusted code
    expect(capturedArgs).not.toContain("--force");
    expect(capturedArgs).not.toContain("-f");
    expect(capturedArgs).not.toContain("--yolo");
    // curated skill body + diff are inlined into the stdin prompt
    expect(capturedInput).toContain("x");
    expect(capturedInput).toContain("DIFF");
  });

  it("appends --model when a model is configured", async () => {
    let capturedArgs: string[] = [];
    const fakeRun = async (_f: string, args: string[]) => {
      capturedArgs = args;
      return { stdout: JSON.stringify({ result: "[]" }), stderr: "", status: 0 };
    };
    const adapter = new CursorAdapter({ timeoutMs: 1000, model: "sonnet-4", run: fakeRun });
    await adapter.review({ workspaceDir, changedFiles: [], diff: "", skills });
    expect(capturedArgs).toContain("--model");
    expect(capturedArgs).toContain("sonnet-4");
  });

  it("omits --model when none is configured", async () => {
    let capturedArgs: string[] = [];
    const fakeRun = async (_f: string, args: string[]) => {
      capturedArgs = args;
      return { stdout: JSON.stringify({ result: "[]" }), stderr: "", status: 0 };
    };
    const adapter = new CursorAdapter({ timeoutMs: 1000, run: fakeRun });
    await adapter.review({ workspaceDir, changedFiles: [], diff: "", skills });
    expect(capturedArgs).not.toContain("--model");
  });

  it("throws when the CLI exits nonzero", async () => {
    const fakeRun = async () => ({ stdout: "", stderr: "boom", status: 1 });
    const adapter = new CursorAdapter({ timeoutMs: 1000, run: fakeRun });
    await expect(
      adapter.review({ workspaceDir, changedFiles: [], diff: "", skills }),
    ).rejects.toThrow(/exited with status 1/);
  });

  it("throws when the result envelope is flagged is_error", async () => {
    const fakeRun = async () => ({
      stdout: JSON.stringify({ is_error: true, result: "rate limited" }), stderr: "", status: 0,
    });
    const adapter = new CursorAdapter({ timeoutMs: 1000, run: fakeRun });
    await expect(
      adapter.review({ workspaceDir, changedFiles: [], diff: "", skills }),
    ).rejects.toThrow(/reported an error/);
  });

  it("throws when CLI output is not valid findings JSON", async () => {
    const fakeRun = async () => ({ stdout: JSON.stringify({ result: "no json" }), stderr: "", status: 0 });
    const adapter = new CursorAdapter({ timeoutMs: 1000, run: fakeRun });
    await expect(
      adapter.review({ workspaceDir, changedFiles: [], diff: "", skills }),
    ).rejects.toThrow();
  });

  it("rejects findings that violate the schema", async () => {
    const bad = [{ file: "a", line: 0, category: "c", dedupeKey: "k", severity: "bug", title: "t", body: "b" }];
    const fakeRun = async () => ({ stdout: JSON.stringify({ result: JSON.stringify(bad) }), stderr: "", status: 0 });
    const adapter = new CursorAdapter({ timeoutMs: 1000, run: fakeRun });
    await expect(
      adapter.review({ workspaceDir, changedFiles: [], diff: "", skills }),
    ).rejects.toThrow();
  });

  it("injects the persona block into the prompt when soul is provided", async () => {
    let captured = "";
    const fakeRun = async (_f: string, _a: string[], opts: { input?: string }) => {
      captured = opts.input ?? "";
      return { stdout: JSON.stringify({ result: "[]" }), stderr: "", status: 0 };
    };
    const adapter = new CursorAdapter({ timeoutMs: 1000, run: fakeRun });
    await adapter.review({ workspaceDir, changedFiles: [], diff: "", skills, soul: "BE SARCASTIC" });
    expect(captured).toContain("## Persona");
    expect(captured).toContain("BE SARCASTIC");
  });

  it("omits the persona block when no soul is provided", async () => {
    let captured = "";
    const fakeRun = async (_f: string, _a: string[], opts: { input?: string }) => {
      captured = opts.input ?? "";
      return { stdout: JSON.stringify({ result: "[]" }), stderr: "", status: 0 };
    };
    const adapter = new CursorAdapter({ timeoutMs: 1000, run: fakeRun });
    await adapter.review({ workspaceDir, changedFiles: [], diff: "", skills });
    expect(captured).not.toContain("## Persona");
  });

  it("invites repo project rules by default but omits the line when disabled", async () => {
    let captured = "";
    const fakeRun = async (_f: string, _a: string[], opts: { input?: string }) => {
      captured = opts.input ?? "";
      return { stdout: JSON.stringify({ result: "[]" }), stderr: "", status: 0 };
    };
    const adapter = new CursorAdapter({ timeoutMs: 1000, run: fakeRun });

    await adapter.review({ workspaceDir, changedFiles: [], diff: "", skills });
    expect(captured).toContain(".cursor/rules");

    await adapter.review({ workspaceDir, changedFiles: [], diff: "", skills, loadRepoSkills: false });
    expect(captured).not.toContain(".cursor/rules");
  });

  it("emits ai_request and ai_response when debug=true", async () => {
    const events: Record<string, unknown>[] = [];
    const fakeRun = async () => ({ stdout: JSON.stringify({ result: "[]" }), stderr: "warn x", status: 0 });
    const adapter = new CursorAdapter({ timeoutMs: 1000, run: fakeRun });
    await adapter.review({
      workspaceDir, changedFiles: ["a.ts"], diff: "DIFF", skills,
      debug: true, log: (e) => events.push(e),
    });
    const req = events.find((e) => e.event === "ai_request");
    const resp = events.find((e) => e.event === "ai_response");
    expect(req).toBeDefined();
    expect(req).toMatchObject({ adapter: "cursor", workspaceDir });
    expect(typeof req?.prompt).toBe("string");
    expect((req?.prompt as string)).toContain("DIFF");
    expect(resp).toBeDefined();
    expect(resp).toMatchObject({ adapter: "cursor", status: 0, stderr: "warn x" });
  });

  it("emits no log events when debug is unset (default)", async () => {
    const events: Record<string, unknown>[] = [];
    const fakeRun = async () => ({ stdout: JSON.stringify({ result: "[]" }), stderr: "", status: 0 });
    const adapter = new CursorAdapter({ timeoutMs: 1000, run: fakeRun });
    await adapter.review({
      workspaceDir, changedFiles: [], diff: "", skills,
      log: (e) => events.push(e),
    });
    expect(events).toHaveLength(0);
  });
});
