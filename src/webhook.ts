import type { Probot } from "probot";
import type { Queue } from "./queue/queue.js";

export type LogFn = (event: Record<string, unknown>) => void;

export function registerWebhooks(
  app: Probot,
  queue: Pick<Queue, "enqueue">,
  log: LogFn = () => {},
): void {
  app.on(
    ["pull_request.opened", "pull_request.synchronize", "pull_request.reopened"] as const,
    async (ctx) => {
      const pr = ctx.payload.pull_request;
      const installation = ctx.payload.installation;
      const owner = ctx.payload.repository.owner.login;
      const repo = ctx.payload.repository.name;
      const base = { event: "webhook", action: ctx.payload.action, repo: `${owner}/${repo}`, pr: pr.number, headSha: pr.head.sha };
      if (!installation) {
        log({ ...base, event: "webhook_skipped", reason: "no_installation" });
        return;
      }
      log({ ...base, installationId: installation.id });
      queue.enqueue({
        owner,
        repo,
        pr: pr.number,
        headSha: pr.head.sha,
        baseSha: pr.base.sha,
        installationId: installation.id,
      });
    },
  );
}
