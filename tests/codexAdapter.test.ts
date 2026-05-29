import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CodexAdapter } from "../src/adapters/codex.js";
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
  workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-adapter-"));
});
afterEach(async () => {
  await fs.rm(workspaceDir, { recursive: true, force: true });
});

describe("CodexAdapter", () => {
  it("passes hardened flags, pipes the prompt on stdin, and parses findings", async () => {
    let capturedArgs: string[] = [];
    let capturedInput = "";
    const fakeRun = async (_f: string, args: string[], opts: { input?: string }) => {
      capturedArgs = args;
      capturedInput = opts.input ?? "";
      return { stdout: JSON.stringify([finding]), stderr: "", status: 0 };
    };
    const adapter = new CodexAdapter({ timeoutMs: 1000, run: fakeRun });

    const result = await adapter.review({
      workspaceDir, changedFiles: ["src/a.ts"], diff: "DIFF", skills,
    });

    expect(result).toEqual([finding]);
    expect(capturedArgs).toEqual(["exec", "--sandbox", "read-only", "-c", "approval_policy=never", "-"]);
    // never let the agent write or run commands on untrusted PR code
    expect(capturedArgs).not.toContain("--full-auto");
    expect(capturedArgs).not.toContain("workspace-write");
    expect(capturedArgs).not.toContain("danger-full-access");
    expect(capturedArgs).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    // curated skill body + diff are inlined into the stdin prompt
    expect(capturedInput).toContain("x");
    expect(capturedInput).toContain("DIFF");
  });

  it("appends --model when a model is configured", async () => {
    let capturedArgs: string[] = [];
    const fakeRun = async (_f: string, args: string[]) => {
      capturedArgs = args;
      return { stdout: "[]", stderr: "", status: 0 };
    };
    const adapter = new CodexAdapter({ timeoutMs: 1000, model: "gpt-5-codex", run: fakeRun });
    await adapter.review({ workspaceDir, changedFiles: [], diff: "", skills });
    expect(capturedArgs).toContain("--model");
    expect(capturedArgs).toContain("gpt-5-codex");
  });

  it("omits --model when none is configured", async () => {
    let capturedArgs: string[] = [];
    const fakeRun = async (_f: string, args: string[]) => {
      capturedArgs = args;
      return { stdout: "[]", stderr: "", status: 0 };
    };
    const adapter = new CodexAdapter({ timeoutMs: 1000, run: fakeRun });
    await adapter.review({ workspaceDir, changedFiles: [], diff: "", skills });
    expect(capturedArgs).not.toContain("--model");
  });

  it("throws when the CLI exits nonzero", async () => {
    const fakeRun = async () => ({ stdout: "", stderr: "boom", status: 1 });
    const adapter = new CodexAdapter({ timeoutMs: 1000, run: fakeRun });
    await expect(
      adapter.review({ workspaceDir, changedFiles: [], diff: "", skills }),
    ).rejects.toThrow(/exited with status 1/);
  });

  it("throws when CLI output is not valid findings JSON", async () => {
    const fakeRun = async () => ({ stdout: "no json here", stderr: "", status: 0 });
    const adapter = new CodexAdapter({ timeoutMs: 1000, run: fakeRun });
    await expect(
      adapter.review({ workspaceDir, changedFiles: [], diff: "", skills }),
    ).rejects.toThrow();
  });

  it("rejects findings that violate the schema", async () => {
    const bad = [{ file: "a", line: 0, category: "c", dedupeKey: "k", severity: "bug", title: "t", body: "b" }];
    const fakeRun = async () => ({ stdout: JSON.stringify(bad), stderr: "", status: 0 });
    const adapter = new CodexAdapter({ timeoutMs: 1000, run: fakeRun });
    await expect(
      adapter.review({ workspaceDir, changedFiles: [], diff: "", skills }),
    ).rejects.toThrow();
  });

  it("injects the persona block into the prompt when soul is provided", async () => {
    let captured = "";
    const fakeRun = async (_f: string, _a: string[], opts: { input?: string }) => {
      captured = opts.input ?? "";
      return { stdout: "[]", stderr: "", status: 0 };
    };
    const adapter = new CodexAdapter({ timeoutMs: 1000, run: fakeRun });
    await adapter.review({ workspaceDir, changedFiles: [], diff: "", skills, soul: "BE SARCASTIC" });
    expect(captured).toContain("## Persona");
    expect(captured).toContain("BE SARCASTIC");
  });

  it("omits the persona block when no soul is provided", async () => {
    let captured = "";
    const fakeRun = async (_f: string, _a: string[], opts: { input?: string }) => {
      captured = opts.input ?? "";
      return { stdout: "[]", stderr: "", status: 0 };
    };
    const adapter = new CodexAdapter({ timeoutMs: 1000, run: fakeRun });
    await adapter.review({ workspaceDir, changedFiles: [], diff: "", skills });
    expect(captured).not.toContain("## Persona");
  });

  it("invites repo project guidance by default but omits the line when disabled", async () => {
    let captured = "";
    const fakeRun = async (_f: string, _a: string[], opts: { input?: string }) => {
      captured = opts.input ?? "";
      return { stdout: "[]", stderr: "", status: 0 };
    };
    const adapter = new CodexAdapter({ timeoutMs: 1000, run: fakeRun });

    await adapter.review({ workspaceDir, changedFiles: [], diff: "", skills });
    expect(captured).toContain("AGENTS.md");

    await adapter.review({ workspaceDir, changedFiles: [], diff: "", skills, loadRepoSkills: false });
    expect(captured).not.toContain("AGENTS.md");
  });

  it("emits ai_request and ai_response when debug=true", async () => {
    const events: Record<string, unknown>[] = [];
    const fakeRun = async () => ({ stdout: "[]", stderr: "warn x", status: 0 });
    const adapter = new CodexAdapter({ timeoutMs: 1000, run: fakeRun });
    await adapter.review({
      workspaceDir, changedFiles: ["a.ts"], diff: "DIFF", skills,
      debug: true, log: (e) => events.push(e),
    });
    const req = events.find((e) => e.event === "ai_request");
    const resp = events.find((e) => e.event === "ai_response");
    expect(req).toBeDefined();
    expect(req).toMatchObject({ adapter: "codex", workspaceDir });
    expect(typeof req?.prompt).toBe("string");
    expect((req?.prompt as string)).toContain("DIFF");
    expect(resp).toBeDefined();
    expect(resp).toMatchObject({ adapter: "codex", status: 0, stderr: "warn x" });
  });

  it("emits no log events when debug is unset (default)", async () => {
    const events: Record<string, unknown>[] = [];
    const fakeRun = async () => ({ stdout: "[]", stderr: "", status: 0 });
    const adapter = new CodexAdapter({ timeoutMs: 1000, run: fakeRun });
    await adapter.review({
      workspaceDir, changedFiles: [], diff: "", skills,
      log: (e) => events.push(e),
    });
    expect(events).toHaveLength(0);
  });
});
