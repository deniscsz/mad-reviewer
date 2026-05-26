# Reconciliation

Reconciliation is what gives the reviewer a **memory**. On every run the agent
compares the current findings against the comments it left on the PR before, and
decides what to create, keep, or resolve — with no external findings store.

## Fingerprint: a bug's identity

Each finding is reduced to a **deterministic fingerprint** computed from three
fields:

```
fingerprint = sha256( file + "\0" + category + "\0" + dedupeKey )  → first 16 hex chars
```

The line number is **deliberately excluded**. A bug that moves lines (because
code above it changed) keeps the same fingerprint, so its existing comment is
reused instead of being re-posted. `category` and `dedupeKey` are normalized
(trimmed, lower-cased) so cosmetic differences don't change identity.

The fingerprint is embedded as an HTML comment in every comment body:

```html
<!-- mad-reviewer:fp=ab12cd34ef56ab78 -->
```

This marker — not the bot's login — is how the agent recognizes its own
comments, which makes it robust regardless of the App's display name.

## Active comments

Before deciding, the agent lists the PR's review threads (GraphQL, paginated)
and collects, for each **non-resolved** thread that contains a fingerprinted
comment, an entry of `{ fp, commentId, threadId }`. Resolved threads are
ignored — they are inert history.

## The decision table

Given the current findings (each with a fingerprint) and the set of active
fingerprints already on the PR:

| Condition | Action |
|---|---|
| Finding's fp **not** in active comments | **Create** a new inline comment (with the marker) |
| Finding's fp **is** in active comments | **Keep** — do nothing (no duplicate) |
| Active comment's fp **not** in current findings | **Resolve** — reply + resolve the thread |

**Reappearance** falls out for free: a previously-resolved bug is not in the
*active* set, so when it comes back its finding looks new and a fresh comment is
created. Within a single run, repeated fingerprints are de-duplicated.

## Resolving

When a finding disappears, the agent **replies** to the thread (a short note
referencing the commit) and then resolves it via the GraphQL
`resolveReviewThread` mutation. The reply leaves a visible trail of *why* the
thread closed.

Resolution is driven purely by **absence** from the current output — there is no
"verify the fix" step. If the AI flaps and a bug reappears, the reappearance path
re-flags it.

## Inline vs. file-level fallback

A finding is normally posted as an **inline** review comment anchored to
`file:line`. If GitHub rejects the anchor (the line isn't part of the diff) with
a **422**, the agent falls back to a **file-level** review comment
(`subject_type: "file"`). This still creates a resolvable review thread, so the
fallback comment is picked up by the same listing and reconciled like any other.

Crucially, **only a 422 triggers the fallback**. Transient errors (rate limits,
auth, 5xx) propagate, the run fails, and the worker retries — so a flaky API
never produces an un-reconcilable, re-posted-every-run comment.

## Why no findings database?

Storing findings separately would create a second source of truth that can drift
from what's actually on the PR (comments edited, resolved, or deleted by humans).
By recognizing its own comments via the fingerprint marker and treating GitHub as
authoritative, the agent stays correct even as people interact with the threads —
and it never touches comments that aren't its own.
