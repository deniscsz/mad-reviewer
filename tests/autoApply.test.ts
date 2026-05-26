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
