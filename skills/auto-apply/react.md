---
name: react
description: Detect React 19 hook, effect, and rendering bugs
applies_to:
  - "**/*.{tsx,jsx}"
---

# React

Look for:
- Hooks called conditionally or in a loop (violates the Rules of Hooks).
- `useEffect` dependency array incomplete or wrong (stale or missing deps).
- `useEffect` missing a cleanup for subscriptions, timers, or fetches.
- Data-fetch effect with no race guard: a slower earlier request can overwrite a
  newer one. Use an `ignore` flag set in the effect and flipped in cleanup, or
  an `AbortController`.
- `useEffect` used to compute derived state that should be a plain calculation
  (or `useMemo`) during render.
- Array index used as `key` on a reorderable/filterable list, or a missing `key`.
- A component defined inside another component (remounts on every render).
- Server Component using client-only APIs (`useState`, `useEffect`, `onClick`).
- TanStack Query v5: `queryKey` missing params that affect the data; a mutation
  not invalidating related queries on success; an optimistic update with no
  rollback in `onError`.

Report each as a `react` finding with a dedupeKey like
`react:<component-or-hook>:<symptom>`.
