---
name: typescript-javascript
description: Detect TypeScript/JavaScript correctness bugs
applies_to:
  - "**/*.{ts,tsx,js,jsx,mts,cts}"
---

# TypeScript / JavaScript

Look for:
- `==` / `!=` instead of `===` / `!==` where coercion changes the result.
- `any` used to bypass typing where `unknown` plus a type guard is correct.
- `parseInt` without a radix; fragile float/`Number` comparisons.
- Mutating an array/object while iterating over it.
- Closure capturing a stale loop variable (`var` in a loop, or a value read
  later than intended).
- `this` context lost when a method is passed as a bare callback.

Report each as a `ts-js` finding with a dedupeKey like
`ts-js:<function-or-symbol>:<symptom>`.
