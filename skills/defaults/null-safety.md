---
name: null-safety
description: Detect null/undefined dereferences and missing guards
---

# Null safety

Look for:
- Values that can be `null`/`undefined` dereferenced without a guard.
- Optional chaining missing where an upstream value is nullable.
- Array access / `.find()` results used without checking for `undefined`.
- Non-null assertions (`!`) that are not actually guaranteed.

Report each as a `null-safety` finding with a `dedupeKey` like
`null-safety:<function-or-symbol>:<the-nullable-thing>`.
