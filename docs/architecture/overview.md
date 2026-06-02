# Architecture Overview

`mad-reviewer` is composed of small, single-purpose modules wired together at a
single entrypoint. Webhooks feed a persistent queue; a worker drains it and runs
each review through a pipeline; results are written back to GitHub.

## End-to-end flow

```
GitHub org (repos)
   │  webhook: pull_request (opened / synchronize / reopened)
   ▼
┌──────────────────────────────────────────────┐
│  Server (Node + Probot)                         │
│                                                 │
│  webhook handler ──► enqueue(job)               │
│                         │                       │
│                  ┌──────▼───────┐  SQLite        │
│                  │ Queue        │◄─ jobs, locks, │
│                  └──────┬───────┘   last_sha     │
│                         │ debounce + 1/PR lock   │
│                  ┌──────▼─────────────────────┐  │
│                  │ Worker → Runner            │  │
│                  │  + check run: in_progress  │  │
│                  │    → success / neutral     │  │
│                  │  1. mint installation token│  │
│                  │  2. clone PR head + base   │  │
│                  │  3. diff → changed files   │  │
│                  │  4. load skills (3 tiers)  │  │
│                  │  5. AI adapter → findings  │  │
│                  │  6. fingerprint each       │  │
│                  │  7. reconcile vs active    │  │
│                  │  8. create / keep / resolve│  │
│                  │  9. cleanup workspace      │  │
│                  └────────────────────────────┘  │
└──────────────────────────────────────────────┘
   │  Octokit REST + GraphQL, git over HTTPS
   ▼
GitHub API
```

## Modules

| Module | Responsibility |
|---|---|
| `webhook.ts` | Validate the event, map a PR payload to a `Job`, enqueue it |
| `queue/queue.ts` | SQLite-backed orchestration: debounce, one-run-per-PR lock, retry, skip already-processed commits, crash-reclaim |
| `worker.ts` | Drain the queue: claim → run → complete (or fail+retry), and drive the per-PR check-run lifecycle |
| `github/checks.ts` | Publish the per-PR check run (fail-soft): start on claim, finalize with conclusion + summary |
| `runner.ts` | Orchestrate one review run (the pipeline above) |
| `workspace.ts` | Clone the PR head + base and compute the diff (via the safe subprocess wrapper) |
| `skills/loader.ts` + `skills/autoApply.ts` | Assemble the effective 3-tier skill set |
| `adapters/*` | The `AiAdapter` interface and the built-in `claude`, `opencode`, `cursor` & `codex` implementations |
| `fingerprint.ts` | Deterministic bug identity + the comment marker embed/parse |
| `reconciler.ts` | Pure create/keep/resolve decision logic |
| `github/comments.ts` | List the bot's active comments, post inline, resolve threads |
| `utils/execFileNoThrow.ts` | The single no-shell subprocess wrapper |
| `config.ts` | Parse/validate environment configuration |
| `index.ts` | Compose everything; HTTP server + worker + `/health` |

## Design principles

- **GitHub is the source of truth.** Findings are not stored anywhere; the agent
  re-derives state each run from its own comments, identified by an embedded
  fingerprint marker. SQLite holds *only* orchestration state. See
  [Reconciliation](/architecture/reconciliation).
- **Dependency injection at the edges.** The runner receives all IO (git,
  GitHub, AI, skills) as injected functions, so the core logic is unit-tested
  without a network or git.
- **One place touches the shell.** All subprocesses go through
  `execFileNoThrow` with array arguments — no shell, no interpolation of
  PR-controlled values. See [Adapters](/architecture/adapters).
- **Fail without side effects.** Any failure (clone, AI, parse, API) propagates;
  the workspace is cleaned in a `finally`, and nothing is posted on a failed run.

Continue to [Reconciliation](/architecture/reconciliation) for the memory model,
[Queue](/architecture/queue) for orchestration, or [Adapters](/architecture/adapters)
for the AI integration.
