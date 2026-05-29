import type { Finding, Job } from "./types.js";
import type { AiAdapter } from "./adapters/types.js";
import type { GitHubClient } from "./github/comments.js";
import type { Workspace } from "./workspace.js";
import { sanitizeUntrustedConfig } from "./workspace.js";
import type { EffectiveSkills } from "./skills/loader.js";
import type { ActiveComment } from "./reconciler.js";
import { reconcile } from "./reconciler.js";
import { computeFingerprint } from "./fingerprint.js";

export interface RunSummary {
  created: number;
  kept: number;
  resolved: number;
}

export interface RunnerDeps {
  getClient(installationId: number): Promise<GitHubClient>;
  getInstallationToken(installationId: number): Promise<string>;
  clonePrHead(opts: {
    owner: string; repo: string; headSha: string; baseSha: string; token: string;
  }): Promise<Workspace>;
  computeDiff(dir: string, baseSha: string): Promise<{ diff: string; changedFiles: string[] }>;
  loadSkills(opts: {
    defaultsDir: string; autoApplyDir: string; workspaceDir: string; changedFiles: string[];
  }): Promise<EffectiveSkills>;
  loadSoul(opts: { soulPath: string; workspaceDir: string }): Promise<string | undefined>;
  adapter: AiAdapter;
  listActiveBotComments(client: GitHubClient, owner: string, repo: string, pr: number): Promise<ActiveComment[]>;
  postInlineFinding(
    client: GitHubClient, owner: string, repo: string, pr: number,
    commitSha: string, finding: Finding, fp: string,
  ): Promise<void>;
  resolveWithReply(
    client: GitHubClient, owner: string, repo: string, pr: number,
    args: { commentId: number; threadId: string; commitSha: string },
  ): Promise<void>;
  config: { defaultsDir: string; autoApplyDir: string; soulPath: string; loadRepoSkills: boolean; debug: boolean };
  log: (event: Record<string, unknown>) => void;
}

export async function runReview(job: Job, deps: RunnerDeps): Promise<RunSummary> {
  const client = await deps.getClient(job.installationId);
  const token = await deps.getInstallationToken(job.installationId);
  const ws = await deps.clonePrHead({
    owner: job.owner, repo: job.repo, headSha: job.headSha, baseSha: job.baseSha, token,
  });

  try {
    await sanitizeUntrustedConfig(ws.dir, { loadRepoSkills: deps.config.loadRepoSkills });
    const { diff, changedFiles } = await deps.computeDiff(ws.dir, job.baseSha);
    const skills = await deps.loadSkills({
      defaultsDir: deps.config.defaultsDir,
      autoApplyDir: deps.config.autoApplyDir,
      workspaceDir: ws.dir,
      changedFiles,
    });
    const soul = await deps.loadSoul({ soulPath: deps.config.soulPath, workspaceDir: ws.dir });
    const findings = await deps.adapter.review({
      workspaceDir: ws.dir, changedFiles, diff, skills, soul,
      loadRepoSkills: deps.config.loadRepoSkills,
      debug: deps.config.debug,
      log: deps.log,
    });
    const current = findings.map((finding) => ({
      finding,
      fp: computeFingerprint({ file: finding.file, category: finding.category, dedupeKey: finding.dedupeKey }),
    }));
    const active = await deps.listActiveBotComments(client, job.owner, job.repo, job.pr);
    const actions = reconcile(current, active);

    const repo = `${job.owner}/${job.repo}`;
    let created = 0, kept = 0, resolved = 0;
    for (const action of actions) {
      if (action.type === "create") {
        await deps.postInlineFinding(client, job.owner, job.repo, job.pr, job.headSha, action.finding, action.fp);
        deps.log({ event: "comment_create", repo, pr: job.pr, file: action.finding.file, line: action.finding.line, category: action.finding.category, fp: action.fp });
        created++;
      } else if (action.type === "keep") {
        if (deps.config.debug) deps.log({ event: "comment_keep", repo, pr: job.pr, fp: action.fp });
        kept++;
      } else {
        await deps.resolveWithReply(client, job.owner, job.repo, job.pr, {
          commentId: action.commentId, threadId: action.threadId, commitSha: job.headSha,
        });
        deps.log({ event: "comment_resolve", repo, pr: job.pr, commentId: action.commentId, fp: action.fp });
        resolved++;
      }
    }

    const summary: RunSummary = { created, kept, resolved };
    deps.log({ repo: `${job.owner}/${job.repo}`, pr: job.pr, sha: job.headSha, findings: findings.length, ...summary });
    return summary;
  } finally {
    await ws.cleanup();
  }
}
