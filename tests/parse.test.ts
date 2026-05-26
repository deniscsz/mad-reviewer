import { describe, it, expect } from "vitest";
import { extractFindingsJson, extractOpencodeText } from "../src/adapters/parse.js";

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

describe("extractOpencodeText", () => {
  it("returns the text of a single text-part event", () => {
    const line = JSON.stringify({ type: "text", part: { id: "p1", type: "text", text: "hello" } });
    expect(extractOpencodeText(line)).toBe("hello");
  });

  it("keeps the last value for incremental updates of the same part id", () => {
    const stdout = [
      JSON.stringify({ type: "message.part.updated", part: { id: "p1", type: "text", text: "he" } }),
      JSON.stringify({ type: "message.part.updated", part: { id: "p1", type: "text", text: "hello" } }),
    ].join("\n");
    expect(extractOpencodeText(stdout)).toBe("hello");
  });

  it("concatenates distinct text parts in order", () => {
    const stdout = [
      JSON.stringify({ part: { id: "p1", type: "text", text: "foo" } }),
      JSON.stringify({ part: { id: "p2", type: "text", text: "bar" } }),
    ].join("\n");
    expect(extractOpencodeText(stdout)).toBe("foobar");
  });

  it("ignores tool, thinking, and step events and blank/garbage lines", () => {
    const stdout = [
      "",
      JSON.stringify({ type: "step_start", part: { type: "step-start" } }),
      "not json",
      JSON.stringify({ type: "message.part.updated", part: { type: "thinking", text: "hmm" } }),
      JSON.stringify({ part: { id: "t1", type: "tool", name: "read", state: "running" } }),
      JSON.stringify({ part: { id: "p1", type: "text", text: "answer" } }),
    ].join("\n");
    expect(extractOpencodeText(stdout)).toBe("answer");
  });

  it("falls back to raw stdout when no text events are present", () => {
    expect(extractOpencodeText('[{"a":1}]')).toBe('[{"a":1}]');
  });
});
