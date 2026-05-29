import { z } from "zod";

const EnvSchema = z.object({
  GITHUB_APP_ID: z.string().min(1),
  GITHUB_PRIVATE_KEY: z.string().min(1),
  GITHUB_WEBHOOK_SECRET: z.string().min(1),
  MAD_REVIEWER_ADAPTER: z.string().default("claude"),
  MAD_REVIEWER_OPENCODE_MODEL: z.string().min(1).optional(),
  MAD_REVIEWER_OPENCODE_CONFIG: z.string().default("./opencode.review.json"),
  MAD_REVIEWER_CURSOR_MODEL: z.string().min(1).optional(),
  MAD_REVIEWER_LOAD_REPO_SKILLS: z.string().default("true"),
  MAD_REVIEWER_DEBUG: z.string().default("false"),
  MAD_REVIEWER_CHECKS: z.string().default("true"),
  MAD_REVIEWER_CHECK_NAME: z.string().default("mad-reviewer"),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(300000),
  DEBOUNCE_MS: z.coerce.number().int().nonnegative().default(15000),
  MAX_RETRIES: z.coerce.number().int().positive().default(3),
  SQLITE_PATH: z.string().default("./data/queue.db"),
  WORKER_POLL_MS: z.coerce.number().int().positive().default(2000),
  PORT: z.coerce.number().int().positive().default(3000),
  DEFAULTS_DIR: z.string().default("./skills/defaults"),
  AUTO_APPLY_DIR: z.string().default("./skills/auto-apply"),
  SOUL_PATH: z.string().default("./SOUL.md"),
});

export interface Config {
  appId: string;
  privateKey: string;
  webhookSecret: string;
  adapter: string;
  opencodeModel?: string;
  opencodeConfig: string;
  cursorModel?: string;
  loadRepoSkills: boolean;
  debug: boolean;
  checksEnabled: boolean;
  checkName: string;
  aiTimeoutMs: number;
  debounceMs: number;
  maxRetries: number;
  sqlitePath: string;
  workerPollMs: number;
  port: number;
  defaultsDir: string;
  autoApplyDir: string;
  soulPath: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const e = EnvSchema.parse(env);
  return {
    appId: e.GITHUB_APP_ID,
    privateKey: e.GITHUB_PRIVATE_KEY,
    webhookSecret: e.GITHUB_WEBHOOK_SECRET,
    adapter: e.MAD_REVIEWER_ADAPTER,
    opencodeModel: e.MAD_REVIEWER_OPENCODE_MODEL,
    opencodeConfig: e.MAD_REVIEWER_OPENCODE_CONFIG,
    cursorModel: e.MAD_REVIEWER_CURSOR_MODEL,
    loadRepoSkills: e.MAD_REVIEWER_LOAD_REPO_SKILLS !== "false",
    debug: e.MAD_REVIEWER_DEBUG === "true",
    checksEnabled: e.MAD_REVIEWER_CHECKS !== "false",
    checkName: e.MAD_REVIEWER_CHECK_NAME,
    aiTimeoutMs: e.AI_TIMEOUT_MS,
    debounceMs: e.DEBOUNCE_MS,
    maxRetries: e.MAX_RETRIES,
    sqlitePath: e.SQLITE_PATH,
    workerPollMs: e.WORKER_POLL_MS,
    port: e.PORT,
    defaultsDir: e.DEFAULTS_DIR,
    autoApplyDir: e.AUTO_APPLY_DIR,
    soulPath: e.SOUL_PATH,
  };
}
