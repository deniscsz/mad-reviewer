---
name: concurrency-async
description: Detect race conditions, async/await mistakes, and leaked concurrent work
applies_to:
  - "**/*.{ts,tsx,js,jsx,mts,cts,go,java,php,py,rs,kt,scala,rb,cs}"
---

# Concurrency & async

Look for:
- Missing `await` on an async call; fire-and-forget promises that drop errors.
- Unhandled promise rejection (an awaited call with no surrounding try/catch).
- Race on shared mutable state: read-modify-write without atomicity (e.g. two
  requests both pass a stock/balance check, then both write — use a single
  atomic update / compare-and-set).
- Non-idempotent retry or job handler: the same event/message processed twice
  produces a double effect (double charge, duplicate row).
- Goroutine/thread/task with no exit or cancellation path (leak); missing
  `context.Context` propagation to cancellable work.
- Holding a lock/`Mutex` across an `await` or other blocking call.
- Unbounded parallel fan-out (`Promise.all`, batch) larger than the downstream
  system can safely handle.

Report each as a `concurrency` finding with a dedupeKey like
`concurrency:<function-or-symbol>:<symptom>`.
