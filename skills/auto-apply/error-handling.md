---
name: error-handling
description: Detect swallowed errors, broken propagation, and unhandled failure paths
applies_to:
  - "**/*.{ts,tsx,js,jsx,mts,cts,go,java,php,py,rs,kt,scala,rb,cs}"
---

# Error handling

Look for:
- Swallowed exceptions: empty catch blocks, or a `catch` that only logs and
  continues as if nothing failed.
- Overly broad catch hiding specific failures (`catch (e) {}`, bare `except:`).
- Missing error propagation: a failure is caught but the function still returns
  a success value (e.g. an order marked PAID regardless of the charge result).
- Partial failure not handled: step 2 of 3 fails and leaves inconsistent state
  with no rollback/compensation.
- Cleanup or `finally` that throws/returns and masks the original error.
- Go: error ignored (`v, _ := f()`); wrapping with `%v` instead of `%w`
  (breaks `errors.Is` / `errors.As`).

Report each as an `error-handling` finding with a dedupeKey like
`error-handling:<function-or-symbol>:<symptom>`.
