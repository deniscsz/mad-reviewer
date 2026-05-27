import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { OpenCodeAdapter } from "../src/adapters/opencode.js";
import type { EffectiveSkills } from "../src/skills/loader.js";

let workspaceDir: string;

const CONFIG = "/trusted/opencode.json";

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
  it("writes the diff, attaches it, passes the agent/model/env, and parses findings", async () => {
    let captured: { file: string; args: string[]; env?: NodeJS.ProcessEnv } | undefined;
    const fakeRun = async (file: string, args: string[], opts: { env?: NodeJS.ProcessEnv }) => {
      captured = { file, args, env: opts.env };
      return { stdout: jsonlText(JSON.stringify([finding])), stderr: "", status: 0 };
    };
    const adapter = new OpenCodeAdapter({ timeoutMs: 1000, configPath: CONFIG, model: "anthropic/claude-sonnet-4", run: fakeRun });

    const result = await adapter.review({
      workspaceDir, changedFiles: ["src/a.ts"], diff: "DIFF-CONTENT", skills,
    });

    expect(result).toEqual([finding]);

    const diffPath = path.join(workspaceDir, ".mad-reviewer", "pr.diff");
    expect(await fs.readFile(diffPath, "utf8")).toBe("DIFF-CONTENT");

    expect(captured!.file).toBe("opencode");
    expect(captured!.args.slice(0, 3)).toEqual(["run", "--format", "json"]);
    expect(captured!.args).toContain("--agent");
    expect(captured!.args).toContain("review");
    expect(captured!.args).toContain("-f");
    expect(captured!.args).toContain(diffPath);
    expect(captured!.args).toContain("--model");
    expect(captured!.args).toContain("anthropic/claude-sonnet-4");
    // prompt is the last positional arg and carries the skill rules inline
    expect(captured!.args[captured!.args.length - 1]).toContain("rule-x");
    // hardening env blocks untrusted repo config and points to the trusted agent config
    expect(captured!.env?.OPENCODE_DISABLE_PROJECT_CONFIG).toBe("true");
    expect(captured!.env?.OPENCODE_CONFIG).toBe(CONFIG);
  });

  it("omits --model when none is configured", async () => {
    let captured: string[] = [];
    const fakeRun = async (_file: string, args: string[]) => {
      captured = args;
      return { stdout: jsonlText(JSON.stringify([finding])), stderr: "", status: 0 };
    };
    const adapter = new OpenCodeAdapter({ timeoutMs: 1000, configPath: CONFIG,run: fakeRun });
    await adapter.review({ workspaceDir, changedFiles: [], diff: "", skills });
    expect(captured).not.toContain("--model");
  });

  it("throws when the CLI exits nonzero", async () => {
    const fakeRun = async () => ({ stdout: "", stderr: "boom", status: 1 });
    const adapter = new OpenCodeAdapter({ timeoutMs: 1000, configPath: CONFIG,run: fakeRun });
    await expect(
      adapter.review({ workspaceDir, changedFiles: [], diff: "", skills }),
    ).rejects.toThrow(/exited with status 1/);
  });

  it("throws when the assistant text has no findings JSON", async () => {
    const fakeRun = async () => ({ stdout: jsonlText("no json here"), stderr: "", status: 0 });
    const adapter = new OpenCodeAdapter({ timeoutMs: 1000, configPath: CONFIG,run: fakeRun });
    await expect(
      adapter.review({ workspaceDir, changedFiles: [], diff: "", skills }),
    ).rejects.toThrow();
  });

  it("rejects findings that violate the schema", async () => {
    const bad = [{ file: "a", line: 0, category: "c", dedupeKey: "k", severity: "bug", title: "t", body: "b" }];
    const fakeRun = async () => ({ stdout: jsonlText(JSON.stringify(bad)), stderr: "", status: 0 });
    const adapter = new OpenCodeAdapter({ timeoutMs: 1000, configPath: CONFIG,run: fakeRun });
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
    const adapter = new OpenCodeAdapter({ timeoutMs: 1000, configPath: CONFIG,run: fakeRun });
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
    const adapter = new OpenCodeAdapter({ timeoutMs: 1000, configPath: CONFIG,run: fakeRun });
    await adapter.review({ workspaceDir, changedFiles: [], diff: "", skills });
    expect(captured[captured.length - 1]).not.toContain("## Persona");
  });

  it("disables external skills via env and drops the prompt line when loadRepoSkills is false", async () => {
    let captured: { args: string[]; env?: NodeJS.ProcessEnv } | undefined;
    const fakeRun = async (_file: string, args: string[], opts: { env?: NodeJS.ProcessEnv }) => {
      captured = { args, env: opts.env };
      return { stdout: jsonlText("[]"), stderr: "", status: 0 };
    };
    const adapter = new OpenCodeAdapter({ timeoutMs: 1000, configPath: CONFIG, run: fakeRun });
    await adapter.review({ workspaceDir, changedFiles: [], diff: "", skills, loadRepoSkills: false });
    expect(captured!.env?.OPENCODE_DISABLE_EXTERNAL_SKILLS).toBe("true");
    expect(captured!.args[captured!.args.length - 1]).not.toContain("project skills");
  });
});
