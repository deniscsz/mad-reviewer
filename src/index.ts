import { createServer } from "node:http";
import { Probot, createNodeMiddleware } from "probot";
import { loadConfig } from "./config.js";
import { Queue, type QueueJob } from "./queue/queue.js";
import { registerWebhooks } from "./webhook.js";
import { startWorker } from "./worker.js";
import { runReview, type RunSummary } from "./runner.js";
import { createAdapter } from "./adapters/index.js";
import { clonePrHead, computeDiff } from "./workspace.js";
import { loadSkills } from "./skills/loader.js";
import { loadSoul } from "./soul/loader.js";
import {
  listActiveBotComments,
  postInlineFinding,
  resolveWithReply,
  type GitHubClient,
} from "./github/comments.js";
import type { Job } from "./types.js";
import { createCheckReporter } from "./github/checks.js";

const config = loadConfig();
const log = (event: Record<string, unknown>) => console.log(JSON.stringify(event));

const probot = new Probot({
  appId: config.appId,
  privateKey: config.privateKey,
  secret: config.webhookSecret,
});

const queue = new Queue(config.sqlitePath, config.debounceMs, log);
const adapter = createAdapter(config.adapter, {
  timeoutMs: config.aiTimeoutMs,
  opencodeModel: config.opencodeModel,
  opencodeConfig: config.opencodeConfig,
  cursorModel: config.cursorModel,
});

const checkModel =
  config.adapter === "opencode" ? config.opencodeModel :
  config.adapter === "cursor" ? config.cursorModel :
  undefined;

const checks = config.checksEnabled
  ? createCheckReporter({
      getClient,
      name: config.checkName,
      meta: { adapter: config.adapter, model: checkModel },
      log,
    })
  : undefined;

async function getClient(installationId: number): Promise<GitHubClient> {
  const octokit = await probot.auth(installationId);
  return octokit as unknown as GitHubClient;
}

async function getInstallationToken(installationId: number): Promise<string> {
  const octokit = await probot.auth(installationId);
  const auth = (await octokit.auth({ type: "installation" })) as { token: string };
  return auth.token;
}

async function runOne(qjob: QueueJob): Promise<RunSummary> {
  const job: Job = qjob;
  return runReview(job, {
    getClient,
    getInstallationToken,
    clonePrHead,
    computeDiff,
    loadSkills,
    loadSoul,
    adapter,
    listActiveBotComments,
    postInlineFinding,
    resolveWithReply,
    config: {
      defaultsDir: config.defaultsDir,
      autoApplyDir: config.autoApplyDir,
      soulPath: config.soulPath,
      loadRepoSkills: config.loadRepoSkills,
      debug: config.debug,
    },
    log,
  });
}

const appFn = (app: Probot) => registerWebhooks(app, queue, log);
const middleware = createNodeMiddleware(appFn, { probot });

const server = createServer(async (req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }
  const handled = await middleware(req, res);
  if (!handled) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  }
});

server.listen(config.port, () => {
  log({ event: "listening", port: config.port, adapter: config.adapter, debug: config.debug, checks: config.checksEnabled });
  const stopWorker = startWorker({ queue, runOne, maxRetries: config.maxRetries, log, checks }, config.workerPollMs);

  const shutdown = (signal: string) => {
    log({ event: "shutdown", signal });
    stopWorker();
    server.close();
    queue.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
});
