import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseChangedFiles, sanitizeUntrustedConfig } from "../src/workspace.js";

describe("parseChangedFiles", () => {
  it("splits newline-separated paths and drops blanks", () => {
    expect(parseChangedFiles("src/a.ts\nsrc/b.ts\n\n")).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("returns [] for empty output", () => {
    expect(parseChangedFiles("")).toEqual([]);
    expect(parseChangedFiles("\n")).toEqual([]);
  });
});

describe("sanitizeUntrustedConfig", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "sanitize-"));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("removes auto-exec config but keeps .claude/skills", async () => {
    await fs.mkdir(path.join(dir, ".claude", "skills", "demo"), { recursive: true });
    await fs.writeFile(path.join(dir, ".claude", "settings.json"), "{}", "utf8");
    await fs.writeFile(path.join(dir, ".claude", "settings.local.json"), "{}", "utf8");
    await fs.writeFile(path.join(dir, ".mcp.json"), "{}", "utf8");
    await fs.mkdir(path.join(dir, ".cursor"), { recursive: true });
    await fs.writeFile(path.join(dir, ".cursor", "mcp.json"), "{}", "utf8");
    await fs.writeFile(path.join(dir, ".claude", "skills", "demo", "SKILL.md"), "rule", "utf8");

    await sanitizeUntrustedConfig(dir);

    await expect(fs.access(path.join(dir, ".claude", "settings.json"))).rejects.toThrow();
    await expect(fs.access(path.join(dir, ".claude", "settings.local.json"))).rejects.toThrow();
    await expect(fs.access(path.join(dir, ".mcp.json"))).rejects.toThrow();
    await expect(fs.access(path.join(dir, ".cursor", "mcp.json"))).rejects.toThrow();
    expect(await fs.readFile(path.join(dir, ".claude", "skills", "demo", "SKILL.md"), "utf8")).toBe("rule");
  });

  it("does not throw when the config files are absent", async () => {
    await expect(sanitizeUntrustedConfig(dir)).resolves.toBeUndefined();
  });

  it("removes native skill dirs when loadRepoSkills is false, keeping .mad-reviewer/skills", async () => {
    await fs.mkdir(path.join(dir, ".claude", "skills", "demo"), { recursive: true });
    await fs.writeFile(path.join(dir, ".claude", "skills", "demo", "SKILL.md"), "x", "utf8");
    await fs.mkdir(path.join(dir, ".agents", "skills", "demo"), { recursive: true });
    await fs.writeFile(path.join(dir, ".agents", "skills", "demo", "SKILL.md"), "x", "utf8");
    await fs.mkdir(path.join(dir, ".opencode", "skill", "demo"), { recursive: true });
    await fs.writeFile(path.join(dir, ".opencode", "skill", "demo", "SKILL.md"), "x", "utf8");
    await fs.mkdir(path.join(dir, ".cursor", "rules"), { recursive: true });
    await fs.writeFile(path.join(dir, ".cursor", "rules", "demo.mdc"), "x", "utf8");
    await fs.mkdir(path.join(dir, ".cursor", "skills", "demo"), { recursive: true });
    await fs.writeFile(path.join(dir, ".cursor", "skills", "demo", "SKILL.md"), "x", "utf8");
    await fs.mkdir(path.join(dir, ".mad-reviewer", "skills"), { recursive: true });
    await fs.writeFile(path.join(dir, ".mad-reviewer", "skills", "company.md"), "keep", "utf8");

    await sanitizeUntrustedConfig(dir, { loadRepoSkills: false });

    await expect(fs.access(path.join(dir, ".claude", "skills"))).rejects.toThrow();
    await expect(fs.access(path.join(dir, ".agents", "skills"))).rejects.toThrow();
    await expect(fs.access(path.join(dir, ".opencode", "skill"))).rejects.toThrow();
    await expect(fs.access(path.join(dir, ".cursor", "rules"))).rejects.toThrow();
    await expect(fs.access(path.join(dir, ".cursor", "skills"))).rejects.toThrow();
    expect(await fs.readFile(path.join(dir, ".mad-reviewer", "skills", "company.md"), "utf8")).toBe("keep");
  });
});
