import { describe, it, expect } from "vitest";
import {
  computeFingerprint,
  embedFingerprint,
  parseFingerprint,
} from "../src/fingerprint.js";

const base = {
  file: "src/a.ts",
  category: "null-safety",
  dedupeKey: "null-safety:UserService.load:user",
};

describe("computeFingerprint", () => {
  it("is deterministic for identical input", () => {
    expect(computeFingerprint(base)).toBe(computeFingerprint(base));
  });

  it("ignores casing/whitespace in category and dedupeKey", () => {
    expect(computeFingerprint(base)).toBe(
      computeFingerprint({
        file: "src/a.ts",
        category: "  NULL-SAFETY ",
        dedupeKey: "Null-Safety:UserService.load:user",
      }),
    );
  });

  it("changes when dedupeKey changes", () => {
    expect(computeFingerprint(base)).not.toBe(
      computeFingerprint({ ...base, dedupeKey: "other" }),
    );
  });

  it("returns a 16-char hex string", () => {
    expect(computeFingerprint(base)).toMatch(/^[a-f0-9]{16}$/);
  });
});

describe("embed/parse fingerprint", () => {
  it("round-trips a fingerprint through a comment body", () => {
    const fp = computeFingerprint(base);
    const body = embedFingerprint("Some bug text", fp);
    expect(parseFingerprint(body)).toBe(fp);
  });

  it("returns null when no marker present", () => {
    expect(parseFingerprint("plain human comment")).toBeNull();
  });
});
