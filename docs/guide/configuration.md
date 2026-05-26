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
| `MAD_REVIEWER_ADAPTER` | | `claude` | Which AI adapter to use. Only `claude` is built in; see [Adapters](/architecture/adapters) |
| `AI_TIMEOUT_MS` | | `300000` | Maximum time for one AI CLI invocation, in ms |
| `DEBOUNCE_MS` | | `15000` | How long to coalesce a burst of pushes before running, in ms |
| `MAX_RETRIES` | | `3` | Attempts before a job is marked `failed` |
| `SQLITE_PATH` | | `./data/queue.db` | Path to the orchestration database file |
| `WORKER_POLL_MS` | | `2000` | How often the worker polls the queue when idle, in ms |
| `PORT` | | `3000` | HTTP port for webhooks and `/health` |
| `DEFAULTS_DIR` | | `./skills/defaults` | Directory of always-on skills |
| `AUTO_APPLY_DIR` | | `./skills/auto-apply` | Directory of glob-selected skills |

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

## Example

A complete `.env` (see `.env.example` in the repo):

```bash
# GitHub App credentials
GITHUB_APP_ID=
GITHUB_PRIVATE_KEY=
GITHUB_WEBHOOK_SECRET=

# AI adapter
MAD_REVIEWER_ADAPTER=claude
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
```
