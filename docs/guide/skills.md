# Skills

Skills are Markdown files that tell the AI **what to look for** and **how to
report it**. They are the knobs you tune to make the reviewer match your team's
standards. The agent assembles an *effective* set of skills for each PR from
three tiers and inlines them into the AI prompt as the authoritative review
rules. On top of that, the reviewed repo's **own native skills** are loaded
directly by the AI provider — see [Your repo's own skills](#your-repo-s-own-skills-native).

> Skills decide *what* gets flagged; [SOUL.md](/guide/soul) decides *how the
> reviewer talks*. They are independent.

## The three tiers

```
skills/defaults/      ← always loaded (ships with mad-reviewer)
skills/auto-apply/    ← loaded only when a changed file matches its globs
<repo>/.mad-reviewer/skills/   ← per-repo override, committed in the reviewed repo
```

### 1. Defaults (`skills/defaults/`)

Always loaded for every review. Ships with `output-contract`, `null-safety`,
and `security`. The directory is configurable via `DEFAULTS_DIR`.

### 2. Auto-apply (`skills/auto-apply/`)

Loaded **only** when at least one changed file matches the skill's `applies_to`
globs. This keeps the prompt focused — e.g. SQL rules only load when the PR
touches `.sql` files. Configurable via `AUTO_APPLY_DIR`.

```markdown
---
name: sql-migrations
description: Extra checks for SQL and migration files
applies_to:
  - "**/*.sql"
  - "**/migrations/**"
---

# SQL & migrations
- Destructive migrations without a safe rollback path
- Missing indexes on columns used in new WHERE/JOIN clauses
- Non-idempotent migrations that fail on re-run
```

Matching uses [`minimatch`](https://github.com/isaacs/minimatch) with `dot: true`
(brace expansion like `**/*.{ts,tsx}` is supported).

Bundled auto-apply skills:

| Skill | Loads when the PR touches | Catches |
|-------|---------------------------|---------|
| `concurrency-async` | any code file | races, missing `await`, unhandled rejections, leaked goroutines/threads |
| `error-handling` | any code file | swallowed errors, broad catches, broken propagation, partial-failure |
| `resource-leaks` | any code file | unclosed connections/files, dangling listeners, uncleared timers |
| `performance` | any code file | N+1, queries in loops, quadratic work, unbounded retention |
| `typescript-javascript` | `.ts/.tsx/.js/.jsx/.mts/.cts` | `==` vs `===`, `any`, missing `await`, stale closures |
| `react` | `.tsx/.jsx` | Rules of Hooks, effect deps/cleanup, fetch races, index keys, RSC misuse |
| `sql-migrations` | `.sql`, `migrations/` | destructive migrations, missing indexes, non-idempotent runs |

### 3. Per-repo override (`.mad-reviewer/skills/`)

A reviewed repository can ship its own skills under `.mad-reviewer/skills/`.
These are read from the cloned workspace (no extra API call) and:

- a file with the **same name** as an *auto-apply* skill **replaces** it,
- a new file is **added** to the set,
- a file with the **same name as a default is ignored** — defaults are locked.

This lets each project layer in project-specific rules without changing the
central deployment.

## Merge order

The effective set is built deterministically:

1. Load everything from `defaults/`.
2. Add the `auto-apply/` skills whose globs match the PR's changed files.
3. Apply the repo overrides (same name as an auto-apply skill replaces it, new
   name adds; a name matching a **default** is dropped).

mad-reviewer's **defaults are protected**: no repo override can replace a skill
that ships in `defaults/` (including `output-contract`). This guarantees the
baseline checks — and the output format the adapter parses — always apply.

## Your repo's own skills (native) {#your-repo-s-own-skills-native}

mad-reviewer runs the AI provider **inside the PR checkout**, so the standard
agent skills your developers already use are picked up **natively**, just like a
local run:

| Provider | Native skill locations loaded |
|---|---|
| `claude -p` | `<repo>/.claude/skills/<name>/SKILL.md` |
| `opencode run` | `<repo>/.claude/skills/`, `.agents/skills/`, `.opencode/skill/` |
| `cursor-agent -p` | `<repo>/.cursor/rules/`, `.cursor/skills/` |
| `codex exec` | `<repo>/AGENTS.md` (root + nested; Codex's native project guidance) |

Claude and OpenCode skills use the standard **`<skill-name>/SKILL.md`** folder
layout (the same format those tools use locally); Cursor reads `.cursor/rules`
and Codex reads a repo-root **`AGENTS.md`**. They **add** guidance on top of the
curated tiers above but can never override the output contract or the curated
rules — the curated set is inlined into the prompt as authoritative.

### Turning it off

Set `MAD_REVIEWER_LOAD_REPO_SKILLS=false` to ignore the repo's native skills and
review with **only** mad-reviewer's own set (defaults + auto-apply +
`.mad-reviewer/skills/`). When disabled, the native skill directories are removed
from the checkout before the run and the provider is told not to load them
(`OPENCODE_DISABLE_EXTERNAL_SKILLS` for opencode); `.mad-reviewer/skills/` is
always kept.

### Safety

The reviewed repo's `.claude/settings.json`, `.mcp.json`, hooks and opencode
plugins are **never executed**, and the clone's embedded GitHub token is stripped
before the AI runs. Skills are inert prompt text, but config/hooks/plugins could
run code — so they are neutralized while skill discovery stays on. See
[Adapters](/architecture/adapters) for the mechanics.

## The output contract

`output-contract.md` defines the JSON the AI must emit. Every finding is one bug:

```json
{
  "file": "src/user.ts",
  "line": 42,
  "category": "null-safety",
  "dedupeKey": "null-safety:UserService.load:user-param",
  "severity": "bug",
  "title": "Possible null dereference",
  "body": "user may be null here; guard before access."
}
```

Rules baked into the contract:

- `severity` is always `"bug"` — no style or nitpicks.
- `dedupeKey` is a **stable semantic identity**, `<category>:<symbol>:<symptom>`.
  It must **not** contain line numbers and must stay the same across runs for the
  same underlying bug.
- If there are no bugs, emit `[]`.

## Why `dedupeKey` matters

The `dedupeKey` (with the file and category) is what produces a bug's
[fingerprint](/architecture/reconciliation) — the identity used to dedupe and
reconcile comments. Because the line number is deliberately **excluded** from the
identity, a bug that simply moves lines keeps the same comment instead of being
re-posted. Write `dedupeKey`s that describe the *bug*, not its location.

## Writing a custom skill

1. Create a Markdown file with `name` and `description` frontmatter.
2. For an auto-apply skill, add `applies_to` globs.
3. List concretely what to flag and the `dedupeKey` shape to use.
4. Drop it in `skills/auto-apply/` (central) or the repo's `.mad-reviewer/skills/`
   (project-specific).

## A note on language

When the agent auto-resolves a fixed bug it posts a short reply. The default
string is Portuguese (*"Resolvido automaticamente nesta revisão (commit …)"*).
Change it in `src/github/comments.ts` if your audience differs.
