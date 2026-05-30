import { parseFingerprint, embedFingerprint } from "../fingerprint.js";
import type { ActiveComment } from "../reconciler.js";
import type { Finding } from "../types.js";

export interface GitHubClient {
  graphql: (query: string, vars?: Record<string, unknown>) => Promise<any>;
  rest: {
    pulls: {
      createReviewComment: (params: Record<string, unknown>) => Promise<unknown>;
      createReplyForReviewComment: (params: Record<string, unknown>) => Promise<unknown>;
    };
    checks: {
      create: (params: Record<string, unknown>) => Promise<{ data: { id: number } }>;
      update: (params: Record<string, unknown>) => Promise<unknown>;
      listForRef: (params: Record<string, unknown>) => Promise<{ data: { check_runs: Array<{ id: number; name: string }> } }>;
    };
  };
}

const THREADS_QUERY = `
query($owner:String!,$repo:String!,$pr:Int!,$cursor:String){
  repository(owner:$owner,name:$repo){
    pullRequest(number:$pr){
      reviewThreads(first:100,after:$cursor){
        nodes{ id isResolved comments(first:50){ nodes{ databaseId body } } }
        pageInfo{ hasNextPage endCursor }
      }
    }
  }
}`;

const RESOLVE_MUTATION = `
mutation($threadId:ID!){
  resolveReviewThread(input:{threadId:$threadId}){ thread{ isResolved } }
}`;

interface ThreadNode {
  id: string;
  isResolved: boolean;
  comments: { nodes: Array<{ databaseId: number; body: string }> };
}

export async function listActiveBotComments(
  client: GitHubClient,
  owner: string,
  repo: string,
  pr: number,
): Promise<ActiveComment[]> {
  const out: ActiveComment[] = [];
  let cursor: string | null = null;
  do {
    const data = await client.graphql(THREADS_QUERY, { owner, repo, pr, cursor });
    const threads = data?.repository?.pullRequest?.reviewThreads;
    if (!threads) {
      throw new Error(`Unexpected GraphQL response for ${owner}/${repo}#${pr}: ${JSON.stringify(data)}`);
    }
    for (const thread of threads.nodes as ThreadNode[]) {
      if (thread.isResolved) continue;
      for (const c of thread.comments.nodes) {
        const fp = parseFingerprint(c.body);
        if (fp) {
          out.push({ fp, commentId: c.databaseId, threadId: thread.id });
          break;
        }
      }
    }
    cursor = threads.pageInfo.hasNextPage ? threads.pageInfo.endCursor : null;
  } while (cursor);
  return out;
}

export async function postInlineFinding(
  client: GitHubClient,
  owner: string,
  repo: string,
  pr: number,
  commitSha: string,
  finding: Finding,
  fp: string,
): Promise<void> {
  const body = embedFingerprint(`**${finding.title}**\n\n${finding.body}`, fp);
  try {
    await client.rest.pulls.createReviewComment({
      owner, repo, pull_number: pr, commit_id: commitSha,
      path: finding.file, line: finding.line, side: "RIGHT", body,
    });
  } catch (err) {
    // Only an invalid line anchor (HTTP 422) should fall back. Transient/auth
    // errors must propagate so the run fails and retries (idempotent re-reconcile).
    if ((err as { status?: number }).status !== 422) throw err;
    // File-level review comment: still a resolvable review thread, so it is
    // picked up by listActiveBotComments and reconciled like an inline comment.
    await client.rest.pulls.createReviewComment({
      owner, repo, pull_number: pr, commit_id: commitSha,
      path: finding.file, subject_type: "file", body,
    });
  }
}

export async function resolveWithReply(
  client: GitHubClient,
  owner: string,
  repo: string,
  pr: number,
  args: { commentId: number; threadId: string; commitSha: string },
): Promise<void> {
  await client.rest.pulls.createReplyForReviewComment({
    owner, repo, pull_number: pr, comment_id: args.commentId,
    body: `Resolvido automaticamente nesta revisão (commit ${args.commitSha.slice(0, 7)}).`,
  });
  await client.graphql(RESOLVE_MUTATION, { threadId: args.threadId });
}
