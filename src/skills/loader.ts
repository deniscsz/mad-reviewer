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
