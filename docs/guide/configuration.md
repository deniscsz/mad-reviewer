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
  mode has no read-only tool flag; the adapter hardens it by running with
  `--sandbox enabled`, never passing `--force`/`--yolo` (writes stay proposed-only),
  and relying on the untrusted-checkout sanitization — see [Adapters](/architecture/adapters#the-cursor-adapter).
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
