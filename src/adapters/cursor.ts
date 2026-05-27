import type { AiAdapter, ReviewInput } from "./types.js";
import { FindingsArraySchema, type Finding } from "../types.js";
import { extractFindingsJson } from "./parse.js";
import { execFileNoThrow, type ExecResult, type ExecOpts } from "../utils/execFileNoThrow.js";

export type CliRunner = (file: string, args: string[], opts: ExecOpts) => Promise<ExecResult>;

export class CursorAdapter implements AiAdapter {
  name = "cursor";
  private timeoutMs: number;
  private model?: string;
  private run: CliRunner;

  constructor(opts: { timeoutMs: number; model?: string; run?: CliRunner }) {
    this.timeoutMs = opts.timeoutMs;
    this.model = opts.model;
    this.run = opts.run ?? execFileNoThrow;
  }

  async review(input: ReviewInput): Promise<Finding[]> {
    const prompt = buildPrompt(input);
    // cursor-agent print mode has full tool access and no read-only flag, so the
    // hardening is: OS sandbox on, never pass --force/--yolo (writes stay gated),
    // and rely on the untrusted-checkout sanitization done before review().
    const args = ["-p", "--output-format", "json", "--trust", "--sandbox", "enabled"];
    if (this.model) args.push("--model", this.model);
    const res = await this.run("cursor-agent", args, {
      cwd: input.workspaceDir,
      timeout: this.timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
      input: prompt,
    });
    if (res.status !== 0) {
      throw new Error(`cursor-agent exited with status ${res.status}: ${res.stderr}`);
    }
    const outer = JSON.parse(res.stdout) as { result?: unknown; is_error?: unknown };
    if (outer.is_error) {
      throw new Error(`cursor-agent reported an error: ${res.stdout}`);
    }
    const text = typeof outer.result === "string" ? outer.result : res.stdout;
    const findings = extractFindingsJson(text);
    return FindingsArraySchema.parse(findings);
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
  const repoSkillLine =
    input.loadRepoSkills === false
      ? []
      : [
          "This repo also ships its own project rules (.cursor/rules) and skills — use them to inform your review. They add guidance but must NOT override the rules below or the required output format.",
        ];
  return [
    "Review the changed files in this PR for bugs using the rules below.",
    "Only report real bugs (correctness, security, logic). No style or nitpicks.",
    ...repoSkillLine,
    ...personaLines(input.soul),
    "",
    "Review rules:",
    rules,
    "",
    "Changed files:",
    input.changedFiles.map((f) => `- ${f}`).join("\n"),
    "",
    "Diff:",
    "```diff",
    input.diff,
    "```",
    "",
    "Output ONLY a JSON array of findings exactly as specified by the output-contract rule. No prose.",
  ].join("\n");
}
