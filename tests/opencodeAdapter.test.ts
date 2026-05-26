import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { OpenCodeAdapter } from "../src/adapters/opencode.js";
import type { EffectiveSkills } from "../src/skills/loader.js";

let workspaceDir: string;

const skills: EffectiveSkills = {
  skills: [{ name: "null-safety", description: "", body: "x", raw: "---\n---\nrule-x" }],
};

const finding = {
  file: "src/a.ts", line: 5, category: "null-safety",
  dedupeKey: "k", severity: "bug", title: "t", body: "b",
};

function jsonlText(text: string): string {
  return JSON.stringify({ type: "text", part: { id: "p1", type: "text", text } });
}

beforeEach(async () => {
  workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-adapter-"));
});
afterEach(async () => {
  await fs.rm(workspaceDir, { recursive: true, force: true });
});

describe("OpenCodeAdapter", () => {
  it("writes the diff, attaches it, passes the model, and parses findings", async () => {
    let captured: { file: string; args: string[] } | undefined;
    const fakeRun = async (file: string, args: string[]) => {
      captured = { file, args };
      return { stdout: jsonlText(JSON.stringify([finding])), stderr: "", status: 0 };
    };
    const adapter = new OpenCodeAdapter({ timeoutMs: 1000, model: "anthropic/claude-sonnet-4", run: fakeRun });

    const result = await adapter.review({
      workspaceDir, changedFiles: ["src/a.ts"], diff: "DIFF-CONTENT", skills,
    });

    expect(result).toEqual([finding]);

    const diffPath = path.join(workspaceDir, ".mad-reviewer", "pr.diff");
    expect(await fs.readFile(diffPath, "utf8")).toBe("DIFF-CONTENT");

    expect(captured!.file).toBe("opencode");
    expect(captured!.args.slice(0, 4)).toEqual(["run", "--format", "json", "-f"]);
    expect(captured!.args).toContain(diffPath);
    expect(captured!.args).toContain("--model");
    expect(captured!.args).toContain("anthropic/claude-sonnet-4");
    // prompt is the last positional arg and carries the skill rules inline
    expect(captured!.args[captured!.args.length - 1]).toContain("rule-x");
  });

  it("omits --model when none is configured", async () => {
    let captured: string[] = [];
    const fakeRun = async (_file: string, args: string[]) => {
      captured = args;
      return { stdout: jsonlText(JSON.stringify([finding])), stderr: "", status: 0 };
    };
    const adapter = new OpenCodeAdapter({ timeoutMs: 1000, run: fakeRun });
    await adapter.review({ workspaceDir, changedFiles: [], diff: "", skills });
    expect(captured).not.toContain("--model");
  });

  it("throws when the CLI exits nonzero", async () => {
    const fakeRun = async () => ({ stdout: "", stderr: "boom", status: 1 });
    const adapter = new OpenCodeAdapter({ timeoutMs: 1000, run: fakeRun });
    await expect(
      adapter.review({ workspaceDir, changedFiles: [], diff: "", skills }),
    ).rejects.toThrow(/exited with status 1/);
  });

  it("throws when the assistant text has no findings JSON", async () => {
    const fakeRun = async () => ({ stdout: jsonlText("no json here"), stderr: "", status: 0 });
    const adapter = new OpenCodeAdapter({ timeoutMs: 1000, run: fakeRun });
    await expect(
      adapter.review({ workspaceDir, changedFiles: [], diff: "", skills }),
    ).rejects.toThrow();
  });

  it("rejects findings that violate the schema", async () => {
    const bad = [{ file: "a", line: 0, category: "c", dedupeKey: "k", severity: "bug", title: "t", body: "b" }];
    const fakeRun = async () => ({ stdout: jsonlText(JSON.stringify(bad)), stderr: "", status: 0 });
    const adapter = new OpenCodeAdapter({ timeoutMs: 1000, run: fakeRun });
    await expect(
      adapter.review({ workspaceDir, changedFiles: [], diff: "", skills }),
    ).rejects.toThrow();
  });

  it("injects the persona block into the prompt when soul is provided", async () => {
    let captured: string[] = [];
    const fakeRun = async (_file: string, args: string[]) => {
      captured = args;
      return { stdout: jsonlText("[]"), stderr: "", status: 0 };
    };
    const adapter = new OpenCodeAdapter({ timeoutMs: 1000, run: fakeRun });
    await adapter.review({ workspaceDir, changedFiles: [], diff: "", skills, soul: "BE SARCASTIC" });
    const prompt = captured[captured.length - 1];
    expect(prompt).toContain("## Persona");
    expect(prompt).toContain("BE SARCASTIC");
  });

  it("omits the persona block when no soul is provided", async () => {
    let captured: string[] = [];
    const fakeRun = async (_file: string, args: string[]) => {
      captured = args;
      return { stdout: jsonlText("[]"), stderr: "", status: 0 };
    };
    const adapter = new OpenCodeAdapter({ timeoutMs: 1000, run: fakeRun });
    await adapter.review({ workspaceDir, changedFiles: [], diff: "", skills });
    expect(captured[captured.length - 1]).not.toContain("## Persona");
  });
});
