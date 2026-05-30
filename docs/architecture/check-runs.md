# Check Runs

Alongside inline comments, `mad-reviewer` publishes a **Check Run** (GitHub
Checks API) on the PR's head commit — the status + summary that shows up in the
PR's checks box. It is layered on top of the existing
review flow: the inline comments are unchanged; the check is a status summary.

## Conclusion

The conclusion is derived from the run's reconcile result
(`RunSummary {created, kept, resolved}`):

- **`success`** (green ✓) — no mad-reviewer comments remain open
  (`created + kept === 0`).
- **`neutral`** (gray) — at least one remains open, whether new this run
  (`created`) or carried over from a prior run (`kept`).

`resolved` comments do not count — they were closed this run. No outcome is
`failure` for *finding bugs*, so the check never blocks a merge by default. (A
team can make it a *required* check via branch protection if they want a gate.)

A run that **errors or times out** is reported `failure` (with the error in the
summary — an honest "the bot did not run" signal) only after all retries are
exhausted; while retrying, the check stays `in_progress`.

## Lifecycle

The **worker** owns the lifecycle, because it is the only place that sees both
success and failure:

1. **Claim** → create the check `in_progress` (`started_at` now). The check is
   keyed to the head SHA; `checks.listForRef` is consulted first so a retry or a
   process restart **reuses** the existing check instead of duplicating it.
2. The review runs.
3. **Success** → `completed` with the conclusion above and a markdown summary
   (counts + carryover).
4. **Terminal failure** → `completed` + `failure` + the error. A non-terminal
   failure (will retry) leaves the check `in_progress`.

## Fail-soft & permission

Publishing a check needs the App's **`Checks: Read & write`** permission (see
[GitHub App Setup](/guide/github-app-setup)). Existing installations must
re-approve it. If a check API call fails (e.g. the permission is missing → 403),
mad-reviewer logs a `check_error` and **continues** — the review comments are
still posted; a check failure never fails the job.

Set `MAD_REVIEWER_CHECKS=false` to disable the feature entirely, and
`MAD_REVIEWER_CHECK_NAME` to change the displayed name (GitHub groups re-runs by
name). See [Configuration](/guide/configuration).

## Findings stay in comments

The check carries only the summary; individual findings remain inline review
comments with the existing fingerprint dedup/resolve machinery — no annotations.
This mirrors BugBot (its check reports `annotations_count: 0`).
