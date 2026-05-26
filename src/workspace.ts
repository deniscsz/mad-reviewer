import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileNoThrow } from "./utils/execFileNoThrow.js";

const MAX_BUFFER = 64 * 1024 * 1024;

export interface Workspace {
  dir: string;
  cleanup(): Promise<void>;
}

export function parseChangedFiles(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function git(dir: string, args: string[]): Promise<string> {
  const r = await execFileNoThrow("git", args, { cwd: dir, maxBuffer: MAX_BUFFER });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed (status ${r.status}): ${r.stderr}`);
  }
  return r.stdout;
}

export async function clonePrHead(opts: {
  owner: string;
  repo: string;
  headSha: string;
  baseSha: string;
  token: string;
}): Promise<Workspace> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mad-reviewer-"));
  const url = `https://x-access-token:${opts.token}@github.com/${opts.owner}/${opts.repo}.git`;
  try {
    await git(dir, ["init", "-q"]);
    await git(dir, ["remote", "add", "origin", url]);
    await git(dir, ["fetch", "-q", "--depth", "1", "origin", opts.headSha]);
    await git(dir, ["checkout", "-q", opts.headSha]);
    await git(dir, ["fetch", "-q", "--depth", "1", "origin", opts.baseSha]);
  } catch (err) {
    await fs.rm(dir, { recursive: true, force: true });
    throw err;
  }
  return {
    dir,
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

export async function computeDiff(
  dir: string,
  baseSha: string,
): Promise<{ diff: string; changedFiles: string[] }> {
  const diff = await git(dir, ["diff", `${baseSha}..HEAD`]);
  const names = await git(dir, ["diff", "--name-only", `${baseSha}..HEAD`]);
  return { diff, changedFiles: parseChangedFiles(names) };
}
