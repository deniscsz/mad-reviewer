import type { Finding } from "../types.js";
import type { EffectiveSkills } from "../skills/loader.js";

export type AdapterLogFn = (event: Record<string, unknown>) => void;

export interface ReviewInput {
  workspaceDir: string;
  changedFiles: string[];
  diff: string;
  skills: EffectiveSkills;
  soul?: string;
  // Whether the target repo's own native skills (.claude/skills, etc.) are loaded
  // by the AI provider in addition to mad-reviewer's curated skills. Default true.
  loadRepoSkills?: boolean;
  // When true, the adapter emits ai_request / ai_response events with full prompt
  // and raw CLI output via `log`. Off by default to avoid leaking diff content.
  debug?: boolean;
  log?: AdapterLogFn;
}

export interface AiAdapter {
  name: string;
  review(input: ReviewInput): Promise<Finding[]>;
}
