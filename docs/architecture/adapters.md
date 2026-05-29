# AI Adapters

The AI tool that performs the actual review sits behind a small interface, so it
can be swapped via configuration. The default implementation drives the
headless `claude` CLI.

## The interface

```ts
interface ReviewInput {
  workspaceDir: string;     // the cloned PR checkout
  changedFiles: string[];   // diff focus
  diff: string;
  skills: EffectiveSkills;  // merged 3-tier skills
  soul?: string;            // optional persona text (SOUL.md)
  loadRepoSkills?: boolean; // also load the repo's own native skills (default true)
}

interface AiAdapter {
  name: string;
  review(input: ReviewInput): Promise<Finding[]>;
}
```

`createAdapter(name, opts)` is a factory keyed on `MAD_REVIEWER_ADAPTER`.
`claude`, `opencode`, and `cursor` are built in; unknown names throw.

## The Claude adapter

`ClaudeAdapter.review()`:

1. Builds a prompt that **inlines the curated skills** (the merged 3-tier set) as
   the authoritative review rules, plus changed files, diff, and the instruction
   to emit the `output-contract` JSON. The curated rules are inlined — not written
   to `.claude/skills/` — so the output contract is always present and the repo's
   own `.claude/skills/` dir is left untouched.
2. Runs `claude -p --output-format json --permission-mode dontAsk
   --allowedTools "Read,Glob,Grep,Skill"` in the workspace via the safe subprocess
   wrapper. `dontAsk` makes the headless run CI-safe (unlisted tools are denied,
   never prompted); the allowlist lets the model read files and invoke the repo's
   **native** project skills (`.claude/skills/<name>/SKILL.md`) but **not** run
   `Bash`/`Edit`/`Write`.
3. Validates: a non-zero exit throws; the result is parsed and checked against
   the `Finding[]` zod schema. **Malformed output throws** — the run fails
   cleanly and nothing is posted.

### Prompt via stdin

The prompt embeds the full PR diff, which can be large. Passing it as a CLI
argument risks hitting the OS `ARG_MAX` limit (`E2BIG`). Instead the prompt is
piped to the CLI's **stdin** (`claude -p` reads from stdin when no prompt
argument is given). The subprocess wrapper supports stdin input, enforces
`maxBuffer` on the captured output, and reports a distinct status `124` on
timeout.

### Safety

Every subprocess in the codebase — the AI CLI and `git` — goes through
`utils/execFileNoThrow.ts`, the single module that imports `node:child_process`.
It uses `execFile`/`spawn` with **arguments as an array** and **no shell**, so
PR-controlled values (branch names, SHAs, file paths) can never be interpreted
as shell metacharacters. It never throws; it returns `{ stdout, stderr, status }`
and the caller decides whether a non-zero status is fatal.

## Native repo skills & untrusted-checkout hardening

All adapters run the provider **inside the PR checkout**, so the reviewed repo's
own agent skills/rules are discovered natively (Claude: `.claude/skills/`;
OpenCode: `.claude/skills/`, `.agents/skills/`, `.opencode/skill/`; Cursor:
`.cursor/rules/`, `.cursor/skills/`). This is gated by
`ReviewInput.loadRepoSkills` (env `MAD_REVIEWER_LOAD_REPO_SKILLS`, default on).

Because that checkout is **untrusted PR content**, three guards run regardless of
adapter:

1. **Token strip.** `clonePrHead` removes the `origin` remote after fetching, so
   the installation token embedded in the clone URL never lingers in
   `.git/config` where a skill could read it. The diff is computed from local
   objects only.
2. **Config neutralization.** `sanitizeUntrustedConfig` deletes
   `.claude/settings.json`, `.claude/settings.local.json`, `.mcp.json`, and
   `.cursor/mcp.json` from the checkout — the auto-loaded vectors (hooks, MCP
   servers) that could execute code. When `loadRepoSkills` is `false` it also
   removes the native skill/rule directories (incl. `.cursor/rules`,
   `.cursor/skills`); `.mad-reviewer/skills/` is always preserved.
3. **Tool restriction.** The Claude adapter's `--allowedTools` and the OpenCode
   `review` agent both permit only read + skill, never shell or file edits.
   Cursor's print mode has **no** equivalent read-only flag, so the Cursor adapter
   instead relies on never passing `--force` — writes stay gated behind per-tool
   prompts that print mode has no way to answer — on top of guards 1–2 and the
   container boundary.

Skills themselves are inert prompt text, so loading them is safe; only
config/hooks/plugins can run code, and those are the things that get neutralized.

## The OpenCode adapter

`OpenCodeAdapter` drives the official `opencode` CLI in its non-interactive
`opencode run` mode. The shape mirrors the Claude adapter, with three differences
that come from how `opencode run` works:

