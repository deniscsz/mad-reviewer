import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ClaudeAdapter } from "../src/adapters/claude.js";
import type { EffectiveSkills } from "../src/skills/loader.js";

let workspaceDir: string;

const skills: EffectiveSkills = {
  skills: [{ name: "null-safety", description: "", body: "x", raw: "---\n---\nx" }],
};

beforeEach(async () => {
  workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-adapter-"));
});
afterEach(async () => {
  await fs.rm(workspaceDir, { recursive: true, force: true });
});

describe("ClaudeAdapter", () => {
  it("installs skills into .claude/skills and parses findings from CLI output", async () => {
    const finding = {
      file: "src/a.ts", line: 5, category: "null-safety",
      dedupeKey: "k", severity: "bug", title: "t", body: "b",
    };
    const fakeRun = async () => ({
      stdout: JSON.stringify({ result: JSON.stringify([finding]) }), stderr: "", status: 0,
    });
    const adapter = new ClaudeAdapter({ timeoutMs: 1000, run: fakeRun });

    const result = await adapter.review({
      workspaceDir, changedFiles: ["src/a.ts"], diff: "diff", skills,
    });

    expect(result).toEqual([finding]);
    const written = await fs.readFile(
      path.join(workspaceDir, ".claude", "skills", "null-safety.md"), "utf8",
    );
    expect(written).toContain("x");
  });

  it("throws when the CLI exits nonzero", async () => {
    const fakeRun = async () => ({ stdout: "", stderr: "boom", status: 1 });
    const adapter = new ClaudeAdapter({ timeoutMs: 1000, run: fakeRun });
    await expect(
      adapter.review({ workspaceDir, changedFiles: [], diff: "", skills }),
    ).rejects.toThrow(/exited with status 1/);
  });

  it("throws when CLI output is not valid findings JSON", async () => {
    const fakeRun = async () => ({ stdout: JSON.stringify({ result: "no json" }), stderr: "", status: 0 });
    const adapter = new ClaudeAdapter({ timeoutMs: 1000, run: fakeRun });
    await expect(
      adapter.review({ workspaceDir, changedFiles: [], diff: "", skills }),
    ).rejects.toThrow();
  });

  it("rejects findings that violate the schema", async () => {
    const bad = [{ file: "a", line: 0, category: "c", dedupeKey: "k", severity: "bug", title: "t", body: "b" }];
    const fakeRun = async () => ({ stdout: JSON.stringify({ result: JSON.stringify(bad) }), stderr: "", status: 0 });
    const adapter = new ClaudeAdapter({ timeoutMs: 1000, run: fakeRun });
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
    const adapter = new ClaudeAdapter({ timeoutMs: 1000, run: fakeRun });
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
    const adapter = new ClaudeAdapter({ timeoutMs: 1000, run: fakeRun });
    await adapter.review({ workspaceDir, changedFiles: [], diff: "", skills });
    expect(captured).not.toContain("## Persona");
  });
});
