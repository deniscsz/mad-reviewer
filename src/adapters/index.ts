import type { AiAdapter } from "./types.js";
import { ClaudeAdapter } from "./claude.js";
import { OpenCodeAdapter } from "./opencode.js";
import { CursorAdapter } from "./cursor.js";
import { CodexAdapter } from "./codex.js";

export function createAdapter(
  name: string,
  opts: { timeoutMs: number; opencodeModel?: string; opencodeConfig: string; cursorModel?: string; codexModel?: string },
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
    case "codex":
      return new CodexAdapter({ timeoutMs: opts.timeoutMs, model: opts.codexModel });
    default:
      throw new Error(`unknown adapter: ${name} (supported: claude, opencode, cursor, codex)`);
  }
}
