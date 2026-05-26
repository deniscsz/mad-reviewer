# Deployment

`mad-reviewer` is a single long-lived Node process: an HTTP server that receives
webhooks plus an in-process worker that drains the queue. This page covers
packaging it for production.

## Runtime requirements

The runtime environment must provide:

- **Node ≥ 22**
- **git** on the `PATH` (clones PR heads)
- The chosen **AI CLI** installed **and authenticated** — `claude` (default) or
  `opencode` (needs a provider configured / API key); set via `MAD_REVIEWER_ADAPTER`
- A **persistent volume** for the SQLite queue (`SQLITE_PATH`)

## Docker

The repo ships a `Dockerfile` that installs `git`, builds the project, and
copies the default skills and the default `SOUL.md` persona (overridable per repo
at `.mad-reviewer/SOUL.md` or via `SOUL_PATH` — see [Persona](/guide/soul)):

```bash
docker build -t mad-reviewer .
docker run \
  --env-file .env \
  -p 3000:3000 \
  -v "$PWD/data:/data" \
  mad-reviewer
```

The base image does **not** include the AI CLI. Extend it in a derived image and
provide credentials via environment:

```dockerfile
FROM mad-reviewer
# install + configure your AI CLI here (e.g. claude), then it inherits CMD
```

`SQLITE_PATH` defaults to `/data/queue.db` in the image and `/data` is declared
as a volume — mount it so the queue survives container restarts.

## Secrets

Provide `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, and the
AI CLI's credentials via your platform's secret manager — never bake them into
the image or commit them. The private key is multi-line; keep the newlines.

## Health & lifecycle

- **Liveness:** `GET /health` returns `{"status":"ok"}`.
- **Graceful shutdown:** on `SIGTERM`/`SIGINT` the server stops the worker,
  closes the HTTP server, and closes the SQLite handle before exiting.
- **Crash recovery:** on startup any job left mid-run (status `running`) is
  reclaimed to `pending`, so a crash does not strand a PR. See
  [Queue](/architecture/queue).

## Scaling

The current design runs a single process with one in-process worker, which is
sufficient for typical org volumes (one run per PR, debounced). The queue
interface is isolated, so swapping the embedded SQLite queue for an external
one (e.g. Redis-backed) to scale horizontally is a contained change — it is
intentionally **out of scope** for the initial version.

## CI / Pages (this repo)

This repository itself uses two GitHub Actions workflows:

- `ci.yml` — type-check, test, and build on every push and PR.
- `docs.yml` — build this VitePress site and deploy it to GitHub Pages on pushes
  to `main`.

To publish the docs on a fork, enable **Settings → Pages → Source: GitHub
Actions**.
