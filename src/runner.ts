import type { Finding, Job } from "./types.js";
import type { AiAdapter } from "./adapters/types.js";
import type { GitHubClient } from "./github/comments.js";
import type { Workspace } from "./workspace.js";
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
  config: { defaultsDir: string; autoApplyDir: string };
  log: (event: Record<string, unknown>) => void;
}

export async function runReview(job: Job, deps: RunnerDeps): Promise<RunSummary> {
  const client = await deps.getClient(job.installationId);
  const token = await deps.getInstallationToken(job.installationId);
  const ws = await deps.clonePrHead({
    owner: job.owner, repo: job.repo, headSha: job.headSha, baseSha: job.baseSha, token,
  });

  try {
    const { diff, changedFiles } = await deps.computeDiff(ws.dir, job.baseSha);
    const skills = await deps.loadSkills({
      defaultsDir: deps.config.defaultsDir,
      autoApplyDir: deps.config.autoApplyDir,
      workspaceDir: ws.dir,
      changedFiles,
    });
    const findings = await deps.adapter.review({ workspaceDir: ws.dir, changedFiles, diff, skills });
    const current = findings.map((finding) => ({
      finding,
      fp: computeFingerprint({ file: finding.file, category: finding.category, dedupeKey: finding.dedupeKey }),
    }));
    const active = await deps.listActiveBotComments(client, job.owner, job.repo, job.pr);
    const actions = reconcile(current, active);

    let created = 0, kept = 0, resolved = 0;
    for (const action of actions) {
      if (action.type === "create") {
        await deps.postInlineFinding(client, job.owner, job.repo, job.pr, job.headSha, action.finding, action.fp);
        created++;
      } else if (action.type === "keep") {
        kept++;
      } else {
        await deps.resolveWithReply(client, job.owner, job.repo, job.pr, {
          commentId: action.commentId, threadId: action.threadId, commitSha: job.headSha,
        });
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