1. **Diff delivery via `-f`, not stdin.** `opencode run` takes its prompt as a
   positional argument and has no reliable stdin. Embedding a large PR diff in
   the argument would risk `ARG_MAX` (`E2BIG`). Instead the adapter writes the
   diff to `<workspace>/.mad-reviewer/pr.diff` and attaches it with
   `-f <path>` — only the path is an argv element, so the size is unbounded.
   The (small) curated skill rules are inlined into the prompt; the diff is the
   only large input, and it never touches the argument list. The adapter does
   **not** write an `AGENTS.md`, to avoid clobbering one the reviewed repo may
   ship.
2. **Restricted agent + trusted config.** It runs `opencode run --agent review`
   with `OPENCODE_DISABLE_PROJECT_CONFIG=true` and `OPENCODE_CONFIG` pointing at a
   trusted config (`opencode.review.json`). The `review` agent allows `read` and
   `skill` but denies `bash`/`edit`/`webfetch`/`task`. Disabling project config
   stops the reviewed repo's own opencode config, `AGENTS.md`, and **plugins**
   (which would otherwise load and run arbitrary code) from overriding the
   restrictions, while leaving external skill discovery (`.claude/skills`,
   `.agents/skills`) intact.
3. **JSONL output parsing.** It runs `opencode run --format json`, which emits
   one JSON event per line. The assistant's answer arrives in `text` parts;
   `extractOpencodeText` reconstructs that text (deduping incremental updates by
   part id and ignoring tool/thinking/step events), then the shared
   `extractFindingsJson` + `Finding[]` zod schema validate it. A non-zero exit
   or malformed output throws — the run fails cleanly and nothing is posted.

The model is opencode's own configured default unless
`MAD_REVIEWER_OPENCODE_MODEL` is set, in which case it is passed as
`--model provider/model`. opencode must be installed **and** have a provider
configured/authenticated in the runtime environment.

## The Cursor adapter

`CursorAdapter` drives Cursor's `cursor-agent` CLI in its non-interactive print
mode. The shape mirrors the Claude adapter:

1. **Prompt via stdin.** Like Claude, it inlines the curated skill rules, changed
   files, and the full diff into one prompt and pipes it to the CLI's **stdin**
   (avoiding `ARG_MAX`). The curated rules are inlined, never written to disk.
2. **Hardened invocation.** It runs
   `cursor-agent -p --output-format json`
   (plus `--model <name>` when `MAD_REVIEWER_CURSOR_MODEL` is set). It
   **never** passes `--force`, so any write/shell action stays gated behind a
   per-tool confirmation prompt that print mode has no way to answer. Unlike
   Claude/OpenCode there is no tool allowlist, so the safety rests on the
   no-`--force` posture, the untrusted-checkout guards above, and the container
   boundary. (Older revisions also passed `--trust --sandbox enabled`; those
   flags were dropped because current `cursor-agent` builds no longer recognize
   them and exit `1` with `unknown option`.)
3. **JSON output parsing.** `--output-format json` emits a single result object
   `{ "type":"result", "is_error":…, "result":"<assistant text>", … }` on
   success. The adapter throws on a non-zero exit or `is_error`, then runs the
   `result` text through the shared `extractFindingsJson` + `Finding[]` zod
   schema. Malformed output throws — the run fails cleanly and nothing is posted.

Auth is via the `CURSOR_API_KEY` env var, read directly by `cursor-agent`.
`cursor-agent` must be installed in the runtime environment.

### Debug logging

When `MAD_REVIEWER_DEBUG=true`, the Cursor adapter emits two structured events
per run:

- `ai_request` — fired just before invoking the CLI; includes `args`, the
  workspace directory, `promptBytes`, and the **full prompt** that is piped on
  stdin.
- `ai_response` — fired right after the CLI returns; includes `status` and
  the **raw stdout/stderr**.

This is the easiest way to see exactly what the model was given and how it
replied — including the original JSON envelope before `extractFindingsJson`
parses it. Keep the flag off in production: the prompt contains the diff and
stdout contains the model output. The Claude and OpenCode adapters do not emit
these events yet; the helper plumbing (`log` + `debug` on `ReviewInput`) is in
place, so adding them is a small follow-up.

## Persona injection

Both adapters accept an optional `soul` string on `ReviewInput`. When set, each
`buildPrompt` splices a `## Persona` block into the prompt — verbatim persona text
wrapped in a guard that scopes it to the **voice and wording** of the findings
(`title`/`body`) only, never the bug selection or the output-contract JSON. When
`soul` is absent the block is omitted and behavior is unchanged. The text comes
from `loadSoul` (project-default `SOUL_PATH`, overridable per repo at
`.mad-reviewer/SOUL.md`) — see [Persona](/guide/soul).

## Adding a new adapter

Any other non-interactive tool (as `claude`, `opencode`, and `cursor` already
do) can be added without touching the rest of the system:

1. Implement `AiAdapter` — invoke your CLI through `execFileNoThrow` and parse
   its output into validated `Finding[]` (reuse `extractFindingsJson` and
   `FindingsArraySchema`).
2. Register it in `createAdapter`'s switch.
3. Select it with `MAD_REVIEWER_ADAPTER=<name>`.

No other code changes are required — the runner depends only on the
`AiAdapter` interface.
