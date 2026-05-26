# Skills

Skills are Markdown files that tell the AI **what to look for** and **how to
report it**. They are the knobs you tune to make the reviewer match your team's
standards. The agent assembles an *effective* set of skills for each PR from
three tiers and writes them into the AI's working directory before the run.

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

Matching uses [`minimatch`](https://github.com/isaacs/minimatch) with `dot: true`.

### 3. Per-repo override (`.mad-reviewer/skills/`)

A reviewed repository can ship its own skills under `.mad-reviewer/skills/`.
These are read from the cloned workspace (no extra API call) and:

- a file with the **same name** as a default/auto-apply skill **replaces** it,
- a new file is **added** to the set.

This lets each project layer in project-specific rules without changing the
central deployment.

## Merge order

The effective set is built deterministically:

1. Load everything from `defaults/`.
2. Add the `auto-apply/` skills whose globs match the PR's changed files.
3. Apply the repo overrides (same name replaces, new name adds).

One skill is **protected**: `output-contract` can never be overridden by a repo,
guaranteeing the output format the adapter parses always exists.

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
