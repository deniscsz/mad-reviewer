---
name: performance
description: Detect performance bugs that surface at scale (N+1, queries in loops, quadratic work)
applies_to:
  - "**/*.{ts,tsx,js,jsx,mts,cts,go,java,php,py,rs,kt,scala,rb,cs}"
---

# Performance at scale

Look for:
- N+1 query patterns; database calls or network IO issued inside a loop.
- Loading an entire dataset into memory instead of streaming/paginating;
  missing `LIMIT` when scanning a large table.
- Quadratic work over a collection where a `Set`/`Map` index makes it linear.
- Repeated expensive computation that should be hoisted out of a loop/render or
  memoized.
- Unbounded cache or data retention that grows without an eviction/expiry bound.

Only report when the cost is real at expected input size — not micro-tuning.

Report each as a `performance` finding with a dedupeKey like
`performance:<function-or-symbol>:<symptom>`.
