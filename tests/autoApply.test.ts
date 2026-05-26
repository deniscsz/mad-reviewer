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

  const CODE = "**/*.{ts,tsx,js,jsx,mts,cts,go,java,php,py,rs,kt,scala,rb,cs}";
  const bundled = [
    skill("concurrency-async", [CODE]),
    skill("error-handling", [CODE]),
    skill("resource-leaks", [CODE]),
    skill("performance", [CODE]),
    skill("typescript-javascript", ["**/*.{ts,tsx,js,jsx,mts,cts}"]),
    skill("react", ["**/*.{tsx,jsx}"]),
  ];

  it("a .tsx file selects react, ts-js, and all cross-cutting skills", () => {
    const result = selectAutoApply(bundled, ["src/App.tsx"]);
    expect(result.map((s) => s.name).sort()).toEqual([
      "concurrency-async",
      "error-handling",
      "performance",
      "react",
      "resource-leaks",
      "typescript-javascript",
    ]);
  });

  it("a .py file selects cross-cutting skills but not react/ts-js", () => {
    const result = selectAutoApply(bundled, ["service/worker.py"]);
    expect(result.map((s) => s.name).sort()).toEqual([
      "concurrency-async",
      "error-handling",
      "performance",
      "resource-leaks",
    ]);
  });

  it("a .php file selects cross-cutting skills but not react/ts-js", () => {
    const result = selectAutoApply(bundled, ["app/Http/Controller.php"]);
    expect(result.map((s) => s.name).sort()).toEqual([
      "concurrency-async",
      "error-handling",
      "performance",
      "resource-leaks",
    ]);
  });
});
