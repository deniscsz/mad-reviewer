# Getting Started

`mad-reviewer` is a single Node service that you install as a GitHub App. Every
pull request across your org gets reviewed automatically by an AI tool, guided
by your own review skills, and each bug becomes an inline comment that the agent
keeps up to date across runs.

This page gets the service running locally. For production packaging see
[Deployment](/guide/deployment).

## Prerequisites

- **Node.js ≥ 22**
- **git** available on the `PATH` (used to clone PR heads)
- A **GitHub App** — see [GitHub App Setup](/guide/github-app-setup)
- The chosen **AI CLI** installed and authenticated. The default adapter shells
  out to `claude` (Claude Code headless). See [AI Adapters](/architecture/adapters).

## Install & run

```bash
git clone https://github.com/deniscsz/mad-reviewer.git
cd mad-reviewer
npm install
npm run build
npm start          # or: npm run dev  (hot reload via tsx)
```

The server listens on `PORT` (default `3000`) and exposes a health endpoint:

```bash
curl localhost:3000/health
# {"status":"ok"}
```

## Configure

Copy the example environment file and fill in your GitHub App credentials:

```bash
cp .env.example .env
```

At minimum you must set `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, and
`GITHUB_WEBHOOK_SECRET`. Everything else has sensible defaults — see
[Configuration](/guide/configuration) for the full list.

## What happens on a PR

Once the App is installed and your server is reachable from GitHub:

1. Opening or pushing to a PR triggers a webhook.
2. The job is debounced and enqueued (one run per PR at a time).
3. A worker clones the PR, loads your skills, runs the AI adapter, and posts
   inline comments for any bugs found.
4. On later pushes, comments for fixed bugs are resolved automatically and new
   bugs are added.

To understand the moving parts, continue to the
[Architecture Overview](/architecture/overview). To customize what gets flagged,
see [Skills](/guide/skills).
