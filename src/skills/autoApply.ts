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
