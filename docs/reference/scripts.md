# Scripts

npm scripts defined in `package.json`.

| Script | Command | Purpose |
|---|---|---|
| `npm run dev` | `tsx watch src/index.ts` | Run the server with hot reload |
| `npm run build` | `tsc` | Compile TypeScript to `dist/` |
| `npm start` | `node dist/index.js` | Run the compiled server |
| `npm test` | `vitest run` | Run the full test suite once |
| `npm run typecheck` | `tsc --noEmit` | Type-check without emitting |
| `npm run docs:dev` | `vitepress dev docs` | Serve this documentation site locally |
| `npm run docs:build` | `vitepress build docs` | Build the documentation site |
| `npm run docs:preview` | `vitepress preview docs` | Preview the built docs site |

## Typical loops

**Local development of the service:**

```bash
npm run dev          # hot-reloading server
npm test             # in another terminal
```

**Before opening a PR:**

```bash
npm run typecheck && npm test
```

**Working on the docs:**

```bash
npm run docs:dev     # live preview at the printed localhost URL
npm run docs:build   # verify it builds (no dead links) before pushing
```
