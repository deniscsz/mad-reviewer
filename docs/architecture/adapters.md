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
}

interface AiAdapter {
  name: string;
  review(input: ReviewInput): Promise<Finding[]>;
}
```

`createAdapter(name, opts)` is a factory keyed on `MAD_REVIEWER_ADAPTER`. Only
`claude` is built in; unknown names throw.

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

## Adding a new adapter

`cursor`, `opencode`, or any other non-interactive tool can be added without
touching the rest of the system:

1. Implement `AiAdapter` — invoke your CLI through `execFileNoThrow` and parse
   its output into validated `Finding[]` (reuse `extractFindingsJson` and
   `FindingsArraySchema`).
2. Register it in `createAdapter`'s switch.
3. Select it with `MAD_REVIEWER_ADAPTER=<name>`.

No other code changes are required — the runner depends only on the
`AiAdapter` interface.
