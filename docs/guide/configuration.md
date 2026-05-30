# Configuration

All configuration is via environment variables, parsed and validated at startup
by `src/config.ts` (using zod). Missing required variables cause the process to
exit immediately with a validation error; numeric values are coerced.

## Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `GITHUB_APP_ID` | ✅ | — | GitHub App ID |
| `GITHUB_PRIVATE_KEY` | ✅ | — | GitHub App private key (PEM, multi-line) |
| `GITHUB_WEBHOOK_SECRET` | ✅ | — | Webhook HMAC secret (must match the App config) |
| `MAD_REVIEWER_ADAPTER` | | `claude` | Which AI adapter to use: `claude`, `opencode`, or `cursor`; see [Adapters](/architecture/adapters) |
| `MAD_REVIEWER_OPENCODE_MODEL` | | — | `opencode` only: `provider/model` passed to `opencode run --model`. Unset → opencode's own default |
| `MAD_REVIEWER_OPENCODE_CONFIG` | | `./opencode.review.json` | `opencode` only: path to the trusted config defining the read-only `review` agent |
| `MAD_REVIEWER_CURSOR_MODEL` | | — | `cursor` only: model name passed to `cursor-agent --model` (e.g. `sonnet-4`, `gpt-5`). Unset → Cursor account default |
| `CURSOR_API_KEY` | | — | `cursor` only: read directly by `cursor-agent` for auth (not parsed by mad-reviewer). Required when `MAD_REVIEWER_ADAPTER=cursor` |
| `MAD_REVIEWER_LOAD_REPO_SKILLS` | | `true` | Load the reviewed repo's own native skills (`.claude/skills`, …) in addition to mad-reviewer's. `false` ignores them; see [Skills](/guide/skills#your-repo-s-own-skills-native) |
| `MAD_REVIEWER_DEBUG` | | `false` | Verbose JSON logging. When `true`, the adapter emits `ai_request`/`ai_response` events with the full prompt and raw CLI output, and the runner logs `comment_keep`. See [Logging](#logging) |
| `MAD_REVIEWER_CHECKS` | | `true` | Publish a Check Run per review on the PR head. `success` when no findings stay open, `neutral` otherwise. Any value other than `false` keeps it on; see [Check Runs](/architecture/check-runs) |
| `MAD_REVIEWER_CHECK_NAME` | | `mad-reviewer` | Display name of the check (GitHub groups re-runs by the same name) |
| `AI_TIMEOUT_MS` | | `300000` | Maximum time for one AI CLI invocation, in ms |
| `DEBOUNCE_MS` | | `15000` | How long to coalesce a burst of pushes before running, in ms |
| `MAX_RETRIES` | | `3` | Attempts before a job is marked `failed` |
| `SQLITE_PATH` | | `./data/queue.db` | Path to the orchestration database file |
| `WORKER_POLL_MS` | | `2000` | How often the worker polls the queue when idle, in ms |
| `PORT` | | `3000` | HTTP port for webhooks and `/health` |
| `DEFAULTS_DIR` | | `./skills/defaults` | Directory of always-on skills |
| `AUTO_APPLY_DIR` | | `./skills/auto-apply` | Directory of glob-selected skills |
| `SOUL_PATH` | | `./SOUL.md` | Project-default persona file; see [Persona](/guide/soul) |

## Notes

- **`GITHUB_PRIVATE_KEY`** is multi-line. Preserve the newlines — quote it in
  the `.env`, load it from a file, or inject it from a secret manager. Never
  commit it.
- **`DEBOUNCE_MS`** trades latency for fewer redundant runs. A larger value
  better coalesces rapid pushes; a smaller value reviews sooner. See the
  [Queue](/architecture/queue) page for how debounce interacts with the
  one-run-per-PR lock.
- **`AI_TIMEOUT_MS`** bounds a single review. On timeout the run fails cleanly
  (status `124`) and **nothing is posted** — the job retries up to `MAX_RETRIES`.
- **`SQLITE_PATH`** should live on a persistent volume in production so the queue
  survives restarts. It holds *only* orchestration state, never findings.
- **`MAD_REVIEWER_OPENCODE_MODEL`** only applies when `MAD_REVIEWER_ADAPTER=opencode`.
  Leave it unset to use whatever model opencode is configured with
  (`~/.config/opencode/opencode.json`); set it to pin one, e.g.
  `anthropic/claude-sonnet-4`.
- **`MAD_REVIEWER_OPENCODE_CONFIG`** only applies when `MAD_REVIEWER_ADAPTER=opencode`.
  It points at a trusted opencode config (shipped in the image as
  `opencode.review.json`) that defines a read-only `review` agent (read + skill
  allowed; bash/edit/webfetch/task denied). The adapter runs with
  `OPENCODE_DISABLE_PROJECT_CONFIG=true` so the reviewed repo's own opencode
  config/`AGENTS.md`/plugins cannot relax those restrictions.
- **`MAD_REVIEWER_CURSOR_MODEL`** only applies when `MAD_REVIEWER_ADAPTER=cursor`.
  Leave it unset to use the Cursor account's default model; set it to pin one,
  e.g. `sonnet-4` or `gpt-5`. The `cursor` adapter needs `cursor-agent` installed
  in the runtime and `CURSOR_API_KEY` set. Unlike Claude/OpenCode, Cursor's print
  mode has no read-only tool flag; the adapter hardens it by never passing
  `--force` (writes stay gated by per-tool prompts that print mode never
  answers) and relying on the untrusted-checkout sanitization — see
  [Adapters](/architecture/adapters#the-cursor-adapter).
- **`MAD_REVIEWER_LOAD_REPO_SKILLS`** controls whether the reviewed repo's own
  native skills are loaded by the AI provider in addition to mad-reviewer's
  curated set. Default `true` — devs' day-to-day skills inform the review. Any
  value other than the literal `false` keeps it on. When `false`, native skill
  directories are stripped from the checkout and the provider is told not to load
  them; `.mad-reviewer/skills/` is always kept. See
  [Skills](/guide/skills#your-repo-s-own-skills-native).
- **`SOUL_PATH`** points at the project-default persona file. A reviewed repo can
  override it with its own `.mad-reviewer/SOUL.md`. If neither exists, no persona is
  injected. See [Persona](/guide/soul).
- **`MAD_REVIEWER_DEBUG`** turns on verbose logging — see [Logging](#logging) below.
  Keep it `false` in production: the `ai_request` event embeds the entire prompt,
  which contains the PR diff, and the `ai_response` event embeds the raw CLI
  output. Both can leak source code into your log sink.
- **`MAD_REVIEWER_CHECKS`** publishes a GitHub Check Run per review. Conclusion is
  `success` when no mad-reviewer comments remain open after the run and `neutral`
  when any remain (new or carried over) — it never blocks a merge by default. A
  run that errors/times out is reported `failure`. It needs the App's
  **`Checks: Read & write`** permission; if that is missing the check calls
  fail soft (a `check_error` is logged and the run still posts comments). See
  [Check Runs](/architecture/check-runs).

## Logging

mad-reviewer logs structured JSON lines to stdout. Every event is one line, ready
to pipe through `jq`/`grep` or ship to your log collector.

### Always-on events

| Event | When | Useful fields |
|---|---|---|
| `listening` | Server booted | `port`, `adapter`, `debug` |
| `shutdown` | SIGTERM/SIGINT received | `signal` |
| `webhook` | PR event accepted | `action`, `repo`, `pr`, `headSha`, `installationId` |
| `webhook_skipped` | PR event ignored | `reason` (e.g. `no_installation`) |
| `enqueue` | Job added to the queue | `repo`, `pr`, `headSha`, `runAfter` |
| `enqueue_skipped` | Same `headSha` already processed | `reason` |
| `debounce_replace` | New push replaced a pending job for the same PR | `oldHeadSha`, `newHeadSha`, `runAfter` |
| `claim` | Worker picked up a job | `repo`, `pr`, `headSha` |
| `job_start` / `job_done` | Worker entered/finished a run | `durationMs` on `job_done` |
| `complete` | Job marked idle, `last_processed_sha` updated | `repo`, `pr`, `headSha` |
| `comment_create` / `comment_resolve` | Each GitHub action taken | `file`, `line`, `category`, `fp`, `commentId` |
| Summary (no `event` field) | End of a run | `repo`, `pr`, `sha`, `findings`, `created`, `kept`, `resolved` |
| `retry` / `job_dead` | Job failed and is being retried or has exhausted `MAX_RETRIES` | `attempts`, `maxRetries` |
| `job_failed` | Run threw — logged with `level:"error"` | `error`, `stack`, `durationMs` |
| `check_create` | A check run was created/reused on claim | `repo`, `pr`, `headSha`, `checkRunId` |
| `check_complete` | A check run was finalized | `repo`, `pr`, `checkRunId`, `conclusion`, `open` |
| `check_error` | A check API call failed (fail-soft) | `repo`, `pr`, `phase`, `error` |

### Debug-only events (`MAD_REVIEWER_DEBUG=true`)

| Event | When | Fields |
|---|---|---|
| `ai_request` | Just before invoking the AI CLI | `adapter`, `model`, `workspaceDir`, `args`, `promptBytes`, `prompt` |
| `ai_response` | Right after the AI CLI returns | `status`, `stdoutBytes`, `stderrBytes`, `stdout`, `stderr` |
| `comment_keep` | A finding already had an active comment | `repo`, `pr`, `fp` |

Currently emitted by the **cursor** adapter; the claude/opencode adapters will be
extended next.

### Filtering examples

```bash
# follow everything, with timestamps
npm run dev 2>&1 | tee mad-reviewer.log

# only the structured app events
npm run dev 2>&1 | jq -c 'select(.event)'

# only the CLI invocation pair (needs MAD_REVIEWER_DEBUG=true)
npm run dev 2>&1 | jq -c 'select(.event=="ai_request" or .event=="ai_response")'

# only failures
npm run dev 2>&1 | jq -c 'select(.level=="error")'
```

## Example

A complete `.env` (see `.env.example` in the repo):

```bash
# GitHub App credentials
GITHUB_APP_ID=
GITHUB_PRIVATE_KEY=
GITHUB_WEBHOOK_SECRET=

# AI adapter (claude | opencode | cursor)
MAD_REVIEWER_ADAPTER=claude
# MAD_REVIEWER_OPENCODE_MODEL=anthropic/claude-sonnet-4   # opencode only
# MAD_REVIEWER_OPENCODE_CONFIG=./opencode.review.json     # opencode only
# MAD_REVIEWER_CURSOR_MODEL=sonnet-4                       # cursor only
# CURSOR_API_KEY=                                          # cursor only (read by cursor-agent)
# MAD_REVIEWER_LOAD_REPO_SKILLS=true                       # false → ignore the repo's own skills
# MAD_REVIEWER_DEBUG=false                                  # true → log full AI prompt & raw CLI output
# MAD_REVIEWER_CHECKS=true                                  # false → no per-PR check run
# MAD_REVIEWER_CHECK_NAME=mad-reviewer                      # display name of the check
AI_TIMEOUT_MS=300000

# Orchestration
DEBOUNCE_MS=15000
MAX_RETRIES=3
WORKER_POLL_MS=2000
SQLITE_PATH=./data/queue.db

# Server
PORT=3000

# Skills
DEFAULTS_DIR=./skills/defaults
AUTO_APPLY_DIR=./skills/auto-apply

# Persona
SOUL_PATH=./SOUL.md
```
