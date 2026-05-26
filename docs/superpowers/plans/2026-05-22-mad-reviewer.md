# mad-reviewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a GitHub App server that auto-reviews PRs across the org's repos with a configurable AI tool, posts inline bug comments, and reconciles its own past comments (resolving bugs that disappeared, re-commenting on ones that reappeared).

**Architecture:** A Node/TypeScript + Probot server receives `pull_request` webhooks and enqueues jobs into an embedded SQLite queue (debounce + one-run-per-PR). A worker drains the queue: it clones the PR head into a tmpdir, loads skills (defaults + glob-selected auto-apply + per-repo override), runs an AI adapter (default `claude -p`) to produce `Finding[]`, computes a deterministic fingerprint per finding, then reconciles against its own active comments on the PR (identified by an embedded fingerprint marker) to create/keep/resolve comments. GitHub is the source of truth for findings; SQLite only holds orchestration state.

**Tech Stack:** Node 22 (ESM), TypeScript (NodeNext), Probot, better-sqlite3, zod, gray-matter, minimatch, vitest.

**Spec:** `docs/superpowers/specs/2026-05-22-mad-reviewer-design.md`

**Note on spec @TODO §6.3 (auto-apply selection):** This plan implements **option (a) — deterministic glob match** via an `applies_to` frontmatter field. Options (b) AI-based and (c) hybrid are out of scope for v1; the `selectAutoApply` function is isolated so they can replace it later.

**Process-injection safety:** All subprocess calls (`git`, the AI CLI) go through one wrapper, `src/utils/execFileNoThrow.ts` (Task 7), which uses `execFile` (no shell) with arguments passed as an array — so user/PR-controlled values can never be interpreted as shell. No other module imports `node:child_process` directly.

**Conventions used throughout:**
- ESM with NodeNext: all relative imports end in `.js`.
- Tests live in `tests/`, named `<module>.test.ts`, run with `npx vitest run <file>`.
- Commit after every green test (Conventional Commits).
- Dependency injection for IO modules so unit tests need no network/git.

---

## Task 0: Project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "mad-reviewer",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx watch src/index.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "better-sqlite3": "^11.8.1",
    "gray-matter": "^4.0.3",
    "minimatch": "^10.0.1",
    "probot": "^13.4.5",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.12",
    "@types/node": "^22.10.5",
    "tsx": "^4.19.2",
    "typescript": "^5.7.3",
    "vitest": "^3.0.4"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 4: Create `.gitignore`**

```gitignore
node_modules/
dist/
data/
*.log
.env
```

- [ ] **Step 5: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, no errors. (If offline, this is the one network step; everything below is local.)

- [ ] **Step 6: Verify typecheck on empty src**

Run: `mkdir -p src && echo 'export {};' > src/_placeholder.ts && npx tsc --noEmit`
Expected: exits 0 (no errors).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore
git commit -m "chore: scaffold mad-reviewer project (TS/ESM, vitest, deps)"
```

---

## Task 1: Shared types & schema (`types.ts`)

**Files:**
- Create: `src/types.ts`
- Test: `tests/types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/types.test.ts
import { describe, it, expect } from "vitest";
import { FindingSchema, FindingsArraySchema } from "../src/types.js";

