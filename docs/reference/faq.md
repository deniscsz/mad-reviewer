# FAQ

## Why is there no findings database?

A separate store would become a second source of truth that drifts from the PR
(humans edit, resolve, or delete comments). Instead the agent treats **GitHub as
authoritative** and recognizes its own comments by an embedded fingerprint
marker. SQLite holds only job orchestration. See
[Reconciliation](/architecture/reconciliation).

## What if the AI is non-deterministic and a bug flickers in and out?

Resolution is driven by **absence** from the current run. If a finding
disappears, its comment is resolved; if it reappears later, the reappearance
path posts a fresh comment. So a flapping model self-corrects rather than
leaving stale state. Writing stable `dedupeKey`s in your [skills](/guide/skills)
minimizes flicker.

## Won't large PRs blow up the AI command line?

No. The prompt (which embeds the diff) is piped to the AI CLI via **stdin**, not
passed as a command-line argument, so it isn't subject to `ARG_MAX`. The
subprocess wrapper also enforces a `maxBuffer` on captured output. See
[Adapters](/architecture/adapters).

## Does it ever touch comments that aren't its own?

No. It only acts on comments carrying its fingerprint marker. Human comments and
human-resolved threads are never modified.

## Can I use something other than Claude?

Yes. The AI tool sits behind the `AiAdapter` interface. Two adapters ship built
in — `claude` (default) and `opencode` — selectable with `MAD_REVIEWER_ADAPTER`.
Adding `cursor` or another non-interactive CLI is a contained change — see
[Adapters](/architecture/adapters).

## Can I change the reviewer's tone / how it talks?

Yes. Drop a `SOUL.md` persona file in the project (path `SOUL_PATH`, default
`./SOUL.md`) or override it per repo at `.mad-reviewer/SOUL.md`. It shapes the
**voice** of the review comments (professional, sarcastic, …) but never changes
which bugs are reported or the output format. See [Persona](/guide/soul).

## How do I review only certain file types with extra rules?

Add an auto-apply skill with `applies_to` globs (e.g. `**/*.sql`). It loads only
when the PR touches matching files. See [Skills](/guide/skills).

## Can a specific repo customize the rules?

Yes, two ways. Commit Markdown skills under `.mad-reviewer/skills/` in that repo
to replace an *auto-apply* skill of the same name or add new ones — mad-reviewer's
defaults (incl. `output-contract`) can never be overridden. The repo's own native
skills (`.claude/skills/`, …) are also loaded by the AI provider unless
`MAD_REVIEWER_LOAD_REPO_SKILLS=false`. See [Skills](/guide/skills).

## What happens if a run fails midway?

Nothing is posted on a failed run, the workspace is cleaned up, and the job
retries up to `MAX_RETRIES`. If the process crashes mid-run, the job is reclaimed
on restart. See [Queue](/architecture/queue).

## Does the check run block merging?

No. By default the check is `success` when no mad-reviewer comments remain open
and `neutral` when some do — neither blocks a merge. If you *want* it to gate
merges, make `mad-reviewer` a **required status check** in the branch protection
rules; then a `neutral` result will hold the PR. A run that errors/times out is
`failure`. The feature needs the App's `Checks: Read & write` permission and can
be turned off with `MAD_REVIEWER_CHECKS=false`.

## Does it support multiple organizations?

The current design targets a single org installation. Multi-org is out of scope
for the initial version, though the App model does not preclude it.

## Why are the auto-resolve replies in Portuguese?

The default resolution reply string is Portuguese. Change it in
`src/github/comments.ts` to match your team's language.
