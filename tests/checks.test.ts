import { describe, it, expect } from "vitest";
import { conclusionFor, formatOutput, errorOutput } from "../src/github/checks.js";

const empty = { created: 0, kept: 0, resolved: 0 };

describe("conclusionFor", () => {
  it("is success when no comments remain open", () => {
    expect(conclusionFor(empty)).toBe("success");
    expect(conclusionFor({ created: 0, kept: 0, resolved: 5 })).toBe("success");
  });
  it("is neutral when any comment is open (new or kept)", () => {
    expect(conclusionFor({ created: 1, kept: 0, resolved: 0 })).toBe("neutral");
    expect(conclusionFor({ created: 0, kept: 2, resolved: 0 })).toBe("neutral");
  });
});

describe("formatOutput", () => {
  it("reports no open problems when nothing remains", () => {
    const out = formatOutput(empty, { adapter: "claude" });
    expect(out.title).toBe("Nenhum problema em aberto");
    expect(out.summary).toContain("claude");
    expect(out.summary).toContain("🎉");
  });
  it("reports the open count and prior-review carryover", () => {
    const out = formatOutput({ created: 1, kept: 2, resolved: 1 }, { adapter: "cursor", model: "sonnet-4" });
    expect(out.title).toBe("3 problema(s) em aberto");
    expect(out.summary).toContain("sonnet-4");
    expect(out.summary).toContain("de revisões anteriores");
  });
});

describe("errorOutput", () => {
  it("renders the error message", () => {
    const out = errorOutput(new Error("kaboom"));
    expect(out.title).toBe("Revisão falhou");
    expect(out.summary).toContain("kaboom");
  });
});
