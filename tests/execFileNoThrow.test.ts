import { describe, it, expect } from "vitest";
import { execFileNoThrow } from "../src/utils/execFileNoThrow.js";

describe("execFileNoThrow", () => {
  it("returns stdout and status 0 on success", async () => {
    const r = await execFileNoThrow("node", ["-e", "process.stdout.write('hi')"]);
    expect(r.stdout).toBe("hi");
    expect(r.status).toBe(0);
  });

  it("returns a nonzero status without throwing on failure", async () => {
    const r = await execFileNoThrow("node", ["-e", "process.exit(3)"]);
    expect(r.status).toBe(3);
  });

  it("does not invoke a shell (args are literal, not interpreted)", async () => {
    const r = await execFileNoThrow("node", [
      "-e",
      "process.stdout.write(process.argv[1] || '')",
      "a;b",
    ]);
    expect(r.stdout).toBe("a;b");
    expect(r.status).toBe(0);
  });

  it("passes opts.input to the child process stdin", async () => {
    const r = await execFileNoThrow(
      "node",
      ["-e", "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(d))"],
      { input: "piped-hello" },
    );
    expect(r.stdout).toBe("piped-hello");
    expect(r.status).toBe(0);
  });

  it("returns timeout status 124 on the stdin path without hanging", async () => {
    const r = await execFileNoThrow(
      "node",
      ["-e", "setTimeout(() => {}, 10000)"],
      { input: "x", timeout: 150 },
    );
    expect(r.status).toBe(124);
  });
});
