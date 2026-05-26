# Orchestration Queue

The queue is the only persistent state in `mad-reviewer`, backed by an embedded
SQLite database (`SQLITE_PATH`). It holds **orchestration state only** — never
findings, which live in GitHub. It is one row per PR.

## Responsibilities

- **Debounce** bursts of pushes so a rapid series of commits triggers one run.
- **One run per PR** at a time (no two concurrent runs racing on the same PR).
- **Skip** commits that were already processed.
- **Retry** failed jobs up to a limit, then mark them `failed`.
- **Survive restarts**, including reclaiming jobs that were mid-run when the
  process died.

## Schema

A single `jobs` table keyed by `(owner, repo, pr)`:

| Column | Purpose |
|---|---|
| `owner`, `repo`, `pr` | Primary key — one row per PR |
| `head_sha`, `base_sha` | The commit range to review |
| `installation_id` | Which App installation to authenticate as |
| `status` | `pending` · `running` · `idle` · `failed` |
| `run_after` | Debounce gate (epoch ms) |
| `attempts` | Retry counter |
| `last_processed_sha` | The last head successfully completed |

## Lifecycle

```
enqueue(job)   → upsert row; status=pending; run_after = now + DEBOUNCE_MS
                 (returns false and skips if head_sha == last_processed_sha)
claimNext(now) → pick a pending row with run_after <= now; set status=running
complete(job)  → status=idle; last_processed_sha = head_sha
fail(job, max) → attempts++; status=pending (retry) or failed (>= max)
```

### Debounce & coalescing

`enqueue` sets `run_after = now + DEBOUNCE_MS` and upserts on conflict, so a
burst of pushes to the same PR collapses into a single pending row with the
latest `head_sha`. `claimNext` only returns rows whose `run_after` has elapsed.

### One run per PR

`claimNext` flips the claimed row to `running`. Because there's one row per PR
and a single worker, a PR with a run in flight is not claimable again until it
completes — no concurrent runs on the same PR.

### Skip already-processed commits

If a new event arrives with a `head_sha` equal to the row's
`last_processed_sha`, `enqueue` returns `false` and does nothing — the exact
commit was already reviewed.

### Retry

On failure the worker calls `fail`, which increments `attempts` and re-queues
(`pending`) until `MAX_RETRIES`, after which the row is `failed` and left for
inspection.

### Restart & crash recovery

The DB file is reopened on startup (WAL mode), so pending jobs survive a normal
restart. Additionally, the constructor resets any stale `running` rows back to
`pending` — a job that was mid-run when the process crashed is reclaimed and run
again, rather than stranded forever.

## Why SQLite?

It is embedded (no separate service to operate), persistent (survives restarts),
and more than fast enough for org-scale PR volume. The queue is accessed behind a
small interface, so replacing it with an external broker for horizontal scaling
later is a contained change — intentionally out of scope for now.
