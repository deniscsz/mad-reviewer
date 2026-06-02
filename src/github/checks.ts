import type { RunSummary } from "../runner.js";
import type { GitHubClient } from "./comments.js";
import type { QueueJob } from "../queue/queue.js";

export interface CheckMeta {
  adapter: string;
  model?: string;
}

/** success when no bot comments remain open (created + kept === 0), else neutral. */
export function conclusionFor(summary: RunSummary): "success" | "neutral" {
  return summary.created + summary.kept === 0 ? "success" : "neutral";
}

export function formatOutput(summary: RunSummary, meta: CheckMeta): { title: string; summary: string } {
  const open = summary.created + summary.kept;
  const model = meta.model ? ` (${meta.model})` : "";
  const body = [
    `Revisão concluída com **${meta.adapter}**${model}.`,
    "",
    `🆕 ${summary.created} novo(s) · ♻️ ${summary.kept} mantido(s) · ✅ ${summary.resolved} resolvido(s)`,
    "",
    open === 0
      ? "Nenhum problema em aberto. 🎉"
      : `**${open} problema(s) em aberto** (${summary.kept} de revisões anteriores). Veja os comentários na aba *Files changed*.`,
  ].join("\n");
  return {
    title: open === 0 ? "Nenhum problema em aberto" : `${open} problema(s) em aberto`,
    summary: body,
  };
}

export function errorOutput(error: unknown): { title: string; summary: string } {
  const msg = error instanceof Error ? error.message : String(error);
  return {
    title: "Revisão falhou",
    summary: `A revisão não pôde ser concluída e nada foi postado.\n\n\`\`\`\n${msg}\n\`\`\``,
  };
}

export async function startCheckRun(
  client: GitHubClient,
  opts: { owner: string; repo: string; headSha: string; name: string },
): Promise<number> {
  const existing = await client.rest.checks.listForRef({
    owner: opts.owner, repo: opts.repo, ref: opts.headSha, check_name: opts.name,
  });
  const runs = existing.data.check_runs ?? [];
  if (runs.length > 0) {
    const run = runs[0]!;
    await client.rest.checks.update({
      owner: opts.owner, repo: opts.repo, check_run_id: run.id, status: "in_progress",
    });
    return run.id;
  }
  const created = await client.rest.checks.create({
    owner: opts.owner, repo: opts.repo, name: opts.name, head_sha: opts.headSha, status: "in_progress",
  });
  return created.data.id;
}

export async function finishCheckRun(
  client: GitHubClient,
  opts: {
    owner: string; repo: string; checkRunId: number;
    conclusion: "success" | "neutral" | "failure";
    output: { title: string; summary: string };
  },
): Promise<void> {
  await client.rest.checks.update({
    owner: opts.owner, repo: opts.repo, check_run_id: opts.checkRunId,
    status: "completed", conclusion: opts.conclusion, output: opts.output,
  });
}

export interface CheckReporter {
  start(job: QueueJob): Promise<number | null>;
  finishSuccess(checkRunId: number, job: QueueJob, summary: RunSummary): Promise<void>;
  finishFailure(checkRunId: number, job: QueueJob, error: unknown): Promise<void>;
}

export function createCheckReporter(opts: {
  getClient: (installationId: number) => Promise<GitHubClient>;
  name: string;
  meta: CheckMeta;
  log: (event: Record<string, unknown>) => void;
}): CheckReporter {
  const { getClient, name, meta, log } = opts;
  const repoOf = (j: QueueJob) => `${j.owner}/${j.repo}`;
  return {
    async start(job) {
      try {
        const client = await getClient(job.installationId);
        const id = await startCheckRun(client, { owner: job.owner, repo: job.repo, headSha: job.headSha, name });
        log({ event: "check_create", repo: repoOf(job), pr: job.pr, headSha: job.headSha, checkRunId: id });
        return id;
      } catch (err) {
        log({ level: "error", event: "check_error", phase: "start", repo: repoOf(job), pr: job.pr, error: String(err) });
        return null;
      }
    },
    async finishSuccess(checkRunId, job, summary) {
      try {
        const client = await getClient(job.installationId);
        const conclusion = conclusionFor(summary);
        await finishCheckRun(client, { owner: job.owner, repo: job.repo, checkRunId, conclusion, output: formatOutput(summary, meta) });
        log({ event: "check_complete", repo: repoOf(job), pr: job.pr, checkRunId, conclusion, open: summary.created + summary.kept });
      } catch (err) {
        log({ level: "error", event: "check_error", phase: "finish", repo: repoOf(job), pr: job.pr, error: String(err) });
      }
    },
    async finishFailure(checkRunId, job, error) {
      try {
        const client = await getClient(job.installationId);
        await finishCheckRun(client, { owner: job.owner, repo: job.repo, checkRunId, conclusion: "failure", output: errorOutput(error) });
        log({ event: "check_complete", repo: repoOf(job), pr: job.pr, checkRunId, conclusion: "failure", open: null });
      } catch (err) {
        log({ level: "error", event: "check_error", phase: "finish", repo: repoOf(job), pr: job.pr, error: String(err) });
      }
    },
  };
}
