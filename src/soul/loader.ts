import { promises as fs } from "node:fs";
import path from "node:path";

async function readIfPresent(file: string): Promise<string | undefined> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    return undefined;
  }
  return raw.trim().length > 0 ? raw : undefined;
}

// Two-tier persona resolution: a reviewed repo's `.mad-reviewer/SOUL.md`
// replaces the project default at `soulPath`. Absent/empty → undefined.
export async function loadSoul(opts: {
  soulPath: string;
  workspaceDir: string;
}): Promise<string | undefined> {
  const repoSoul = await readIfPresent(
    path.join(opts.workspaceDir, ".mad-reviewer", "SOUL.md"),
  );
  if (repoSoul !== undefined) return repoSoul;
  return readIfPresent(opts.soulPath);
}
