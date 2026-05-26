# AI Adapters

The AI tool that performs the actual review sits behind a small interface, so it
can be swapped via configuration. The default implementation drives the
headless `claude` CLI.

## The interface

```ts
interface ReviewInput {
  workspaceDir: string;    // the cloned PR checkout
  changedFiles: string[];  // diff focus
  diff: string;
  skills: EffectiveSkills; // merged 3-tier skills
  soul?: string;           // optional persona text (SOUL.md)
}

interface AiAdapter {
  name: string;
  review(input: ReviewInput): Promise<Finding[]>;
}
```

`createAdapter(name, opts)` is a factory keyed on `MAD_REVIEWER_ADAPTER`.
`claude` and `opencode` are built in; unknown names throw.

## The Claude adapter

`ClaudeAdapter.review()`:

1. Writes the effective skills into `<workspace>/.claude/skills/*.md` so the CLI
   picks them up natively.
2. Builds a prompt (changed files + diff + an instruction to emit the
   `output-contract` JSON).
3. Runs `claude -p --output-format json` in the workspace via the safe
   subprocess wrapper.
4. Validates: a non-zero exit throws; the result is parsed and checked against
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

## The OpenCode adapter

`OpenCodeAdapter` drives the official `opencode` CLI in its non-interactive
`opencode run` mode. The shape mirrors the Claude adapter, with two differences
that come from how `opencode run` works:

1. **Diff delivery via `-f`, not stdin.** `opencode run` takes its prompt as a
   positional argument and has no reliable stdin. Embedding a large PR diff in
   the argument would risk `ARG_MAX` (`E2BIG`). Instead the adapter writes the
   diff to `<workspace>/.mad-reviewer/pr.diff` and attaches it with
   `-f <path>` — only the path is an argv element, so the size is unbounded.
   The (small) skill rules are inlined into the prompt; the diff is the only
   large input, and it never touches the argument list. The adapter does **not**
   write an `AGENTS.md`, to avoid clobbering one the reviewed repo may ship.
2. **JSONL output parsing.** It runs `opencode run --format json`, which emits
   one JSON event per line. The assistant's answer arrives in `text` parts;
   `extractOpencodeText` reconstructs that text (deduping incremental updates by
   part id and ignoring tool/thinking/step events), then the shared
   `extractFindingsJson` + `Finding[]` zod schema validate it. A non-zero exit
   or malformed output throws — the run fails cleanly and nothing is posted.

The model is opencode's own configured default unless
`MAD_REVIEWER_OPENCODE_MODEL` is set, in which case it is passed as
`--model provider/model`. opencode must be installed **and** have a provider
configured/authenticated in the runtime environment.

## Persona injection

Both adapters accept an optional `soul` string on `ReviewInput`. When set, each
`buildPrompt` splices a `## Persona` block into the prompt — verbatim persona text
wrapped in a guard that scopes it to the **voice and wording** of the findings
(`title`/`body`) only, never the bug selection or the output-contract JSON. When
`soul` is absent the block is omitted and behavior is unchanged. The text comes
from `loadSoul` (project-default `SOUL_PATH`, overridable per repo at
`.mad-reviewer/SOUL.md`) — see [Persona](/guide/soul).

## Adding a new adapter

`cursor` or any other non-interactive tool can be added without touching the
rest of the system:

1. Implement `AiAdapter` — invoke your CLI through `execFileNoThrow` and parse
   its output into validated `Finding[]` (reuse `extractFindingsJson` and
   `FindingsArraySchema`).
2. Register it in `createAdapter`'s switch.
3. Select it with `MAD_REVIEWER_ADAPTER=<name>`.

No other code changes are required — the runner depends only on the
`AiAdapter` interface.
