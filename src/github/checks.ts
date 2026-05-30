import type { RunSummary } from "../runner.js";
import type { GitHubClient } from "./comments.js";

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
    await client.rest.checks.update({
      owner: opts.owner, repo: opts.repo, check_run_id: runs[0].id, status: "in_progress",
    });
    return runs[0].id;
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
