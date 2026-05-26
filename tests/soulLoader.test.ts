import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadSoul } from "../src/soul/loader.js";

let root: string;
let soulPath: string;
let workspaceDir: string;

async function writeRepoSoul(content: string) {
  const dir = path.join(workspaceDir, ".mad-reviewer");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "SOUL.md"), content, "utf8");
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "soul-test-"));
  soulPath = path.join(root, "SOUL.md");
  workspaceDir = path.join(root, "workspace");
  await fs.mkdir(workspaceDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("loadSoul", () => {
  it("returns the project default when only the default file exists", async () => {
    await fs.writeFile(soulPath, "default persona", "utf8");
    expect(await loadSoul({ soulPath, workspaceDir })).toBe("default persona");
  });

  it("lets a repo .mad-reviewer/SOUL.md replace the default", async () => {
    await fs.writeFile(soulPath, "default persona", "utf8");
    await writeRepoSoul("repo persona");
    expect(await loadSoul({ soulPath, workspaceDir })).toBe("repo persona");
  });

  it("returns undefined when neither file exists", async () => {
    expect(await loadSoul({ soulPath, workspaceDir })).toBeUndefined();
  });

  it("falls back to the default when the repo file is whitespace-only", async () => {
    await fs.writeFile(soulPath, "default persona", "utf8");
    await writeRepoSoul("   \n\t  \n");
    expect(await loadSoul({ soulPath, workspaceDir })).toBe("default persona");
  });

  it("returns undefined when the default is whitespace-only and no repo file", async () => {
    await fs.writeFile(soulPath, "  \n  ", "utf8");
    expect(await loadSoul({ soulPath, workspaceDir })).toBeUndefined();
  });
});
