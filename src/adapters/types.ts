import type { Finding } from "../types.js";
import type { EffectiveSkills } from "../skills/loader.js";

export interface ReviewInput {
  workspaceDir: string;
  changedFiles: string[];
  diff: string;
  skills: EffectiveSkills;
  soul?: string;
}

export interface AiAdapter {
  name: string;
  review(input: ReviewInput): Promise<Finding[]>;
}
