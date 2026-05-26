import type { Probot } from "probot";
import type { Queue } from "./queue/queue.js";

export function registerWebhooks(app: Probot, queue: Pick<Queue, "enqueue">): void {
  app.on(
    ["pull_request.opened", "pull_request.synchronize", "pull_request.reopened"] as const,
    async (ctx) => {
      const pr = ctx.payload.pull_request;
      const installation = ctx.payload.installation;
      if (!installation) return;
      queue.enqueue({
        owner: ctx.payload.repository.owner.login,
        repo: ctx.payload.repository.name,
        pr: pr.number,
        headSha: pr.head.sha,
        baseSha: pr.base.sha,
        installationId: installation.id,
      });
    },
  );
}
