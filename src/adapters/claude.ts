import { promises as fs } from "node:fs";
import path from "node:path";
import type { AiAdapter, ReviewInput } from "./types.js";
import { FindingsArraySchema, type Finding } from "../types.js";
import { extractFindingsJson } from "./parse.js";
import { execFileNoThrow, type ExecResult, type ExecOpts } from "../utils/execFileNoThrow.js";

export type CliRunner = (file: string, args: string[], opts: ExecOpts) => Promise<ExecResult>;

export class ClaudeAdapter implements AiAdapter {
  name = "claude";
  private timeoutMs: number;
  private run: CliRunner;

  constructor(opts: { timeoutMs: number; run?: CliRunner }) {
    this.timeoutMs = opts.timeoutMs;
    this.run = opts.run ?? execFileNoThrow;
  }

  async review(input: ReviewInput): Promise<Finding[]> {
    await this.installSkills(input);
    const prompt = buildPrompt(input);
    const res = await this.run("claude", ["-p", "--output-format", "json"], {
      cwd: input.workspaceDir,
      timeout: this.timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
      input: prompt,
    });
    if (res.status !== 0) {
      throw new Error(`claude exited with status ${res.status}: ${res.stderr}`);
    }
    const outer = JSON.parse(res.stdout) as { result?: unknown };
    const text = typeof outer.result === "string" ? outer.result : res.stdout;
    const findings = extractFindingsJson(text);
    return FindingsArraySchema.parse(findings);
  }

  private async installSkills(input: ReviewInput): Promise<void> {
    const dir = path.join(input.workspaceDir, ".claude", "skills");
    await fs.mkdir(dir, { recursive: true });
    for (const s of input.skills.skills) {
      await fs.writeFile(path.join(dir, `${s.name}.md`), s.raw, "utf8");
    }
  }
}

function buildPrompt(input: ReviewInput): string {
  return [
    "Review the changed files in this PR for bugs using the skills loaded in .claude/skills.",
    "Only report real bugs (correctness, security, logic). No style or nitpicks.",
    "Changed files:",
    input.changedFiles.map((f) => `- ${f}`).join("\n"),
    "",
    "Diff:",
    "```diff",
    input.diff,
    "```",
    "",
    "Output ONLY a JSON array of findings exactly as specified by the output-contract skill. No prose.",
  ].join("\n");
}
