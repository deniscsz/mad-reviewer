import { describe, it, expect } from "vitest";
import { extractFindingsJson } from "../src/adapters/parse.js";

describe("extractFindingsJson", () => {
  it("parses a bare JSON array", () => {
    expect(extractFindingsJson('[{"a":1}]')).toEqual([{ a: 1 }]);
  });

  it("parses a fenced ```json block", () => {
    const text = "Here you go:\n```json\n[{\"a\":2}]\n```\nthanks";
    expect(extractFindingsJson(text)).toEqual([{ a: 2 }]);
  });

  it("parses an array embedded in prose", () => {
    expect(extractFindingsJson('prefix [{"a":3}] suffix')).toEqual([{ a: 3 }]);
  });

  it("parses an empty array", () => {
    expect(extractFindingsJson("[]")).toEqual([]);
  });

  it("throws when no array is present", () => {
    expect(() => extractFindingsJson("no json here")).toThrow();
  });
});
