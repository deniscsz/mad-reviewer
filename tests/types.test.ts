import { describe, it, expect } from "vitest";
import { FindingSchema, FindingsArraySchema } from "../src/types.js";

describe("FindingSchema", () => {
  const valid = {
    file: "src/a.ts",
    line: 12,
    category: "null-safety",
    dedupeKey: "null-safety:UserService.load:user",
    severity: "bug",
    title: "Possible null deref",
    body: "user may be null here",
  };

  it("accepts a valid finding", () => {
    expect(FindingSchema.parse(valid)).toEqual(valid);
  });

  it("rejects severity other than 'bug'", () => {
    expect(() => FindingSchema.parse({ ...valid, severity: "nit" })).toThrow();
  });

  it("rejects line <= 0", () => {
    expect(() => FindingSchema.parse({ ...valid, line: 0 })).toThrow();
  });

  it("parses an array of findings", () => {
    expect(FindingsArraySchema.parse([valid])).toHaveLength(1);
  });
});
