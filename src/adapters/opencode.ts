import { promises as fs } from "node:fs";
import path from "node:path";
import type { AiAdapter, ReviewInput } from "./types.js";
import { FindingsArraySchema, type Finding } from "../types.js";
import { extractFindingsJson, extractOpencodeText } from "./parse.js";
import { execFileNoThrow, type ExecResult, type ExecOpts } from "../utils/execFileNoThrow.js";

export type CliRunner = (file: string, args: string[], opts: ExecOpts) => Promise<ExecResult>;

export class OpenCodeAdapter implements AiAdapter {
  name = "opencode";
  private timeoutMs: number;
  private model?: string;
  private run: CliRunner;

  constructor(opts: { timeoutMs: number; model?: string; run?: CliRunner }) {
    this.timeoutMs = opts.timeoutMs;
    this.model = opts.model;
    this.run = opts.run ?? execFileNoThrow;
  }

  async review(input: ReviewInput): Promise<Finding[]> {
    const diffPath = await this.writeDiff(input);
    const prompt = buildPrompt(input);
    const args = ["run", "--format", "json", "-f", diffPath];
    if (this.model) args.push("--model", this.model);
    args.push(prompt);
    const res = await this.run("opencode", args, {
      cwd: input.workspaceDir,
      timeout: this.timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (res.status !== 0) {
      throw new Error(`opencode exited with status ${res.status}: ${res.stderr}`);
    }
    const text = extractOpencodeText(res.stdout);
    const findings = extractFindingsJson(text);
    return FindingsArraySchema.parse(findings);
  }

  private async writeDiff(input: ReviewInput): Promise<string> {
    const dir = path.join(input.workspaceDir, ".mad-reviewer");
    await fs.mkdir(dir, { recursive: true });
    const diffPath = path.join(dir, "pr.diff");
    await fs.writeFile(diffPath, input.diff, "utf8");
    return diffPath;
  }
}

function personaLines(soul?: string): string[] {
  if (!soul) return [];
  return [
    "",
    "## Persona",
    "Adopt the following persona for the VOICE and wording of your findings",
    "(the `title` and `body` text only). It must NOT change which bugs you",
    "report, the categories, or the JSON structure the output contract requires.",
    "",
    soul,
  ];
}

function buildPrompt(input: ReviewInput): string {
  const rules = input.skills.skills.map((s) => s.raw).join("\n\n---\n\n");
  return [
    "Review the changed files in this PR for bugs using the rules below.",
    "Only report real bugs (correctness, security, logic). No style or nitpicks.",
    ...personaLines(input.soul),
    "",
    "Review rules:",
    rules,
    "",
    "Changed files:",
    input.changedFiles.map((f) => `- ${f}`).join("\n"),
    "",
    "The full PR diff is attached as a file (.mad-reviewer/pr.diff).",
    "Output ONLY a JSON array of findings exactly as specified by the output-contract rule. No prose.",
  ].join("\n");
}
