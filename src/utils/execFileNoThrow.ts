import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface ExecResult {
  stdout: string;
  stderr: string;
  status: number;
}

export interface ExecOpts {
  cwd?: string;
  timeout?: number;
  maxBuffer?: number;
  input?: string;
  env?: NodeJS.ProcessEnv;
}

export async function execFileNoThrow(
  file: string,
  args: string[],
  opts: ExecOpts = {},
): Promise<ExecResult> {
  if (opts.input !== undefined) {
    return runWithStdin(file, args, opts, opts.input);
  }
  try {
    const { stdout, stderr } = await run(file, args, {
      cwd: opts.cwd,
      timeout: opts.timeout,
      maxBuffer: opts.maxBuffer ?? 64 * 1024 * 1024,
      env: opts.env,
    });
    return { stdout: stdout.toString(), stderr: stderr.toString(), status: 0 };
  } catch (err) {
    const e = err as { stdout?: string | Buffer; stderr?: string | Buffer; code?: number };
    return {
      stdout: e.stdout ? e.stdout.toString() : "",
      stderr: e.stderr ? e.stderr.toString() : String(err),
      status: typeof e.code === "number" ? e.code : 1,
    };
  }
}

function runWithStdin(
  file: string,
  args: string[],
  opts: ExecOpts,
  input: string,
): Promise<ExecResult> {
  const maxBuffer = opts.maxBuffer ?? 64 * 1024 * 1024;
  return new Promise((resolve) => {
    const child = spawn(file, args, { cwd: opts.cwd, env: opts.env });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let overflow = false;
    let timer: NodeJS.Timeout | undefined;
    if (opts.timeout && opts.timeout > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, opts.timeout);
    }
    const append = (chunk: Buffer, target: "out" | "err") => {
      if (overflow) return;
      if (target === "out") stdout += chunk.toString();
      else stderr += chunk.toString();
      if (stdout.length + stderr.length > maxBuffer) {
        overflow = true;
        child.kill("SIGKILL");
      }
    };
    child.stdout.on("data", (d: Buffer) => append(d, "out"));
    child.stderr.on("data", (d: Buffer) => append(d, "err"));
    child.stdin.on("error", () => { /* ignore EPIPE if the child exits early */ });
    child.on("error", (e) => {
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr: stderr || String(e), status: 1 });
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) resolve({ stdout, stderr: stderr || "timed out", status: 124 });
      else if (overflow) resolve({ stdout, stderr: "maxBuffer exceeded", status: 1 });
      else resolve({ stdout, stderr, status: code ?? 1 });
    });
    child.stdin.end(input);
  });
}
