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
