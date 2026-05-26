import type { AiAdapter } from "./types.js";
import { ClaudeAdapter } from "./claude.js";

export function createAdapter(name: string, opts: { timeoutMs: number }): AiAdapter {
  switch (name) {
    case "claude":
      return new ClaudeAdapter({ timeoutMs: opts.timeoutMs });
    default:
      throw new Error(`unknown adapter: ${name} (supported: claude)`);
  }
}
