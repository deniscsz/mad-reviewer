# Contributing

Contributions are welcome. This page covers the dev setup and the conventions
the codebase follows.

## Setup

```bash
git clone https://github.com/deniscsz/mad-reviewer.git
cd mad-reviewer
npm install
npm test            # 66 tests should pass
npm run typecheck   # 0 errors
```

## Conventions

- **TypeScript, ESM, NodeNext.** Relative imports end in `.js`.
- **Test-first.** The suite (vitest) covers pure logic directly and IO modules
  via dependency injection, so unit tests need no network or git. Add or update
  tests with every change.
- **Single responsibility per file.** Each module has one clear job and a small,
  well-defined interface. The runner injects all IO so the core stays testable.
- **One place touches the shell.** All subprocesses go through
  `src/utils/execFileNoThrow.ts` (no shell, array args). Do not import
  `node:child_process` elsewhere.
- **Fail without side effects.** On any error, propagate it, clean up the
  workspace, and post nothing.

## Where things live

```
src/
  types.ts           reconciler.ts      runner.ts
  fingerprint.ts     worker.ts          webhook.ts
  config.ts          index.ts
  skills/            adapters/          github/
  queue/             utils/             workspace.ts
tests/               # one *.test.ts per module
skills/              # default + auto-apply review skills
docs/                # this VitePress site (docs/superpowers is internal, excluded)
```

See the [Architecture Overview](/architecture/overview) for how the modules fit
together.

## Before opening a PR

```bash
npm run typecheck && npm test
```

If you change the docs, also run `npm run docs:build` to confirm the site builds
with no dead links. CI (`ci.yml`) runs type-check, tests, and build on every PR.

## Adding an AI adapter

Implement the `AiAdapter` interface, drive your CLI through `execFileNoThrow`,
validate output with `FindingsArraySchema`, and register it in `createAdapter`.
See [Adapters](/architecture/adapters).

## Writing review skills

Skills are Markdown with frontmatter. To add rules globally, drop a file in
`skills/auto-apply/` (with `applies_to` globs) or `skills/defaults/`. See
[Skills](/guide/skills).