describe("FindingSchema", () => {
  const valid = {
    file: "src/a.ts",
    line: 12,
    category: "null-safety",
    dedupeKey: "null-safety:UserService.load:user",
    severity: "bug",
    title: "Possible null deref",
    body: "user may be null here",
  };

  it("accepts a valid finding", () => {
    expect(FindingSchema.parse(valid)).toEqual(valid);
  });

  it("rejects severity other than 'bug'", () => {
    expect(() => FindingSchema.parse({ ...valid, severity: "nit" })).toThrow();
  });

  it("rejects line <= 0", () => {
    expect(() => FindingSchema.parse({ ...valid, line: 0 })).toThrow();
  });

  it("parses an array of findings", () => {
    expect(FindingsArraySchema.parse([valid])).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/types.test.ts`
Expected: FAIL — cannot find module `../src/types.js`.

- [ ] **Step 3: Write `src/types.ts`**

```ts
import { z } from "zod";

export const FindingSchema = z.object({
  file: z.string().min(1),
  line: z.number().int().positive(),
  category: z.string().min(1),
  dedupeKey: z.string().min(1),
  severity: z.literal("bug"),
  title: z.string().min(1),
  body: z.string().min(1),
});

export type Finding = z.infer<typeof FindingSchema>;

export const FindingsArraySchema = z.array(FindingSchema);

export interface Job {
  owner: string;
  repo: string;
  pr: number;
  headSha: string;
  baseSha: string;
  installationId: number;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/types.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/types.ts tests/types.test.ts
git commit -m "feat: add Finding zod schema and Job type"
```

---

## Task 2: Fingerprint (`fingerprint.ts`)

The deterministic bug identity (spec A3). `dedupeKey` + file + category → 16-hex hash. Line is NOT part of the hash, so a finding that moves lines keeps its fingerprint.

**Files:**
- Create: `src/fingerprint.ts`
- Test: `tests/fingerprint.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/fingerprint.test.ts
import { describe, it, expect } from "vitest";
import {
  computeFingerprint,
  embedFingerprint,
  parseFingerprint,
} from "../src/fingerprint.js";

const base = {
  file: "src/a.ts",
  category: "null-safety",
  dedupeKey: "null-safety:UserService.load:user",
};

describe("computeFingerprint", () => {
  it("is deterministic for identical input", () => {
    expect(computeFingerprint(base)).toBe(computeFingerprint(base));
  });

  it("ignores casing/whitespace in category and dedupeKey", () => {
    expect(computeFingerprint(base)).toBe(
      computeFingerprint({
        file: "src/a.ts",
        category: "  NULL-SAFETY ",
        dedupeKey: "Null-Safety:UserService.load:user",
      }),
    );
  });

  it("changes when dedupeKey changes", () => {
    expect(computeFingerprint(base)).not.toBe(
      computeFingerprint({ ...base, dedupeKey: "other" }),
    );
  });

  it("returns a 16-char hex string", () => {
    expect(computeFingerprint(base)).toMatch(/^[a-f0-9]{16}$/);
  });
});

describe("embed/parse fingerprint", () => {
  it("round-trips a fingerprint through a comment body", () => {
    const fp = computeFingerprint(base);
    const body = embedFingerprint("Some bug text", fp);
    expect(parseFingerprint(body)).toBe(fp);
  });

  it("returns null when no marker present", () => {
    expect(parseFingerprint("plain human comment")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/fingerprint.test.ts`
Expected: FAIL — cannot find module `../src/fingerprint.js`.

- [ ] **Step 3: Write `src/fingerprint.ts`**

```ts
import { createHash } from "node:crypto";

const MARKER_RE = /<!--\s*mad-reviewer:fp=([a-f0-9]{16})\s*-->/;

export function computeFingerprint(input: {
  file: string;
  category: string;
  dedupeKey: string;
}): string {
  const normalized = [
    input.file.trim(),
    input.category.trim().toLowerCase(),
    input.dedupeKey.trim().toLowerCase(),
  ].join(" ");
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

export function embedFingerprint(body: string, fp: string): string {
  return `${body}\n\n<!-- mad-reviewer:fp=${fp} -->`;
}

export function parseFingerprint(body: string): string | null {
  const m = body.match(MARKER_RE);
  return m ? m[1]! : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/fingerprint.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/fingerprint.ts tests/fingerprint.test.ts
git commit -m "feat: add deterministic fingerprint with comment marker embed/parse"
```

---

## Task 3: Reconciler (`reconciler.ts`)

Pure decision logic (spec §5). Inputs: current findings (with fp) + the bot's **active** (non-resolved) comments. Output: create / keep / resolve actions. Reappearance is handled implicitly — a fingerprint whose only existing comment is resolved is not in `activeComments`, so it produces a `create`.

**Files:**
- Create: `src/reconciler.ts`
- Test: `tests/reconciler.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/reconciler.test.ts
import { describe, it, expect } from "vitest";
import { reconcile, type ActiveComment } from "../src/reconciler.js";
import type { Finding } from "../src/types.js";

function finding(over: Partial<Finding> = {}): Finding {
  return {
    file: "src/a.ts",
    line: 10,
    category: "null-safety",
    dedupeKey: "k",
    severity: "bug",
    title: "t",
    body: "b",
    ...over,
  };
}

describe("reconcile", () => {
  it("creates a comment for a new fingerprint", () => {
    const actions = reconcile(
      [{ finding: finding(), fp: "aaaa000000000000" }],
      [],
    );
    expect(actions).toEqual([
      { type: "create", finding: finding(), fp: "aaaa000000000000" },
    ]);
  });

  it("keeps a fingerprint that already has an active comment", () => {
    const active: ActiveComment[] = [
      { fp: "aaaa000000000000", commentId: 1, threadId: "T1" },
    ];
    const actions = reconcile(
      [{ finding: finding(), fp: "aaaa000000000000" }],
      active,
    );
    expect(actions).toEqual([
      { type: "keep", fp: "aaaa000000000000", commentId: 1 },
    ]);
  });

  it("resolves an active comment whose fingerprint is gone", () => {
    const active: ActiveComment[] = [
      { fp: "bbbb000000000000", commentId: 2, threadId: "T2" },
    ];
    const actions = reconcile([], active);
    expect(actions).toEqual([
      { type: "resolve", fp: "bbbb000000000000", threadId: "T2", commentId: 2 },
    ]);
  });

  it("creates (not keeps) when only a resolved comment exists (reappearance)", () => {
    // resolved comments are NOT passed in activeComments, so fp is treated as new
    const actions = reconcile(
      [{ finding: finding(), fp: "cccc000000000000" }],
      [],
    );
    expect(actions).toEqual([
      { type: "create", finding: finding(), fp: "cccc000000000000" },
    ]);
  });

  it("dedupes repeated fingerprints within a single run", () => {
    const actions = reconcile(
      [
        { finding: finding(), fp: "dddd000000000000" },
        { finding: finding({ title: "dup" }), fp: "dddd000000000000" },
      ],
      [],
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ type: "create", fp: "dddd000000000000" });
  });

  it("handles mixed create/keep/resolve together", () => {
    const active: ActiveComment[] = [
      { fp: "keep000000000000", commentId: 1, threadId: "T1" },
      { fp: "gone000000000000", commentId: 2, threadId: "T2" },
    ];
    const actions = reconcile(
      [
        { finding: finding(), fp: "keep000000000000" },
        { finding: finding(), fp: "new0000000000000" },
      ],
      active,
    );
    expect(actions).toContainEqual({ type: "keep", fp: "keep000000000000", commentId: 1 });
    expect(actions).toContainEqual({ type: "create", finding: finding(), fp: "new0000000000000" });
    expect(actions).toContainEqual({ type: "resolve", fp: "gone000000000000", threadId: "T2", commentId: 2 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/reconciler.test.ts`
Expected: FAIL — cannot find module `../src/reconciler.js`.

- [ ] **Step 3: Write `src/reconciler.ts`**

```ts
import type { Finding } from "./types.js";

export interface ActiveComment {
  fp: string;
  commentId: number;
  threadId: string;
}

export type ReconcileAction =
  | { type: "create"; finding: Finding; fp: string }
  | { type: "keep"; fp: string; commentId: number }
  | { type: "resolve"; fp: string; threadId: string; commentId: number };

export function reconcile(
  current: Array<{ finding: Finding; fp: string }>,
  activeComments: ActiveComment[],
): ReconcileAction[] {
  const activeByFp = new Map(activeComments.map((c) => [c.fp, c] as const));
  const currentFps = new Set(current.map((c) => c.fp));
  const actions: ReconcileAction[] = [];
  const seen = new Set<string>();

  for (const { finding, fp } of current) {
    if (seen.has(fp)) continue;
    seen.add(fp);
    const existing = activeByFp.get(fp);
    if (existing) {
      actions.push({ type: "keep", fp, commentId: existing.commentId });
    } else {
      actions.push({ type: "create", finding, fp });
    }
  }

  for (const c of activeComments) {
    if (!currentFps.has(c.fp)) {
      actions.push({ type: "resolve", fp: c.fp, threadId: c.threadId, commentId: c.commentId });
    }
  }

  return actions;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/reconciler.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/reconciler.ts tests/reconciler.test.ts
git commit -m "feat: add reconciler (create/keep/resolve, dedupe, reappearance)"
```

---

## Task 4: Auto-apply selection (`skills/autoApply.ts`)

Deterministic glob match (resolves spec @TODO §6.3 with option a). A skill is selected if any of its `applies_to` globs matches any changed file.

**Files:**
- Create: `src/skills/autoApply.ts`
- Test: `tests/autoApply.test.ts`

> Cross-task note: this imports the `Skill` type from `loader.ts` (Task 5). It is a type-only import — no runtime cycle. Run this task's test together with Task 5 (Task 5 Step 4 runs both).

- [ ] **Step 1: Write the failing test**

```ts
// tests/autoApply.test.ts
import { describe, it, expect } from "vitest";
import { selectAutoApply } from "../src/skills/autoApply.js";
import type { Skill } from "../src/skills/loader.js";

function skill(name: string, appliesTo?: string[]): Skill {
  return { name, description: "", appliesTo, body: "", raw: "" };
}

describe("selectAutoApply", () => {
  it("selects a skill whose glob matches a changed file", () => {
    const all = [skill("sql", ["**/*.sql"]), skill("react", ["**/*.tsx"])];
    const result = selectAutoApply(all, ["db/migrations/001.sql"]);
    expect(result.map((s) => s.name)).toEqual(["sql"]);
  });

  it("does not select a skill with no matching glob", () => {
    const all = [skill("react", ["**/*.tsx"])];
    expect(selectAutoApply(all, ["server.py"])).toEqual([]);
  });

  it("ignores skills without applies_to", () => {
    const all = [skill("nomatch", undefined), skill("empty", [])];
    expect(selectAutoApply(all, ["any.sql"])).toEqual([]);
  });

  it("selects multiple skills when several match", () => {
    const all = [skill("sql", ["**/*.sql"]), skill("docker", ["**/Dockerfile"])];
    const result = selectAutoApply(all, ["x.sql", "ops/Dockerfile"]);
    expect(result.map((s) => s.name).sort()).toEqual(["docker", "sql"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/autoApply.test.ts`
Expected: FAIL — cannot find module `../src/skills/loader.js` / `../src/skills/autoApply.js`.

- [ ] **Step 3: Write `src/skills/autoApply.ts`**

```ts
import { minimatch } from "minimatch";
import type { Skill } from "./loader.js";

export function selectAutoApply(all: Skill[], changedFiles: string[]): Skill[] {
  return all.filter((s) => {
    if (!s.appliesTo || s.appliesTo.length === 0) return false;
    return s.appliesTo.some((pattern) =>
      changedFiles.some((file) => minimatch(file, pattern, { dot: true })),
    );
  });
}
```

- [ ] **Step 4: Defer running until Task 5 creates `loader.ts`** (Task 5 Step 4 runs both tests).

- [ ] **Step 5: Commit**

```bash
git add src/skills/autoApply.ts tests/autoApply.test.ts
git commit -m "feat: add deterministic glob-based auto-apply skill selection"
```

---

## Task 5: Skills loader (`skills/loader.ts`)

Three tiers (spec §6.1): always-on defaults, glob-selected auto-apply, per-repo override read from the cloned workspace. `output-contract` is protected from override.

**Files:**
- Create: `src/skills/loader.ts`
- Test: `tests/loader.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/loader.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadSkills } from "../src/skills/loader.js";

let root: string;
let defaultsDir: string;
let autoApplyDir: string;
let workspaceDir: string;

async function writeSkill(dir: string, name: string, frontmatter: string, body: string) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${name}.md`), `---\n${frontmatter}\n---\n${body}\n`, "utf8");
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "skills-test-"));
  defaultsDir = path.join(root, "defaults");
  autoApplyDir = path.join(root, "auto-apply");
  workspaceDir = path.join(root, "workspace");
  await fs.mkdir(workspaceDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("loadSkills", () => {
  it("always loads defaults", async () => {
    await writeSkill(defaultsDir, "null-safety", "description: nulls", "check nulls");
    await writeSkill(defaultsDir, "output-contract", "description: out", "emit JSON");
    const eff = await loadSkills({ defaultsDir, autoApplyDir, workspaceDir, changedFiles: [] });
    expect(eff.skills.map((s) => s.name).sort()).toEqual(["null-safety", "output-contract"]);
  });

  it("includes auto-apply skills whose glob matches", async () => {
    await writeSkill(defaultsDir, "null-safety", "description: nulls", "x");
    await writeSkill(autoApplyDir, "sql", 'description: sql\napplies_to:\n  - "**/*.sql"', "sql rules");
    const eff = await loadSkills({
      defaultsDir, autoApplyDir, workspaceDir, changedFiles: ["db/001.sql"],
    });
    expect(eff.skills.map((s) => s.name).sort()).toEqual(["null-safety", "sql"]);
  });

  it("lets a repo override a default skill of the same name", async () => {
    await writeSkill(defaultsDir, "null-safety", "description: default", "default body");
    await writeSkill(path.join(workspaceDir, ".mad-reviewer", "skills"), "null-safety", "description: repo", "repo body");
    const eff = await loadSkills({ defaultsDir, autoApplyDir, workspaceDir, changedFiles: [] });
    const skill = eff.skills.find((s) => s.name === "null-safety");
    expect(skill?.body.trim()).toBe("repo body");
  });

  it("does NOT let a repo override output-contract", async () => {
    await writeSkill(defaultsDir, "output-contract", "description: default", "default contract");
    await writeSkill(path.join(workspaceDir, ".mad-reviewer", "skills"), "output-contract", "description: evil", "evil contract");
    const eff = await loadSkills({ defaultsDir, autoApplyDir, workspaceDir, changedFiles: [] });
    const skill = eff.skills.find((s) => s.name === "output-contract");
    expect(skill?.body.trim()).toBe("default contract");
  });

  it("adds a brand-new repo skill", async () => {
    await writeSkill(defaultsDir, "null-safety", "description: d", "d");
    await writeSkill(path.join(workspaceDir, ".mad-reviewer", "skills"), "company-style", "description: c", "c");
    const eff = await loadSkills({ defaultsDir, autoApplyDir, workspaceDir, changedFiles: [] });
    expect(eff.skills.map((s) => s.name).sort()).toEqual(["company-style", "null-safety"]);
  });

  it("tolerates a missing auto-apply or override directory", async () => {
    await writeSkill(defaultsDir, "null-safety", "description: d", "d");
    const eff = await loadSkills({ defaultsDir, autoApplyDir, workspaceDir, changedFiles: [] });
    expect(eff.skills.map((s) => s.name)).toEqual(["null-safety"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/loader.test.ts`
Expected: FAIL — cannot find module `../src/skills/loader.js`.

- [ ] **Step 3: Write `src/skills/loader.ts`**

```ts
import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { selectAutoApply } from "./autoApply.js";

export interface Skill {
  name: string;
  description: string;
  appliesTo?: string[];
  body: string;
  raw: string;
}

export interface EffectiveSkills {
  skills: Skill[];
}

const PROTECTED = new Set(["output-contract"]);

async function readSkillsDir(dir: string): Promise<Skill[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const skills: Skill[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const raw = await fs.readFile(path.join(dir, entry), "utf8");
    const parsed = matter(raw);
    const appliesTo = Array.isArray(parsed.data.applies_to)
      ? (parsed.data.applies_to as string[])
      : undefined;
    skills.push({
      name: entry.replace(/\.md$/, ""),
      description: typeof parsed.data.description === "string" ? parsed.data.description : "",
      appliesTo,
      body: parsed.content,
      raw,
    });
  }
  return skills;
}

export async function loadSkills(opts: {
  defaultsDir: string;
  autoApplyDir: string;
  workspaceDir: string;
  changedFiles: string[];
}): Promise<EffectiveSkills> {
  const defaults = await readSkillsDir(opts.defaultsDir);
  const autoAll = await readSkillsDir(opts.autoApplyDir);
  const auto = selectAutoApply(autoAll, opts.changedFiles);
  const overrides = await readSkillsDir(
    path.join(opts.workspaceDir, ".mad-reviewer", "skills"),
  );

  const byName = new Map<string, Skill>();
  for (const s of [...defaults, ...auto]) byName.set(s.name, s);
  for (const s of overrides) {
    if (PROTECTED.has(s.name)) continue;
    byName.set(s.name, s);
  }
  return { skills: [...byName.values()] };
}
```

- [ ] **Step 4: Run both skills tests to verify they pass**

Run: `npx vitest run tests/loader.test.ts tests/autoApply.test.ts`
Expected: PASS (loader 6 + autoApply 4 = 10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/skills/loader.ts tests/loader.test.ts
git commit -m "feat: add 3-tier skills loader with protected output-contract"
```

---

## Task 6: Adapter output parser (`adapters/parse.ts`)

Extract a JSON `Finding[]` from raw model output (handles code fences and surrounding prose).

**Files:**
- Create: `src/adapters/parse.ts`
- Test: `tests/parse.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/parse.test.ts
import { describe, it, expect } from "vitest";
import { extractFindingsJson } from "../src/adapters/parse.js";

describe("extractFindingsJson", () => {
  it("parses a bare JSON array", () => {
    expect(extractFindingsJson('[{"a":1}]')).toEqual([{ a: 1 }]);
  });

  it("parses a fenced ```json block", () => {
    const text = "Here you go:\n```json\n[{\"a\":2}]\n```\nthanks";
    expect(extractFindingsJson(text)).toEqual([{ a: 2 }]);
  });

  it("parses an array embedded in prose", () => {
    expect(extractFindingsJson('prefix [{"a":3}] suffix')).toEqual([{ a: 3 }]);
  });

  it("parses an empty array", () => {
    expect(extractFindingsJson("[]")).toEqual([]);
  });

  it("throws when no array is present", () => {
    expect(() => extractFindingsJson("no json here")).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/parse.test.ts`
Expected: FAIL — cannot find module `../src/adapters/parse.js`.

- [ ] **Step 3: Write `src/adapters/parse.ts`**

```ts
export function extractFindingsJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1]! : text;
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("no JSON array found in adapter output");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/parse.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/adapters/parse.ts tests/parse.test.ts
git commit -m "feat: add adapter output JSON extractor"
```

---

## Task 7: Safe subprocess utility (`utils/execFileNoThrow.ts`)

The single place that touches `node:child_process`. Uses `execFile` (no shell), args as an array, never throws — returns `{ stdout, stderr, status }`. Callers decide whether a nonzero status is fatal. This prevents command injection from PR/branch/sha values passed to `git`.

**Files:**
- Create: `src/utils/execFileNoThrow.ts`
- Test: `tests/execFileNoThrow.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/execFileNoThrow.test.ts
import { describe, it, expect } from "vitest";
import { execFileNoThrow } from "../src/utils/execFileNoThrow.js";

describe("execFileNoThrow", () => {
  it("returns stdout and status 0 on success", async () => {
    const r = await execFileNoThrow("node", ["-e", "process.stdout.write('hi')"]);
    expect(r.stdout).toBe("hi");
    expect(r.status).toBe(0);
  });

  it("returns a nonzero status without throwing on failure", async () => {
    const r = await execFileNoThrow("node", ["-e", "process.exit(3)"]);
    expect(r.status).toBe(3);
  });

  it("does not invoke a shell (args are literal, not interpreted)", async () => {
    const r = await execFileNoThrow("node", [
      "-e",
      "process.stdout.write(process.argv[1] || '')",
      "a;b",
    ]);
    expect(r.stdout).toBe("a;b");
    expect(r.status).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/execFileNoThrow.test.ts`
Expected: FAIL — cannot find module `../src/utils/execFileNoThrow.js`.

- [ ] **Step 3: Write `src/utils/execFileNoThrow.ts`**

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface ExecResult {
  stdout: string;
  stderr: string;
  status: number;
}

export interface ExecOpts {
  cwd?: string;
  timeout?: number;
  maxBuffer?: number;
}

export async function execFileNoThrow(
  file: string,
  args: string[],
  opts: ExecOpts = {},
): Promise<ExecResult> {
  try {
    const { stdout, stderr } = await run(file, args, {
      cwd: opts.cwd,
      timeout: opts.timeout,
      maxBuffer: opts.maxBuffer ?? 64 * 1024 * 1024,
    });
    return { stdout: stdout.toString(), stderr: stderr.toString(), status: 0 };
  } catch (err) {
    const e = err as { stdout?: string | Buffer; stderr?: string | Buffer; code?: number };
    return {
      stdout: e.stdout ? e.stdout.toString() : "",
      stderr: e.stderr ? e.stderr.toString() : String(err),
      status: typeof e.code === "number" ? e.code : 1,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/execFileNoThrow.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/execFileNoThrow.ts tests/execFileNoThrow.test.ts
git commit -m "feat: add execFileNoThrow safe subprocess wrapper (no shell)"
```

---

## Task 8: Adapter interface + Claude adapter (`adapters/`)

**Files:**
- Create: `src/adapters/types.ts`
- Create: `src/adapters/claude.ts`
- Create: `src/adapters/index.ts`
- Test: `tests/claudeAdapter.test.ts`

- [ ] **Step 1: Write `src/adapters/types.ts`** (no test needed — pure interface)

```ts
import type { Finding } from "../types.js";
import type { EffectiveSkills } from "../skills/loader.js";

export interface ReviewInput {
  workspaceDir: string;
  changedFiles: string[];
  diff: string;
  skills: EffectiveSkills;
}

export interface AiAdapter {
  name: string;
  review(input: ReviewInput): Promise<Finding[]>;
}
```

- [ ] **Step 2: Write the failing test** (inject a fake CLI runner so no real `claude` call)

```ts
// tests/claudeAdapter.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ClaudeAdapter } from "../src/adapters/claude.js";
import type { EffectiveSkills } from "../src/skills/loader.js";

let workspaceDir: string;

const skills: EffectiveSkills = {
  skills: [{ name: "null-safety", description: "", body: "x", raw: "---\n---\nx" }],
};

beforeEach(async () => {
  workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-adapter-"));
});
afterEach(async () => {
  await fs.rm(workspaceDir, { recursive: true, force: true });
});

describe("ClaudeAdapter", () => {
  it("installs skills into .claude/skills and parses findings from CLI output", async () => {
    const finding = {
      file: "src/a.ts", line: 5, category: "null-safety",
      dedupeKey: "k", severity: "bug", title: "t", body: "b",
    };
    const fakeRun = async () => ({
      stdout: JSON.stringify({ result: JSON.stringify([finding]) }), stderr: "", status: 0,
    });
    const adapter = new ClaudeAdapter({ timeoutMs: 1000, run: fakeRun });

    const result = await adapter.review({
      workspaceDir, changedFiles: ["src/a.ts"], diff: "diff", skills,
    });

    expect(result).toEqual([finding]);
    const written = await fs.readFile(
      path.join(workspaceDir, ".claude", "skills", "null-safety.md"), "utf8",
    );
    expect(written).toContain("x");
  });

  it("throws when the CLI exits nonzero", async () => {
    const fakeRun = async () => ({ stdout: "", stderr: "boom", status: 1 });
    const adapter = new ClaudeAdapter({ timeoutMs: 1000, run: fakeRun });
    await expect(
      adapter.review({ workspaceDir, changedFiles: [], diff: "", skills }),
    ).rejects.toThrow();
  });

  it("throws when CLI output is not valid findings JSON", async () => {
    const fakeRun = async () => ({ stdout: JSON.stringify({ result: "no json" }), stderr: "", status: 0 });
    const adapter = new ClaudeAdapter({ timeoutMs: 1000, run: fakeRun });
    await expect(
      adapter.review({ workspaceDir, changedFiles: [], diff: "", skills }),
    ).rejects.toThrow();
  });

  it("rejects findings that violate the schema", async () => {
    const bad = [{ file: "a", line: 0, category: "c", dedupeKey: "k", severity: "bug", title: "t", body: "b" }];
    const fakeRun = async () => ({ stdout: JSON.stringify({ result: JSON.stringify(bad) }), stderr: "", status: 0 });
    const adapter = new ClaudeAdapter({ timeoutMs: 1000, run: fakeRun });
    await expect(
      adapter.review({ workspaceDir, changedFiles: [], diff: "", skills }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/claudeAdapter.test.ts`
Expected: FAIL — cannot find module `../src/adapters/claude.js`.

- [ ] **Step 4: Write `src/adapters/claude.ts`**

```ts
import { promises as fs } from "node:fs";
import path from "node:path";
import type { AiAdapter, ReviewInput } from "./types.js";
import { FindingsArraySchema, type Finding } from "../types.js";
import { extractFindingsJson } from "./parse.js";
import { execFileNoThrow, type ExecResult, type ExecOpts } from "../utils/execFileNoThrow.js";

export type CliRunner = (file: string, args: string[], opts: ExecOpts) => Promise<ExecResult>;

export class ClaudeAdapter implements AiAdapter {
  name = "claude";
  private timeoutMs: number;
  private run: CliRunner;

  constructor(opts: { timeoutMs: number; run?: CliRunner }) {
    this.timeoutMs = opts.timeoutMs;
    this.run = opts.run ?? execFileNoThrow;
  }

  async review(input: ReviewInput): Promise<Finding[]> {
    await this.installSkills(input);
    const prompt = buildPrompt(input);
    const res = await this.run("claude", ["-p", prompt, "--output-format", "json"], {
      cwd: input.workspaceDir,
      timeout: this.timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (res.status !== 0) {
      throw new Error(`claude exited with status ${res.status}: ${res.stderr}`);
    }
    const outer = JSON.parse(res.stdout) as { result?: unknown };
    const text = typeof outer.result === "string" ? outer.result : res.stdout;
    const findings = extractFindingsJson(text);
    return FindingsArraySchema.parse(findings);
  }

  private async installSkills(input: ReviewInput): Promise<void> {
    const dir = path.join(input.workspaceDir, ".claude", "skills");
    await fs.mkdir(dir, { recursive: true });
    for (const s of input.skills.skills) {
      await fs.writeFile(path.join(dir, `${s.name}.md`), s.raw, "utf8");
    }
  }
}

function buildPrompt(input: ReviewInput): string {
  return [
    "Review the changed files in this PR for bugs using the skills loaded in .claude/skills.",
    "Only report real bugs (correctness, security, logic). No style or nitpicks.",
    "Changed files:",
    input.changedFiles.map((f) => `- ${f}`).join("\n"),
    "",
    "Diff:",
    "```diff",
    input.diff,
    "```",
    "",
    "Output ONLY a JSON array of findings exactly as specified by the output-contract skill. No prose.",
  ].join("\n");
}
```

- [ ] **Step 5: Write `src/adapters/index.ts`**

```ts
import type { AiAdapter } from "./types.js";
import { ClaudeAdapter } from "./claude.js";

export function createAdapter(name: string, opts: { timeoutMs: number }): AiAdapter {
  switch (name) {
    case "claude":
      return new ClaudeAdapter({ timeoutMs: opts.timeoutMs });
    default:
      throw new Error(`unknown adapter: ${name} (supported: claude)`);
  }
}
```

> `cursor` and `opencode` adapters are out of scope for v1. Add new classes implementing `AiAdapter` (driven through `execFileNoThrow`) and register them in this switch when needed — no other code changes required.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/claudeAdapter.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add src/adapters/types.ts src/adapters/claude.ts src/adapters/index.ts tests/claudeAdapter.test.ts
git commit -m "feat: add AiAdapter interface and Claude adapter via safe runner"
```

---

## Task 9: SQLite queue (`queue/queue.ts`)

Orchestration only (spec §3.1, §10). One row per PR; debounce via `run_after`; one-run-per-PR via `status`; `last_processed_sha` skips redundant runs; survives restart.

**Files:**
- Create: `src/queue/queue.ts`
- Test: `tests/queue.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/queue.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Queue, type QueueJob } from "../src/queue/queue.js";

let dir: string;
let dbPath: string;

const job: QueueJob = {
  owner: "o", repo: "r", pr: 1, headSha: "sha1", baseSha: "base1", installationId: 99,
};

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "queue-test-"));
  dbPath = path.join(dir, "queue.db");
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("Queue", () => {
  it("does not surface a job before its debounce window elapses", () => {
    const q = new Queue(dbPath, 1000);
    q.enqueue(job, 0);
    expect(q.claimNext(500)).toBeNull();      // within debounce
    expect(q.claimNext(1000)).not.toBeNull(); // window elapsed
    q.close();
  });

  it("coalesces a burst of pushes into one pending job", () => {
    const q = new Queue(dbPath, 1000);
    q.enqueue({ ...job, headSha: "shaA" }, 0);
    q.enqueue({ ...job, headSha: "shaB" }, 200); // resets debounce, updates sha
    expect(q.claimNext(1000)).toBeNull();        // 200 + 1000 = 1200 not yet
    const claimed = q.claimNext(1200);
    expect(claimed?.headSha).toBe("shaB");
    q.close();
  });

  it("runs only one job per PR at a time (claim marks it running)", () => {
    const q = new Queue(dbPath, 0);
    q.enqueue(job, 0);
    expect(q.claimNext(0)).not.toBeNull();
    expect(q.claimNext(0)).toBeNull(); // already running, not re-claimable
    q.close();
  });

  it("skips enqueue when headSha equals last_processed_sha", () => {
    const q = new Queue(dbPath, 0);
    q.enqueue(job, 0);
    const claimed = q.claimNext(0)!;
    q.complete(claimed, 0);
    expect(q.enqueue({ ...job, headSha: "sha1" }, 1)).toBe(false); // same sha → skip
    expect(q.enqueue({ ...job, headSha: "sha2" }, 2)).toBe(true);  // new sha → enqueue
    q.close();
  });

  it("survives a restart (reopens the same db file)", () => {
    const q1 = new Queue(dbPath, 0);
    q1.enqueue(job, 0);
    q1.close();
    const q2 = new Queue(dbPath, 0);
    expect(q2.claimNext(0)?.headSha).toBe("sha1");
    q2.close();
  });

  it("re-queues on fail until max retries, then marks failed", () => {
    const q = new Queue(dbPath, 0);
    q.enqueue(job, 0);
    let claimed = q.claimNext(0)!;
    q.fail(claimed, 2, 0);                 // attempt 1 → pending again
    claimed = q.claimNext(0)!;
    expect(claimed.headSha).toBe("sha1");
    q.fail(claimed, 2, 0);                 // attempt 2 → failed
    expect(q.claimNext(0)).toBeNull();     // no longer pending
    q.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/queue.test.ts`
Expected: FAIL — cannot find module `../src/queue/queue.js`.

- [ ] **Step 3: Write `src/queue/queue.ts`**

```ts
import Database from "better-sqlite3";

export interface QueueJob {
  owner: string;
  repo: string;
  pr: number;
  headSha: string;
  baseSha: string;
  installationId: number;
}

export class Queue {
  private db: Database.Database;

  constructor(dbPath: string, private debounceMs: number) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        owner TEXT NOT NULL,
        repo TEXT NOT NULL,
        pr INTEGER NOT NULL,
        head_sha TEXT NOT NULL,
        base_sha TEXT NOT NULL,
        installation_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'idle',
        run_after INTEGER NOT NULL DEFAULT 0,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_processed_sha TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (owner, repo, pr)
      );
    `);
  }

  enqueue(job: QueueJob, now: number = Date.now()): boolean {
    const row = this.db
      .prepare(`SELECT last_processed_sha AS lps FROM jobs WHERE owner=? AND repo=? AND pr=?`)
      .get(job.owner, job.repo, job.pr) as { lps: string | null } | undefined;
    if (row && row.lps === job.headSha) return false;

    this.db
      .prepare(`
        INSERT INTO jobs (owner, repo, pr, head_sha, base_sha, installation_id, status, run_after, attempts, updated_at)
        VALUES (@owner, @repo, @pr, @headSha, @baseSha, @installationId, 'pending', @runAfter, 0, @now)
        ON CONFLICT(owner, repo, pr) DO UPDATE SET
          head_sha=@headSha, base_sha=@baseSha, installation_id=@installationId,
          status='pending', run_after=@runAfter, attempts=0, updated_at=@now
      `)
      .run({ ...job, runAfter: now + this.debounceMs, now });
    return true;
  }

  claimNext(now: number = Date.now()): QueueJob | null {
    const row = this.db
      .prepare(`
        SELECT owner, repo, pr,
               head_sha AS headSha, base_sha AS baseSha, installation_id AS installationId
        FROM jobs
        WHERE status='pending' AND run_after<=?
        ORDER BY run_after ASC LIMIT 1
      `)
      .get(now) as QueueJob | undefined;
    if (!row) return null;
    this.db
      .prepare(`UPDATE jobs SET status='running', updated_at=? WHERE owner=? AND repo=? AND pr=?`)
      .run(now, row.owner, row.repo, row.pr);
    return row;
  }

  complete(job: QueueJob, now: number = Date.now()): void {
    this.db
      .prepare(`
        UPDATE jobs SET status='idle', last_processed_sha=?, updated_at=?
        WHERE owner=? AND repo=? AND pr=?
      `)
      .run(job.headSha, now, job.owner, job.repo, job.pr);
  }

  fail(job: QueueJob, maxRetries: number, now: number = Date.now()): void {
    const row = this.db
      .prepare(`SELECT attempts FROM jobs WHERE owner=? AND repo=? AND pr=?`)
      .get(job.owner, job.repo, job.pr) as { attempts: number } | undefined;
    const attempts = (row?.attempts ?? 0) + 1;
    const status = attempts >= maxRetries ? "failed" : "pending";
    this.db
      .prepare(`
        UPDATE jobs SET status=?, attempts=?, run_after=?, updated_at=?
        WHERE owner=? AND repo=? AND pr=?
      `)
      .run(status, attempts, now, now, job.owner, job.repo, job.pr);
  }

  close(): void {
    this.db.close();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/queue.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/queue/queue.ts tests/queue.test.ts
git commit -m "feat: add SQLite orchestration queue (debounce, lock, retry, last-sha skip)"
```

---

## Task 10: GitHub comments client (`github/comments.ts`)

Wraps Octokit REST + GraphQL (spec §3.1 #9, §5). Identity = our embedded fingerprint marker (not login), so it is robust regardless of the App's bot name. A minimal structural `GitHubClient` interface keeps it unit-testable with a fake.

**Files:**
- Create: `src/github/comments.ts`
- Test: `tests/comments.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/comments.test.ts
import { describe, it, expect, vi } from "vitest";
import {
  listActiveBotComments,
  resolveWithReply,
  postInlineFinding,
  type GitHubClient,
} from "../src/github/comments.js";
import { embedFingerprint } from "../src/fingerprint.js";

function clientWithThreads(threads: unknown): GitHubClient {
  return {
    graphql: vi.fn(async () => ({
      repository: { pullRequest: { reviewThreads: { nodes: threads, pageInfo: { hasNextPage: false, endCursor: null } } } },
    })),
    rest: {
      pulls: {
        createReviewComment: vi.fn(async () => ({})),
        createReplyForReviewComment: vi.fn(async () => ({})),
      },
      issues: { createComment: vi.fn(async () => ({})) },
    },
  } as unknown as GitHubClient;
}

describe("listActiveBotComments", () => {
  it("returns only non-resolved threads that contain a fingerprinted comment", async () => {
    const fpBody = embedFingerprint("bug", "aaaa000000000000");
    const client = clientWithThreads([
      { id: "T1", isResolved: false, comments: { nodes: [{ databaseId: 11, body: fpBody }] } },
      { id: "T2", isResolved: true, comments: { nodes: [{ databaseId: 22, body: embedFingerprint("x", "bbbb000000000000") }] } },
      { id: "T3", isResolved: false, comments: { nodes: [{ databaseId: 33, body: "human comment" }] } },
    ]);
    const result = await listActiveBotComments(client, "o", "r", 1);
    expect(result).toEqual([{ fp: "aaaa000000000000", commentId: 11, threadId: "T1" }]);
  });
});

describe("resolveWithReply", () => {
  it("posts a reply then resolves the thread", async () => {
    const client = clientWithThreads([]);
    await resolveWithReply(client, "o", "r", 1, { commentId: 11, threadId: "T1", commitSha: "abc1234" });
    expect(client.rest.pulls.createReplyForReviewComment).toHaveBeenCalledWith(
      expect.objectContaining({ owner: "o", repo: "r", pull_number: 1, comment_id: 11 }),
    );
    expect(client.graphql).toHaveBeenCalledWith(
      expect.stringContaining("resolveReviewThread"),
      { threadId: "T1" },
    );
  });
});

describe("postInlineFinding", () => {
  it("creates a review comment with the fingerprint embedded", async () => {
    const client = clientWithThreads([]);
    const finding = { file: "src/a.ts", line: 7, category: "c", dedupeKey: "k", severity: "bug", title: "t", body: "b" } as const;
    await postInlineFinding(client, "o", "r", 1, "abc1234", finding, "ffff000000000000");
    expect(client.rest.pulls.createReviewComment).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "o", repo: "r", pull_number: 1, commit_id: "abc1234",
        path: "src/a.ts", line: 7, side: "RIGHT",
        body: expect.stringContaining("mad-reviewer:fp=ffff000000000000"),
      }),
    );
  });

  it("falls back to a conversation comment when the inline anchor is rejected", async () => {
    const client = clientWithThreads([]);
    (client.rest.pulls.createReviewComment as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("invalid line"));
    const finding = { file: "src/a.ts", line: 7, category: "c", dedupeKey: "k", severity: "bug", title: "t", body: "b" } as const;
    await postInlineFinding(client, "o", "r", 1, "abc1234", finding, "ffff000000000000");
    expect(client.rest.issues.createComment).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "o", repo: "r", issue_number: 1,
        body: expect.stringContaining("mad-reviewer:fp=ffff000000000000"),
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/comments.test.ts`
Expected: FAIL — cannot find module `../src/github/comments.js`.

- [ ] **Step 3: Write `src/github/comments.ts`**

```ts
import { parseFingerprint, embedFingerprint } from "../fingerprint.js";
import type { ActiveComment } from "../reconciler.js";
import type { Finding } from "../types.js";

export interface GitHubClient {
  graphql: (query: string, vars?: Record<string, unknown>) => Promise<any>;
  rest: {
    pulls: {
      createReviewComment: (params: Record<string, unknown>) => Promise<unknown>;
      createReplyForReviewComment: (params: Record<string, unknown>) => Promise<unknown>;
    };
    issues: {
      createComment: (params: Record<string, unknown>) => Promise<unknown>;
    };
  };
}

const THREADS_QUERY = `
query($owner:String!,$repo:String!,$pr:Int!,$cursor:String){
  repository(owner:$owner,name:$repo){
    pullRequest(number:$pr){
      reviewThreads(first:100,after:$cursor){
        nodes{ id isResolved comments(first:50){ nodes{ databaseId body } } }
        pageInfo{ hasNextPage endCursor }
      }
    }
  }
}`;

const RESOLVE_MUTATION = `
mutation($threadId:ID!){
  resolveReviewThread(input:{threadId:$threadId}){ thread{ isResolved } }
}`;

interface ThreadNode {
  id: string;
  isResolved: boolean;
  comments: { nodes: Array<{ databaseId: number; body: string }> };
}

export async function listActiveBotComments(
  client: GitHubClient,
  owner: string,
  repo: string,
  pr: number,
): Promise<ActiveComment[]> {
  const out: ActiveComment[] = [];
  let cursor: string | null = null;
  do {
    const data = await client.graphql(THREADS_QUERY, { owner, repo, pr, cursor });
    const threads = data.repository.pullRequest.reviewThreads;
    for (const thread of threads.nodes as ThreadNode[]) {
      if (thread.isResolved) continue;
      for (const c of thread.comments.nodes) {
        const fp = parseFingerprint(c.body);
        if (fp) {
          out.push({ fp, commentId: c.databaseId, threadId: thread.id });
          break;
        }
      }
    }
    cursor = threads.pageInfo.hasNextPage ? threads.pageInfo.endCursor : null;
  } while (cursor);
  return out;
}

export async function postInlineFinding(
  client: GitHubClient,
  owner: string,
  repo: string,
  pr: number,
  commitSha: string,
  finding: Finding,
  fp: string,
): Promise<void> {
  const inlineBody = embedFingerprint(`**${finding.title}**\n\n${finding.body}`, fp);
  try {
    await client.rest.pulls.createReviewComment({
      owner, repo, pull_number: pr, commit_id: commitSha,
      path: finding.file, line: finding.line, side: "RIGHT", body: inlineBody,
    });
  } catch {
    const fallbackBody = embedFingerprint(
      `**${finding.title}** (in \`${finding.file}\`)\n\n${finding.body}`,
      fp,
    );
    await client.rest.issues.createComment({
      owner, repo, issue_number: pr, body: fallbackBody,
    });
  }
}

export async function resolveWithReply(
  client: GitHubClient,
  owner: string,
  repo: string,
  pr: number,
  args: { commentId: number; threadId: string; commitSha: string },
): Promise<void> {
  await client.rest.pulls.createReplyForReviewComment({
    owner, repo, pull_number: pr, comment_id: args.commentId,
    body: `Resolvido automaticamente nesta revisão (commit ${args.commitSha.slice(0, 7)}).`,
  });
  await client.graphql(RESOLVE_MUTATION, { threadId: args.threadId });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/comments.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/github/comments.ts tests/comments.test.ts
git commit -m "feat: add GitHub comments client (list active by fp, post inline, resolve+reply)"
```

---

## Task 11: Workspace clone + diff (`workspace.ts`)

Clones the PR head and base shas (shallow) into a tmpdir via the safe runner and produces the diff + changed-file list (spec §3.1 #4, §4).

**Files:**
- Create: `src/workspace.ts`
- Test: `tests/workspace.test.ts`

- [ ] **Step 1: Write the failing test** (pure parser; clone/diff covered by the e2e test in Task 18, kept out of unit CI)

```ts
// tests/workspace.test.ts
import { describe, it, expect } from "vitest";
import { parseChangedFiles } from "../src/workspace.js";

describe("parseChangedFiles", () => {
  it("splits newline-separated paths and drops blanks", () => {
    expect(parseChangedFiles("src/a.ts\nsrc/b.ts\n\n")).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("returns [] for empty output", () => {
    expect(parseChangedFiles("")).toEqual([]);
    expect(parseChangedFiles("\n")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/workspace.test.ts`
Expected: FAIL — cannot find module `../src/workspace.js`.

- [ ] **Step 3: Write `src/workspace.ts`**

```ts
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileNoThrow } from "./utils/execFileNoThrow.js";

const MAX_BUFFER = 64 * 1024 * 1024;

export interface Workspace {
  dir: string;
  cleanup(): Promise<void>;
}

export function parseChangedFiles(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function git(dir: string, args: string[]): Promise<string> {
  const r = await execFileNoThrow("git", args, { cwd: dir, maxBuffer: MAX_BUFFER });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed (status ${r.status}): ${r.stderr}`);
  }
  return r.stdout;
}

export async function clonePrHead(opts: {
  owner: string;
  repo: string;
  headSha: string;
  baseSha: string;
  token: string;
}): Promise<Workspace> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mad-reviewer-"));
  const url = `https://x-access-token:${opts.token}@github.com/${opts.owner}/${opts.repo}.git`;
  try {
    await git(dir, ["init", "-q"]);
    await git(dir, ["remote", "add", "origin", url]);
    await git(dir, ["fetch", "-q", "--depth", "1", "origin", opts.headSha]);
    await git(dir, ["checkout", "-q", opts.headSha]);
    await git(dir, ["fetch", "-q", "--depth", "1", "origin", opts.baseSha]);
  } catch (err) {
    await fs.rm(dir, { recursive: true, force: true });
    throw err;
  }
  return {
    dir,
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

export async function computeDiff(
  dir: string,
  baseSha: string,
): Promise<{ diff: string; changedFiles: string[] }> {
  const diff = await git(dir, ["diff", `${baseSha}..HEAD`]);
  const names = await git(dir, ["diff", "--name-only", `${baseSha}..HEAD`]);
  return { diff, changedFiles: parseChangedFiles(names) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/workspace.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/workspace.ts tests/workspace.test.ts
git commit -m "feat: add PR workspace clone and diff helpers via safe runner"
```

---

## Task 12: Runner (`runner.ts`)

Orchestrates one review (spec §4). All IO is injected so it is unit-testable end-to-end with fakes. Workspace cleanup always runs (`finally`); any error propagates so the worker can fail/retry without posting partial junk.

**Files:**
- Create: `src/runner.ts`
- Test: `tests/runner.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/runner.test.ts
import { describe, it, expect, vi } from "vitest";
import { runReview, type RunnerDeps } from "../src/runner.js";
import type { Job } from "../src/types.js";
import { computeFingerprint } from "../src/fingerprint.js";

const job: Job = { owner: "o", repo: "r", pr: 1, headSha: "head1", baseSha: "base1", installationId: 5 };

function makeDeps(over: Partial<RunnerDeps> = {}): RunnerDeps {
  const finding = { file: "src/a.ts", line: 3, category: "null-safety", dedupeKey: "k", severity: "bug" as const, title: "t", body: "b" };
  return {
    getClient: vi.fn(async () => ({}) as any),
    getInstallationToken: vi.fn(async () => "tok"),
    clonePrHead: vi.fn(async () => ({ dir: "/tmp/x", cleanup: vi.fn(async () => {}) })),
    computeDiff: vi.fn(async () => ({ diff: "d", changedFiles: ["src/a.ts"] })),
    loadSkills: vi.fn(async () => ({ skills: [] })),
    adapter: { name: "fake", review: vi.fn(async () => [finding]) },
    listActiveBotComments: vi.fn(async () => []),
    postInlineFinding: vi.fn(async () => {}),
    resolveWithReply: vi.fn(async () => {}),
    config: { defaultsDir: "/d", autoApplyDir: "/a" },
    log: vi.fn(),
    ...over,
  };
}

describe("runReview", () => {
  it("posts an inline comment for a new finding and cleans up", async () => {
    const cleanup = vi.fn(async () => {});
    const deps = makeDeps({ clonePrHead: vi.fn(async () => ({ dir: "/tmp/x", cleanup })) });
    const summary = await runReview(job, deps);
    expect(deps.postInlineFinding).toHaveBeenCalledTimes(1);
    expect(deps.resolveWithReply).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalled();
    expect(summary).toMatchObject({ created: 1, resolved: 0, kept: 0 });
  });

  it("resolves an active comment whose finding disappeared", async () => {
    const fp = computeFingerprint({ file: "src/old.ts", category: "c", dedupeKey: "gone" });
    const deps = makeDeps({
      adapter: { name: "fake", review: vi.fn(async () => []) },
      listActiveBotComments: vi.fn(async () => [{ fp, commentId: 9, threadId: "T9" }]),
    });
    const summary = await runReview(job, deps);
    expect(deps.resolveWithReply).toHaveBeenCalledWith(
      expect.anything(), "o", "r", 1,
      expect.objectContaining({ commentId: 9, threadId: "T9", commitSha: "head1" }),
    );
    expect(summary).toMatchObject({ created: 0, resolved: 1 });
  });

  it("cleans up the workspace even if the adapter throws", async () => {
    const cleanup = vi.fn(async () => {});
    const deps = makeDeps({
      clonePrHead: vi.fn(async () => ({ dir: "/tmp/x", cleanup })),
      adapter: { name: "fake", review: vi.fn(async () => { throw new Error("boom"); }) },
    });
    await expect(runReview(job, deps)).rejects.toThrow("boom");
    expect(cleanup).toHaveBeenCalled();
    expect(deps.postInlineFinding).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/runner.test.ts`
Expected: FAIL — cannot find module `../src/runner.js`.

- [ ] **Step 3: Write `src/runner.ts`**

```ts
import type { Finding, Job } from "./types.js";
import type { AiAdapter } from "./adapters/types.js";
import type { GitHubClient } from "./github/comments.js";
import type { Workspace } from "./workspace.js";
import type { EffectiveSkills } from "./skills/loader.js";
import type { ActiveComment } from "./reconciler.js";
import { reconcile } from "./reconciler.js";
import { computeFingerprint } from "./fingerprint.js";

export interface RunSummary {
  created: number;
  kept: number;
  resolved: number;
}

export interface RunnerDeps {
  getClient(installationId: number): Promise<GitHubClient>;
  getInstallationToken(installationId: number): Promise<string>;
  clonePrHead(opts: {
    owner: string; repo: string; headSha: string; baseSha: string; token: string;
  }): Promise<Workspace>;
  computeDiff(dir: string, baseSha: string): Promise<{ diff: string; changedFiles: string[] }>;
  loadSkills(opts: {
    defaultsDir: string; autoApplyDir: string; workspaceDir: string; changedFiles: string[];
  }): Promise<EffectiveSkills>;
  adapter: AiAdapter;
  listActiveBotComments(client: GitHubClient, owner: string, repo: string, pr: number): Promise<ActiveComment[]>;
  postInlineFinding(
    client: GitHubClient, owner: string, repo: string, pr: number,
    commitSha: string, finding: Finding, fp: string,
  ): Promise<void>;
  resolveWithReply(
    client: GitHubClient, owner: string, repo: string, pr: number,
    args: { commentId: number; threadId: string; commitSha: string },
  ): Promise<void>;
  config: { defaultsDir: string; autoApplyDir: string };
  log: (event: Record<string, unknown>) => void;
}

export async function runReview(job: Job, deps: RunnerDeps): Promise<RunSummary> {
  const client = await deps.getClient(job.installationId);
  const token = await deps.getInstallationToken(job.installationId);
  const ws = await deps.clonePrHead({
    owner: job.owner, repo: job.repo, headSha: job.headSha, baseSha: job.baseSha, token,
  });

  try {
    const { diff, changedFiles } = await deps.computeDiff(ws.dir, job.baseSha);
    const skills = await deps.loadSkills({
      defaultsDir: deps.config.defaultsDir,
      autoApplyDir: deps.config.autoApplyDir,
      workspaceDir: ws.dir,
      changedFiles,
    });
    const findings = await deps.adapter.review({ workspaceDir: ws.dir, changedFiles, diff, skills });
    const current = findings.map((finding) => ({
      finding,
      fp: computeFingerprint({ file: finding.file, category: finding.category, dedupeKey: finding.dedupeKey }),
    }));
    const active = await deps.listActiveBotComments(client, job.owner, job.repo, job.pr);
    const actions = reconcile(current, active);

    let created = 0, kept = 0, resolved = 0;
    for (const action of actions) {
      if (action.type === "create") {
        await deps.postInlineFinding(client, job.owner, job.repo, job.pr, job.headSha, action.finding, action.fp);
        created++;
      } else if (action.type === "keep") {
        kept++;
      } else {
        await deps.resolveWithReply(client, job.owner, job.repo, job.pr, {
          commentId: action.commentId, threadId: action.threadId, commitSha: job.headSha,
        });
        resolved++;
      }
    }

    const summary: RunSummary = { created, kept, resolved };
    deps.log({ repo: `${job.owner}/${job.repo}`, pr: job.pr, sha: job.headSha, findings: findings.length, ...summary });
    return summary;
  } finally {
    await ws.cleanup();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/runner.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/runner.ts tests/runner.test.ts
git commit -m "feat: add review runner orchestrating clone/skills/adapter/reconcile/post"
```

---

## Task 13: Config (`config.ts`)

Env parsing/validation (spec §10).

**Files:**
- Create: `src/config.ts`
- Test: `tests/config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/config.test.ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

const base = {
  GITHUB_APP_ID: "123",
  GITHUB_PRIVATE_KEY: "key",
  GITHUB_WEBHOOK_SECRET: "secret",
};

describe("loadConfig", () => {
  it("applies defaults when optional vars are absent", () => {
    const cfg = loadConfig(base);
    expect(cfg.adapter).toBe("claude");
    expect(cfg.debounceMs).toBe(15000);
    expect(cfg.maxRetries).toBe(3);
    expect(cfg.sqlitePath).toBe("./data/queue.db");
    expect(cfg.port).toBe(3000);
  });

  it("coerces numeric env vars", () => {
    const cfg = loadConfig({ ...base, DEBOUNCE_MS: "500", PORT: "8080" });
    expect(cfg.debounceMs).toBe(500);
    expect(cfg.port).toBe(8080);
  });

  it("throws when a required var is missing", () => {
    expect(() => loadConfig({ GITHUB_APP_ID: "1" })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL — cannot find module `../src/config.js`.

- [ ] **Step 3: Write `src/config.ts`**

```ts
import { z } from "zod";

const EnvSchema = z.object({
  GITHUB_APP_ID: z.string().min(1),
  GITHUB_PRIVATE_KEY: z.string().min(1),
  GITHUB_WEBHOOK_SECRET: z.string().min(1),
  MAD_REVIEWER_ADAPTER: z.string().default("claude"),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(300000),
  DEBOUNCE_MS: z.coerce.number().int().nonnegative().default(15000),
  MAX_RETRIES: z.coerce.number().int().positive().default(3),
  SQLITE_PATH: z.string().default("./data/queue.db"),
  WORKER_POLL_MS: z.coerce.number().int().positive().default(2000),
  PORT: z.coerce.number().int().positive().default(3000),
  DEFAULTS_DIR: z.string().default("./skills/defaults"),
  AUTO_APPLY_DIR: z.string().default("./skills/auto-apply"),
});

export interface Config {
  appId: string;
  privateKey: string;
  webhookSecret: string;
  adapter: string;
  aiTimeoutMs: number;
  debounceMs: number;
  maxRetries: number;
  sqlitePath: string;
  workerPollMs: number;
  port: number;
  defaultsDir: string;
  autoApplyDir: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const e = EnvSchema.parse(env);
  return {
    appId: e.GITHUB_APP_ID,
    privateKey: e.GITHUB_PRIVATE_KEY,
    webhookSecret: e.GITHUB_WEBHOOK_SECRET,
    adapter: e.MAD_REVIEWER_ADAPTER,
    aiTimeoutMs: e.AI_TIMEOUT_MS,
    debounceMs: e.DEBOUNCE_MS,
    maxRetries: e.MAX_RETRIES,
    sqlitePath: e.SQLITE_PATH,
    workerPollMs: e.WORKER_POLL_MS,
    port: e.PORT,
    defaultsDir: e.DEFAULTS_DIR,
    autoApplyDir: e.AUTO_APPLY_DIR,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/config.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: add env config parsing with zod defaults"
```

---

## Task 14: Worker loop (`worker.ts`)

Drains the queue (spec §3.1 #3, §8). Injected `runOne` + queue make it unit-testable; `tick()` processes one job.

**Files:**
- Create: `src/worker.ts`
- Test: `tests/worker.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/worker.test.ts
import { describe, it, expect, vi } from "vitest";
import { tick, type WorkerDeps } from "../src/worker.js";
import type { QueueJob } from "../src/queue/queue.js";

const qjob: QueueJob = { owner: "o", repo: "r", pr: 1, headSha: "h", baseSha: "b", installationId: 1 };

function makeQueue(next: QueueJob | null) {
  return {
    claimNext: vi.fn(() => next),
    complete: vi.fn(),
    fail: vi.fn(),
  };
}

describe("tick", () => {
  it("does nothing when no job is ready", async () => {
    const queue = makeQueue(null);
    const deps: WorkerDeps = { queue: queue as any, runOne: vi.fn(), maxRetries: 3, log: vi.fn() };
    const ran = await tick(deps);
    expect(ran).toBe(false);
    expect(deps.runOne).not.toHaveBeenCalled();
  });

  it("runs a claimed job then completes it", async () => {
    const queue = makeQueue(qjob);
    const runOne = vi.fn(async () => {});
    const deps: WorkerDeps = { queue: queue as any, runOne, maxRetries: 3, log: vi.fn() };
    const ran = await tick(deps);
    expect(ran).toBe(true);
    expect(runOne).toHaveBeenCalledWith(qjob);
    expect(queue.complete).toHaveBeenCalledWith(qjob);
    expect(queue.fail).not.toHaveBeenCalled();
  });

  it("fails the job (does not complete) when runOne throws", async () => {
    const queue = makeQueue(qjob);
    const runOne = vi.fn(async () => { throw new Error("boom"); });
    const deps: WorkerDeps = { queue: queue as any, runOne, maxRetries: 3, log: vi.fn() };
    await tick(deps);
    expect(queue.fail).toHaveBeenCalledWith(qjob, 3);
    expect(queue.complete).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/worker.test.ts`
Expected: FAIL — cannot find module `../src/worker.js`.

- [ ] **Step 3: Write `src/worker.ts`**

```ts
import type { Queue, QueueJob } from "./queue/queue.js";

export interface WorkerDeps {
  queue: Pick<Queue, "claimNext" | "complete" | "fail">;
  runOne: (job: QueueJob) => Promise<void>;
  maxRetries: number;
  log: (event: Record<string, unknown>) => void;
}

export async function tick(deps: WorkerDeps): Promise<boolean> {
  const job = deps.queue.claimNext();
  if (!job) return false;
  try {
    await deps.runOne(job);
    deps.queue.complete(job);
  } catch (err) {
    deps.log({ level: "error", repo: `${job.owner}/${job.repo}`, pr: job.pr, error: String(err) });
    deps.queue.fail(job, deps.maxRetries);
  }
  return true;
}

export function startWorker(deps: WorkerDeps, pollMs: number): () => void {
  let stopped = false;
  const loop = async () => {
    while (!stopped) {
      const ran = await tick(deps);
      if (!ran) await new Promise((r) => setTimeout(r, pollMs));
    }
  };
  void loop();
  return () => {
    stopped = true;
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/worker.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/worker.ts tests/worker.test.ts
git commit -m "feat: add worker tick + loop with retry-on-failure"
```

---

## Task 15: Webhook registration (`webhook.ts`)

Maps PR events to queue enqueues (spec §3.1 #1).

**Files:**
- Create: `src/webhook.ts`
- Test: `tests/webhook.test.ts`

- [ ] **Step 1: Write the failing test** (fake Probot app captures the handler)

```ts
// tests/webhook.test.ts
import { describe, it, expect, vi } from "vitest";
import { registerWebhooks } from "../src/webhook.js";

describe("registerWebhooks", () => {
  it("enqueues a job from a pull_request event payload", async () => {
    let handler: (ctx: any) => Promise<void> = async () => {};
    const app = { on: vi.fn((_events: string[], h: any) => { handler = h; }) } as any;
    const queue = { enqueue: vi.fn() } as any;

    registerWebhooks(app, queue);

    expect(app.on).toHaveBeenCalledWith(
      ["pull_request.opened", "pull_request.synchronize", "pull_request.reopened"],
      expect.any(Function),
    );

    await handler({
      payload: {
        repository: { owner: { login: "o" }, name: "r" },
        pull_request: { number: 7, head: { sha: "h7" }, base: { sha: "b7" } },
        installation: { id: 42 },
      },
    });

    expect(queue.enqueue).toHaveBeenCalledWith({
      owner: "o", repo: "r", pr: 7, headSha: "h7", baseSha: "b7", installationId: 42,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/webhook.test.ts`
Expected: FAIL — cannot find module `../src/webhook.js`.

- [ ] **Step 3: Write `src/webhook.ts`**

```ts
import type { Probot } from "probot";
import type { Queue } from "./queue/queue.js";

export function registerWebhooks(app: Probot, queue: Pick<Queue, "enqueue">): void {
  app.on(
    ["pull_request.opened", "pull_request.synchronize", "pull_request.reopened"],
    async (ctx) => {
      const pr = ctx.payload.pull_request;
      const installation = ctx.payload.installation;
      if (!installation) return;
      queue.enqueue({
        owner: ctx.payload.repository.owner.login,
        repo: ctx.payload.repository.name,
        pr: pr.number,
        headSha: pr.head.sha,
        baseSha: pr.base.sha,
        installationId: installation.id,
      });
    },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/webhook.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/webhook.ts tests/webhook.test.ts
git commit -m "feat: register PR webhooks that enqueue review jobs"
```

---

## Task 16: Entrypoint wiring (`index.ts`)

Wires config → Probot → queue → webhook → runner → worker, plus `/health` (spec §3, §10). No unit test (pure composition); verified by typecheck and the full suite.

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Write `src/index.ts`**

```ts
import { createServer } from "node:http";
import { Probot, createNodeMiddleware } from "probot";
import { loadConfig } from "./config.js";
import { Queue, type QueueJob } from "./queue/queue.js";
import { registerWebhooks } from "./webhook.js";
import { startWorker } from "./worker.js";
import { runReview } from "./runner.js";
import { createAdapter } from "./adapters/index.js";
import { clonePrHead, computeDiff } from "./workspace.js";
import { loadSkills } from "./skills/loader.js";
import {
  listActiveBotComments,
  postInlineFinding,
  resolveWithReply,
  type GitHubClient,
} from "./github/comments.js";
import type { Job } from "./types.js";

const config = loadConfig();
const log = (event: Record<string, unknown>) => console.log(JSON.stringify(event));

const probot = new Probot({
  appId: config.appId,
  privateKey: config.privateKey,
  secret: config.webhookSecret,
});

const queue = new Queue(config.sqlitePath, config.debounceMs);
const adapter = createAdapter(config.adapter, { timeoutMs: config.aiTimeoutMs });

async function getClient(installationId: number): Promise<GitHubClient> {
  const octokit = await probot.auth(installationId);
  return octokit as unknown as GitHubClient;
}

async function getInstallationToken(installationId: number): Promise<string> {
  const octokit = await probot.auth(installationId);
  const auth = (await octokit.auth({ type: "installation" })) as { token: string };
  return auth.token;
}

async function runOne(qjob: QueueJob): Promise<void> {
  const job: Job = qjob;
  await runReview(job, {
    getClient,
    getInstallationToken,
    clonePrHead,
    computeDiff,
    loadSkills,
    adapter,
    listActiveBotComments,
    postInlineFinding,
    resolveWithReply,
    config: { defaultsDir: config.defaultsDir, autoApplyDir: config.autoApplyDir },
    log,
  });
}

const appFn = (app: Probot) => registerWebhooks(app, queue);
const middleware = createNodeMiddleware(appFn, { probot });

const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }
  void middleware(req, res);
});

server.listen(config.port, () => {
  log({ event: "listening", port: config.port, adapter: config.adapter });
  startWorker({ queue, runOne, maxRetries: config.maxRetries, log }, config.workerPollMs);
});
```

- [ ] **Step 2: Remove the placeholder and typecheck the whole project**

Run: `rm -f src/_placeholder.ts && npx tsc --noEmit`
Expected: exits 0.

> If `octokit.auth({type:"installation"})` typing is awkward, the `as { token: string }` cast already handles it; do not loosen other types.

- [ ] **Step 3: Run the full test suite**

Run: `npx vitest run`
Expected: ALL pass — types(4), fingerprint(6), reconciler(6), autoApply(4), loader(6), parse(5), execFileNoThrow(3), claudeAdapter(4), queue(6), comments(4), workspace(2), runner(3), config(3), worker(3), webhook(1).

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire entrypoint (probot server, queue, worker, health)"
```

---

## Task 17: Default skills content (`skills/`)

Ship the baseline skills (spec §6). `output-contract.md` defines the JSON contract the adapter parses; it is protected from override.

**Files:**
- Create: `skills/defaults/output-contract.md`
- Create: `skills/defaults/null-safety.md`
- Create: `skills/defaults/security.md`
- Create: `skills/auto-apply/sql-migrations.md`

- [ ] **Step 1: Create `skills/defaults/output-contract.md`**

````markdown
---
name: output-contract
description: Defines the exact JSON output every review must emit
---

# Output contract

After analyzing the PR, output **only** a JSON array (no prose). Each element is
one bug:

```json
[
  {
    "file": "relative/path/from/repo/root.ts",
    "line": 42,
    "category": "null-safety",
    "dedupeKey": "null-safety:UserService.load:user-param",
    "severity": "bug",
    "title": "Short one-line summary",
    "body": "Explanation of the bug and a concrete suggested fix."
  }
]
```

Rules:
- `severity` is always `"bug"`. Do not report style or nitpicks.
- `dedupeKey` must be a STABLE semantic identity in the form
  `<category>:<symbol-or-scope>:<symptom>`. It must NOT contain line numbers and
  must stay identical across runs for the same underlying bug, even if the code
  moves lines.
- `line` is the line in the PR head where the bug occurs.
- If there are no bugs, output `[]`.
````

- [ ] **Step 2: Create `skills/defaults/null-safety.md`**

```markdown
---
name: null-safety
description: Detect null/undefined dereferences and missing guards
---

# Null safety

Look for:
- Values that can be `null`/`undefined` dereferenced without a guard.
- Optional chaining missing where an upstream value is nullable.
- Array access / `.find()` results used without checking for `undefined`.
- Non-null assertions (`!`) that are not actually guaranteed.

Report each as a `null-safety` finding with a `dedupeKey` like
`null-safety:<function-or-symbol>:<the-nullable-thing>`.
```

- [ ] **Step 3: Create `skills/defaults/security.md`**

```markdown
---
name: security
description: Detect common injection and unsafe-input bugs
---

# Security

Look for:
- SQL/command/template injection from unsanitized input.
- Reflected/stored XSS from untrusted data rendered without escaping.
- Path traversal from user-controlled paths.
- Secrets/tokens logged or returned in responses.

Report each as a `security/<kind>` finding with a `dedupeKey` like
`security:<sink>:<source>`.
```

- [ ] **Step 4: Create `skills/auto-apply/sql-migrations.md`** (selected only when SQL/migration files change)

```markdown
---
name: sql-migrations
description: Extra checks for SQL and migration files
applies_to:
  - "**/*.sql"
  - "**/migrations/**"
---

# SQL & migrations

Look for:
- Destructive migrations (DROP/ALTER) without a safe rollback path.
- Missing indexes on columns used in new WHERE/JOIN clauses.
- Non-idempotent migrations that fail on re-run.

Report as a `sql/<kind>` finding with a `dedupeKey` like `sql:<table>:<issue>`.
```

- [ ] **Step 5: Verify the suite is still green with real skill files present**

Run: `npx vitest run`
Expected: PASS (unchanged — sanity check).

- [ ] **Step 6: Commit**

```bash
git add skills/
git commit -m "feat: add default review skills and an example auto-apply skill"
```

---

## Task 18: Docker, README, env example, optional e2e

Packaging and operator docs (spec §10). Plus a guarded e2e smoke test (not in default CI).

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `.env.example`
- Create: `README.md`

- [ ] **Step 1: Create `Dockerfile`** (needs `git` + the AI CLI in PATH)

```dockerfile
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

COPY skills ./skills

ENV SQLITE_PATH=/data/queue.db
VOLUME ["/data"]
EXPOSE 3000

# NOTE: install the chosen AI CLI (e.g. `claude`) into a derived image and
# provide its credentials via env before this server can review.
CMD ["node", "dist/index.js"]
```

- [ ] **Step 2: Create `.dockerignore`**

```dockerignore
node_modules
dist
data
.git
*.log
.env
```

- [ ] **Step 3: Create `.env.example`**

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

- [ ] **Step 4: Create `README.md`**

```markdown
# mad-reviewer

Auto-reviews GitHub PRs across the org with a configurable AI tool, posts inline
bug comments, and reconciles its own past comments across runs (resolving bugs
that disappear, re-commenting on ones that reappear).

See the design at `docs/superpowers/specs/2026-05-22-mad-reviewer-design.md`.

## How it works

1. A GitHub App webhook (`pull_request` opened/synchronize/reopened) hits the
   server, which enqueues a job in SQLite (debounced, one run per PR).
2. A worker clones the PR head, loads skills (defaults + glob-matched
   auto-apply + per-repo `.mad-reviewer/skills/` override), and runs the AI
   adapter to get a JSON list of bugs.
3. Each finding gets a deterministic fingerprint. The reconciler compares
   against the bot's active comments (identified by an embedded fingerprint
   marker) and creates / keeps / resolves accordingly.

GitHub is the source of truth for findings; SQLite holds only orchestration
state.

## Setup

1. Create a GitHub App (org-level). Permissions: Pull requests (read+write),
   Contents (read), Metadata (read). Subscribe to `Pull request` events.
   Set the webhook URL to this server and a webhook secret.
2. Install the App on the org (covers all repos).
3. Copy `.env.example` to `.env` and fill in the App credentials.
4. Ensure the chosen AI CLI (default `claude`) is installed and authenticated
   in the runtime environment.

## Run

```bash
npm install
npm run build
npm start
# or: npm run dev
```

Health check: `GET /health` -> `{"status":"ok"}`.

## Per-repo customization

A target repo may add `.mad-reviewer/skills/*.md` to override a default skill
(same filename) or add a new one. `output-contract.md` cannot be overridden.

## Test

```bash
npm test
```
```

- [ ] **Step 5: Final gate — typecheck + full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: typecheck exits 0; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add Dockerfile .dockerignore .env.example README.md
git commit -m "docs: add Dockerfile, env example, and README"
```

---

## Self-Review (completed by plan author)

**Spec coverage:**
- Trigger / webhook (spec §3) → Tasks 15, 16.
- GitHub App auth (spec §2) → Task 16 (`getClient`/`getInstallationToken`), Task 18 (App setup docs).
- Probot stack (spec §2) → Tasks 15, 16.
- AI adapter, configurable, default claude (spec §7) → Tasks 6, 8.
- GitHub as source of truth + fingerprint marker (spec §2, §3.1 #7) → Tasks 2, 10.
- SQLite queue: debounce, lock, last_sha, restart (spec §3.1 #2, §10) → Task 9.
- Fingerprint A3 (spec §2) → Task 2 + runner computes from adapter output (Task 12).
- Resolve via reply + resolveReviewThread (spec §2, §5) → Tasks 10, 12.
- Reappearance = new comment; resolve on 1 run absent (spec §5) → Task 3 + 12.
- Inline per real bug only (spec §2) → Task 10 (`postInlineFinding`), prompt in Task 8.
- Clone PR head (spec §2) → Task 11.
- 3-tier skills + protected output-contract (spec §6) → Tasks 4, 5, 17.
- Auto-apply selection @TODO §6.3 → Task 4 (option a, glob).
- Command-injection safety (general security) → Task 7 (single execFile wrapper, no shell), used by Tasks 8, 11.
- Error handling: no comment on failure, retry, cleanup in finally (spec §8) → Tasks 8 (throws on bad output/nonzero), 12 (finally cleanup), 14 (fail/retry).
- Testing strategy (spec §9) → tests in every task; clone/diff + real `claude` left for guarded e2e (noted in Tasks 11, 18).
- Deploy/config (spec §10) → Tasks 13, 18.
- Out of scope (spec §11) → cursor/opencode adapters noted as future (Task 8); external queue not built.

**Placeholder scan:** No "TBD"/"implement later". The only deferred-by-design item (auto-apply b/c) is explicitly out of scope with a working option (a) implemented.

**Type consistency check:**
- `Finding` shape identical across Tasks 1, 3, 8, 10, 12.
- `Job` (Task 1) and `QueueJob` (Task 9) have identical fields; runner casts `QueueJob` → `Job` in Task 16 (`runOne`), sound since fields match.
- `ExecResult`/`ExecOpts` defined in Task 7; consumed by Tasks 8 (`CliRunner`) and 11 (`git` helper).
- `ActiveComment` defined in Task 3, imported by Tasks 10, 12.
- `GitHubClient` defined in Task 10, used in Tasks 12, 16.
- `EffectiveSkills`/`Skill` defined in Task 5, used in Tasks 4, 8, 12.
- `reconcile`, `computeFingerprint`, `loadSkills`, `clonePrHead`, `computeDiff`, `listActiveBotComments`, `postInlineFinding`, `resolveWithReply`, `createAdapter`, `tick`, `startWorker`, `registerWebhooks` — names consistent between definition and call sites.

**Cross-task ordering note:** Task 4 (autoApply) imports the `Skill` type from Task 5 (loader). Run Task 4's test together with Task 5 (Task 5 Step 4 does this).
