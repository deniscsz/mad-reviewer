import { describe, it, expect } from "vitest";
import { parseChangedFiles } from "../src/workspace.js";

describe("parseChangedFiles", () => {
  it("splits newline-separated paths and drops blanks", () => {
    expect(parseChangedFiles("src/a.ts\nsrc/b.ts\n\n")).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("returns [] for empty output", () => {
    expect(parseChangedFiles("")).toEqual([]);
    expect(parseChangedFiles("\n")).toEqual([]);
  });
});
