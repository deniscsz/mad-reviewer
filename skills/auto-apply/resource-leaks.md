---
name: resource-leaks
description: Detect unclosed resources, dangling listeners, and uncleared timers
applies_to:
  - "**/*.{ts,tsx,js,jsx,mts,cts,go,java,php,py,rs,kt,scala,rb,cs}"
---

# Resource leaks

Look for:
- Connections/files/streams/sockets opened without a guaranteed close
  (no `finally` / `using` / `defer` / `with` / try-with-resources).
- Event listeners, subscriptions, or observers added but never removed.
- Timers/intervals (`setInterval`, tickers) started but never cleared.
- Executors, thread pools, or long-lived clients never shut down.
- Cleanup that runs only on the happy path and is skipped when an error throws.

Report each as a `resource-leak` finding with a dedupeKey like
`resource-leak:<resource-or-symbol>:<symptom>`.
