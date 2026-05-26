import type { Finding } from "./types.js";

export interface ActiveComment {
  fp: string;
  commentId: number;
  threadId: string;
}

export type ReconcileAction =
  | { type: "create"; finding: Finding; fp: string }
  | { type: "keep"; fp: string; commentId: number }
  | { type: "resolve"; fp: string; threadId: string; commentId: number };

export function reconcile(
  current: Array<{ finding: Finding; fp: string }>,
  activeComments: ActiveComment[],
): ReconcileAction[] {
  const activeByFp = new Map(activeComments.map((c) => [c.fp, c] as const));
  const currentFps = new Set(current.map((c) => c.fp));
  const actions: ReconcileAction[] = [];
  const seen = new Set<string>();

  for (const { finding, fp } of current) {
    if (seen.has(fp)) continue;
    seen.add(fp);
    const existing = activeByFp.get(fp);
    if (existing) {
      actions.push({ type: "keep", fp, commentId: existing.commentId });
    } else {
      actions.push({ type: "create", finding, fp });
    }
  }

  for (const c of activeComments) {
    if (!currentFps.has(c.fp)) {
      actions.push({ type: "resolve", fp: c.fp, threadId: c.threadId, commentId: c.commentId });
    }
  }

  return actions;
}
