import type { Finding } from "../types.js";
import type { EffectiveSkills } from "../skills/loader.js";

export interface ReviewInput {
  workspaceDir: string;
  changedFiles: string[];
  diff: string;
  skills: EffectiveSkills;
  soul?: string;
  // Whether the target repo's own native skills (.claude/skills, etc.) are loaded
  // by the AI provider in addition to mad-reviewer's curated skills. Default true.
  loadRepoSkills?: boolean;
}

export interface AiAdapter {
  name: string;
  review(input: ReviewInput): Promise<Finding[]>;
}
