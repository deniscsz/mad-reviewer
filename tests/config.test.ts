import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

const base = {
  GITHUB_APP_ID: "123",
  GITHUB_PRIVATE_KEY: "key",
  GITHUB_WEBHOOK_SECRET: "secret",
};

describe("loadConfig", () => {
  it("applies defaults when optional vars are absent", () => {
    const cfg = loadConfig(base);
    expect(cfg.adapter).toBe("claude");
    expect(cfg.debounceMs).toBe(15000);
    expect(cfg.maxRetries).toBe(3);
    expect(cfg.sqlitePath).toBe("./data/queue.db");
    expect(cfg.port).toBe(3000);
  });

  it("coerces numeric env vars", () => {
    const cfg = loadConfig({ ...base, DEBOUNCE_MS: "500", PORT: "8080" });
    expect(cfg.debounceMs).toBe(500);
    expect(cfg.port).toBe(8080);
  });

  it("reads the optional opencode model when set", () => {
    const cfg = loadConfig({ ...base, MAD_REVIEWER_OPENCODE_MODEL: "anthropic/claude-sonnet-4" });
    expect(cfg.opencodeModel).toBe("anthropic/claude-sonnet-4");
  });

  it("leaves opencodeModel undefined when absent", () => {
    expect(loadConfig(base).opencodeModel).toBeUndefined();
  });

  it("defaults soulPath to ./SOUL.md", () => {
    expect(loadConfig(base).soulPath).toBe("./SOUL.md");
  });

  it("reads a custom SOUL_PATH when set", () => {
    expect(loadConfig({ ...base, SOUL_PATH: "/etc/soul.md" }).soulPath).toBe("/etc/soul.md");
  });

  it("throws when a required var is missing", () => {
    expect(() => loadConfig({ GITHUB_APP_ID: "1" })).toThrow();
  });
});
