import type { AiAdapter } from "./types.js";
import { ClaudeAdapter } from "./claude.js";
import { OpenCodeAdapter } from "./opencode.js";

export function createAdapter(
  name: string,
  opts: { timeoutMs: number; opencodeModel?: string; opencodeConfig: string },
): AiAdapter {
  switch (name) {
    case "claude":
      return new ClaudeAdapter({ timeoutMs: opts.timeoutMs });
    case "opencode":
      return new OpenCodeAdapter({
        timeoutMs: opts.timeoutMs,
        model: opts.opencodeModel,
        configPath: opts.opencodeConfig,
      });
    default:
      throw new Error(`unknown adapter: ${name} (supported: claude, opencode)`);
  }
}
