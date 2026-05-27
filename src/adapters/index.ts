import type { AiAdapter } from "./types.js";
import { ClaudeAdapter } from "./claude.js";
import { OpenCodeAdapter } from "./opencode.js";
import { CursorAdapter } from "./cursor.js";

export function createAdapter(
  name: string,
  opts: { timeoutMs: number; opencodeModel?: string; opencodeConfig: string; cursorModel?: string },
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
    case "cursor":
      return new CursorAdapter({ timeoutMs: opts.timeoutMs, model: opts.cursorModel });
    default:
      throw new Error(`unknown adapter: ${name} (supported: claude, opencode, cursor)`);
  }
}
